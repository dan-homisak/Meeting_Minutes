import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {
  findLatestLogFile,
  parseJsonLines,
  readEventData,
  readEventName
} from './live-debug-log-utils.mjs';

const DEFAULT_CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEFAULT_OUTPUT_ROOT = path.join(process.cwd(), 'logs', 'probes');
const PROBE_API_KEY = '__MM_LIVE_V4_PROBE__';
const PAGE_WAIT_MS = 900;
const STEP_WAIT_MS = 260;
const LAUNCHER_START_TIMEOUT_MS = 45_000;
const REMOTE_DEBUG_TIMEOUT_MS = 20_000;
const LAUNCHER_SHUTDOWN_TIMEOUT_MS = 8_000;
const CHROME_SHUTDOWN_TIMEOUT_MS = 4_000;
const IMPORTANT_EVENTS = new Set([
  'selection.changed',
  'snapshot.editor',
  'live-v4.layout.metrics',
  'live-v4.projection.built',
  'pointer.map.fragment',
  'pointer.map.fragment-miss',
  'pointer.map.native',
  'pointer.remap.post-activate',
  'pointer.remap.post-activate.miss',
  'live-v4.pointer.activate',
  'block.activate.miss',
  'cursor.move.vertical',
  'cursor.move.vertical.skipped',
  'cursor.move.vertical.boundary',
  'live-v4.active-block.large'
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeLabel(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function formatTimestampForPath(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function parseCliArguments(argv) {
  const options = {
    url: null,
    outputDir: null,
    keepLauncherAlive: false,
    chromePath: DEFAULT_CHROME_PATH,
    fixture: 'default-welcome'
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--url' && argv[index + 1]) {
      options.url = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--output-dir' && argv[index + 1]) {
      options.outputDir = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--chrome-path' && argv[index + 1]) {
      options.chromePath = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--keep-launcher-alive') {
      options.keepLauncherAlive = true;
      continue;
    }
    if (arg === '--fixture' && argv[index + 1]) {
      options.fixture = argv[index + 1];
      index += 1;
      continue;
    }
  }

  return options;
}

function attachLineReader(stream, onLine) {
  if (!stream || typeof onLine !== 'function') {
    return;
  }

  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += chunk.toString();
    while (true) {
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex < 0) {
        break;
      }
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) {
        onLine(line);
      }
    }
  });
}

function waitForExit(child, timeoutMs) {
  if (!child) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let settled = false;

    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve();
    };

    const timeout = setTimeout(() => {
      finish();
    }, timeoutMs);

    child.once('exit', () => {
      clearTimeout(timeout);
      finish();
    });
  });
}

async function stopProcessGracefully(child, timeoutMs, name) {
  if (!child || child.killed || child.exitCode != null) {
    return;
  }

  child.kill('SIGINT');
  await waitForExit(child, timeoutMs);
  if (child.exitCode != null || child.killed) {
    return;
  }

  child.kill('SIGKILL');
  await waitForExit(child, timeoutMs);
  if (child.exitCode == null && !child.killed) {
    throw new Error(`Failed to stop ${name}`);
  }
}

async function removeDirectoryBestEffort(directoryPath, {
  attempts = 5,
  waitMs = 150
} = {}) {
  if (typeof directoryPath !== 'string' || directoryPath.length === 0) {
    return;
  }

  let lastError = null;
  for (let index = 0; index < attempts; index += 1) {
    try {
      await rm(directoryPath, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      if (index < attempts - 1) {
        await sleep(waitMs);
      }
    }
  }

  throw lastError;
}

async function startLauncher(projectRoot) {
  const child = spawn(
    process.execPath,
    ['scripts/launcher.mjs'],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        LAUNCHER_NO_OPEN: '1',
        LAUNCHER_NO_TIMEOUT: '1'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );

  const outputLines = [];
  let launchUrl = null;
  let logFilePath = null;
  let exitedEarly = false;

  child.once('exit', () => {
    exitedEarly = true;
  });

  const parseLine = (line) => {
    outputLines.push(line);

    const launchMatch = line.match(/Starting Meeting Minutes at (http:\/\/\S+)/);
    if (launchMatch?.[1]) {
      launchUrl = launchMatch[1];
    }

    const logMatch = line.match(/Live debug log file: (.+)$/);
    if (logMatch?.[1]) {
      logFilePath = logMatch[1].trim();
    }
  };

  attachLineReader(child.stdout, parseLine);
  attachLineReader(child.stderr, parseLine);

  const startedAt = Date.now();
  while (Date.now() - startedAt < LAUNCHER_START_TIMEOUT_MS) {
    if (launchUrl && logFilePath) {
      return {
        child,
        launchUrl,
        logFilePath,
        outputLines
      };
    }

    if (exitedEarly) {
      throw new Error(`Launcher exited early.\n${outputLines.join('\n')}`);
    }

    await sleep(120);
  }

  await stopProcessGracefully(child, LAUNCHER_SHUTDOWN_TIMEOUT_MS, 'launcher');
  throw new Error(`Timed out waiting for launcher startup.\n${outputLines.join('\n')}`);
}

async function waitForWebSocketDebuggerUrl(port) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < REMOTE_DEBUG_TIMEOUT_MS) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) {
        const payload = await response.json();
        if (payload?.webSocketDebuggerUrl) {
          return payload.webSocketDebuggerUrl;
        }
      }
    } catch {
      // ignore startup races
    }

    await sleep(120);
  }

  throw new Error('Timed out waiting for Chrome remote debugging endpoint');
}

class CDPClient {
  constructor(webSocketUrl) {
    this.webSocketUrl = webSocketUrl;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
    this.eventWaiters = [];
  }

  async connect() {
    await new Promise((resolve, reject) => {
      const socket = new WebSocket(this.webSocketUrl);
      this.socket = socket;

      socket.addEventListener('open', () => resolve());
      socket.addEventListener('error', (event) => {
        reject(event.error ?? new Error('CDP websocket error'));
      });
      socket.addEventListener('message', (event) => {
        const payload = JSON.parse(String(event.data));

        if (Number.isFinite(payload.id)) {
          const resolver = this.pending.get(payload.id);
          if (!resolver) {
            return;
          }

          this.pending.delete(payload.id);
          if (payload.error) {
            resolver.reject(new Error(payload.error.message || 'CDP command failed'));
            return;
          }

          resolver.resolve(payload.result ?? {});
          return;
        }

        if (typeof payload.method !== 'string') {
          return;
        }

        for (const waiter of [...this.eventWaiters]) {
          if (waiter.method !== payload.method) {
            continue;
          }
          if (waiter.sessionId && waiter.sessionId !== payload.sessionId) {
            continue;
          }

          this.eventWaiters = this.eventWaiters.filter((entry) => entry !== waiter);
          waiter.resolve(payload.params ?? {});
        }
      });
      socket.addEventListener('close', () => {
        for (const resolver of this.pending.values()) {
          resolver.reject(new Error('CDP websocket closed'));
        }
        this.pending.clear();
      });
    });
  }

  send(method, params = {}, sessionId = null) {
    const id = this.nextId++;
    const message = {
      id,
      method,
      params
    };
    if (sessionId) {
      message.sessionId = sessionId;
    }

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify(message));
    });
  }

  waitForEvent(method, sessionId = null, timeoutMs = 10_000) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.eventWaiters = this.eventWaiters.filter((entry) => entry !== waiter);
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);

      const waiter = {
        method,
        sessionId,
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        }
      };

      this.eventWaiters.push(waiter);
    });
  }

  close() {
    this.socket?.close();
  }
}

async function startHeadlessChrome(chromePath) {
  const port = 9300 + Math.floor(Math.random() * 500);
  const profileDir = path.join(os.tmpdir(), `mm-live-v4-probe-${process.pid}-${Date.now()}`);
  await mkdir(profileDir, { recursive: true });

  const child = spawn(
    chromePath,
    [
      `--remote-debugging-port=${port}`,
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${profileDir}`,
      'about:blank'
    ],
    { stdio: 'ignore' }
  );

  try {
    const webSocketUrl = await waitForWebSocketDebuggerUrl(port);
    return {
      child,
      port,
      profileDir,
      webSocketUrl
    };
  } catch (error) {
    await stopProcessGracefully(child, CHROME_SHUTDOWN_TIMEOUT_MS, 'chrome');
    await removeDirectoryBestEffort(profileDir);
    throw error;
  }
}

async function evaluate(client, sessionId, expression) {
  const result = await client.send(
    'Runtime.evaluate',
    {
      expression,
      returnByValue: true,
      awaitPromise: true
    },
    sessionId
  );

  if (result?.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'Runtime.evaluate failed');
  }

  return result?.result?.value;
}

function buildProbeSnapshotExpression() {
  return `(() => {
    const api = window['${PROBE_API_KEY}'];
    if (api && typeof api.getStateSnapshot === 'function') {
      return {
        source: 'probe-api',
        payload: api.getStateSnapshot({ maxLines: 120 })
      };
    }

    const lines = [...document.querySelectorAll('.cm-line')].map((line, index) => {
      const rect = line.getBoundingClientRect();
      return {
        index,
        text: line.innerText,
        height: Number(rect.height.toFixed(2))
      };
    });
    return {
      source: 'fallback',
      payload: {
        lines
      }
    };
  })()`;
}

function buildSetCursorByLineColumnExpression(lineNumber, column) {
  return `(() => {
    const api = window['${PROBE_API_KEY}'];
    if (!api || typeof api.setCursorByLineColumn !== 'function') {
      return { ok: false, reason: 'missing-probe-api' };
    }
    return api.setCursorByLineColumn(${Math.trunc(lineNumber)}, ${Math.trunc(column)});
  })()`;
}

function buildLoadFixtureExpression(fixtureName) {
  return `(() => {
    const api = window['${PROBE_API_KEY}'];
    if (!api || typeof api.loadFixture !== 'function') {
      return { ok: false, reason: 'missing-probe-api' };
    }
    return api.loadFixture(${JSON.stringify(String(fixtureName ?? 'default-welcome'))}, { anchor: 0 });
  })()`;
}

function buildMoveCursorHorizontalExpression(direction, repeat = 1) {
  return `(() => {
    const api = window['${PROBE_API_KEY}'];
    if (!api || typeof api.moveCursorHorizontal !== 'function') {
      return { ok: false, reason: 'missing-probe-api' };
    }
    return api.moveCursorHorizontal(${Math.trunc(direction)}, ${Math.max(1, Math.trunc(repeat))});
  })()`;
}

function buildWidgetCoordinatesExpression(widgetIndex, xRatio, yRatio) {
  return `(() => {
    const widgets = [...document.querySelectorAll('.mm-live-v4-block-widget')];
    const widget = widgets[${Math.trunc(widgetIndex)}];
    if (!widget) {
      return { ok: false, reason: 'widget-not-found' };
    }

    const rect = widget.getBoundingClientRect();
    return {
      ok: true,
      x: Math.round(rect.left + Math.max(2, Math.min(rect.width - 2, rect.width * ${Number(xRatio)}))),
      y: Math.round(rect.top + Math.max(2, Math.min(rect.height - 2, rect.height * ${Number(yRatio)}))),
      widgetIndex: ${Math.trunc(widgetIndex)}
    };
  })()`;
}

function buildCheckboxCoordinatesExpression(checkboxIndex) {
  return `(() => {
    const checkboxes = [
      ...document.querySelectorAll('.task-list-control input[type="checkbox"]'),
      ...document.querySelectorAll('.mm-live-v4-inline-task-prefix input[type="checkbox"]')
    ];
    const checkbox = checkboxes[${Math.trunc(checkboxIndex)}];
    if (!checkbox) {
      return { ok: false, reason: 'checkbox-not-found', checkboxIndex: ${Math.trunc(checkboxIndex)} };
    }

    const rect = checkbox.getBoundingClientRect();
    return {
      ok: true,
      x: Math.round(rect.left + Math.max(1, Math.min(rect.width - 1, rect.width / 2))),
      y: Math.round(rect.top + Math.max(1, Math.min(rect.height - 1, rect.height / 2))),
      checkboxIndex: ${Math.trunc(checkboxIndex)}
    };
  })()`;
}

function buildTaskCheckboxCoordinatesBySourceExpression(sourceFrom) {
  return `(() => {
    const source = ${Math.trunc(sourceFrom)};
    const checkbox = document.querySelector(
      'input[type="checkbox"][data-task-source-from="' + source + '"]'
    );
    if (!checkbox) {
      return { ok: false, reason: 'checkbox-source-not-found', sourceFrom: source };
    }

    const rect = checkbox.getBoundingClientRect();
    return {
      ok: true,
      x: Math.round(rect.left + Math.max(1, Math.min(rect.width - 1, rect.width / 2))),
      y: Math.round(rect.top + Math.max(1, Math.min(rect.height - 1, rect.height / 2))),
      sourceFrom: source
    };
  })()`;
}

function buildSourceRangeCoordinatesExpression(sourceFrom, sourceTo, xRatio, yRatio) {
  return `(() => {
    const from = ${Math.trunc(sourceFrom)};
    const to = ${Math.trunc(sourceTo)};
    const widgets = [...document.querySelectorAll('.mm-live-v4-block-widget')];
    const widget = widgets.find((entry) => (
      Number(entry.getAttribute('data-src-from')) === from &&
      Number(entry.getAttribute('data-src-to')) === to
    ));
    const sourceLines = [...document.querySelectorAll('.cm-line[data-src-from][data-src-to]')];
    const sourceLine = sourceLines.find((entry) => (
      Number(entry.getAttribute('data-src-from')) === from &&
      Number(entry.getAttribute('data-src-to')) === to
    ));
    const host = widget ?? sourceLine;
    if (!host) {
      return { ok: false, reason: 'source-range-host-not-found', sourceFrom: from, sourceTo: to };
    }

    const rect = host.getBoundingClientRect();
    return {
      ok: true,
      x: Math.round(rect.left + Math.max(2, Math.min(rect.width - 2, rect.width * ${Number(xRatio)}))),
      y: Math.round(rect.top + Math.max(2, Math.min(rect.height - 2, rect.height * ${Number(yRatio)}))),
      sourceFrom: from,
      sourceTo: to,
      hostKind: widget ? 'widget' : 'source-line'
    };
  })()`;
}

function buildHiddenCodeFenceCoordinatesExpression(fenceIndex, xRatio, yRatio) {
  return `(() => {
    const index = ${Math.max(0, Math.trunc(fenceIndex))};
    const lines = [
      ...document.querySelectorAll('.cm-line.mm-live-v4-source-code-fence-hidden[data-src-from][data-src-to]')
    ];
    const line = lines[index];
    if (!line) {
      return { ok: false, reason: 'hidden-code-fence-not-found', fenceIndex: index };
    }

    const from = Number(line.getAttribute('data-src-from'));
    const to = Number(line.getAttribute('data-src-to'));
    const rect = line.getBoundingClientRect();
    if (!Number.isFinite(rect.left) || !Number.isFinite(rect.width) || rect.width <= 0) {
      return { ok: false, reason: 'hidden-code-fence-rect-invalid', fenceIndex: index };
    }

    return {
      ok: true,
      x: Math.round(rect.left + Math.max(2, Math.min(rect.width - 2, rect.width * ${Number(xRatio)}))),
      y: Math.round(rect.top + Math.max(2, Math.min(rect.height - 2, rect.height * ${Number(yRatio)}))),
      fenceIndex: index,
      sourceFrom: Number.isFinite(from) ? Math.trunc(from) : null,
      sourceTo: Number.isFinite(to) ? Math.trunc(to) : null
    };
  })()`;
}

function buildLineNumberCoordinatesExpression(lineNumber, xRatio, yRatio) {
  return `(() => {
    const lineNumber = ${Math.max(1, Math.trunc(lineNumber))};
    const api = window['${PROBE_API_KEY}'];
    const snapshot = api?.getStateSnapshot?.({ maxLines: 240 }) ?? null;
    const lines = Array.isArray(snapshot?.lines) ? snapshot.lines : [];
    const line = lines.find((entry) => Number(entry?.number) === lineNumber);
    if (!line) {
      return { ok: false, reason: 'line-number-not-found', lineNumber };
    }

    const hosts = [...document.querySelectorAll('[data-src-from][data-src-to]')];
    const exactHost = hosts.find((entry) => (
      Number(entry.getAttribute('data-src-from')) === Number(line.from) &&
      Number(entry.getAttribute('data-src-to')) === Number(line.to)
    ));
    if (exactHost) {
      const rect = exactHost.getBoundingClientRect();
      if (!Number.isFinite(rect.left) || !Number.isFinite(rect.width) || rect.width <= 0) {
        return { ok: false, reason: 'line-host-rect-invalid', lineNumber };
      }

      return {
        ok: true,
        x: Math.round(rect.left + Math.max(2, Math.min(rect.width - 2, rect.width * ${Number(xRatio)}))),
        y: Math.round(rect.top + Math.max(2, Math.min(rect.height - 2, rect.height * ${Number(yRatio)}))),
        lineNumber,
        sourceFrom: Number(line.from),
        sourceTo: Number(line.to),
        hostKind: 'exact'
      };
    }

    const coveringWidget = hosts.find((entry) => {
      if (!entry.classList?.contains('mm-live-v4-block-widget')) {
        return false;
      }
      const from = Number(entry.getAttribute('data-src-from'));
      const to = Number(entry.getAttribute('data-src-to'));
      return Number.isFinite(from) && Number.isFinite(to) && from <= Number(line.from) && to >= Number(line.to);
    });

    let hostForRect = coveringWidget;
    let hostKind = 'covering-widget';

    if (!hostForRect) {
      const gutterElements = [...document.querySelectorAll('.cm-lineNumbers .cm-gutterElement')];
      const matchedGutterIndex = gutterElements.findIndex((entry) => Number(entry.innerText) === lineNumber);
      const lineElements = [...document.querySelectorAll('.cm-line')];
      if (matchedGutterIndex >= 0 && matchedGutterIndex < lineElements.length) {
        hostForRect = lineElements[matchedGutterIndex];
        hostKind = 'gutter-index-line';
      }
    }

    if (!hostForRect) {
      return {
        ok: false,
        reason: 'line-host-not-found',
        lineNumber,
        sourceFrom: Number(line.from),
        sourceTo: Number(line.to)
      };
    }

    const rect = hostForRect.getBoundingClientRect();
    if (!Number.isFinite(rect.left) || !Number.isFinite(rect.width) || rect.width <= 0) {
      return { ok: false, reason: 'line-host-rect-invalid', lineNumber };
    }

    const widgetFrom = Number(hostForRect.getAttribute?.('data-src-from'));
    const widgetTo = Number(hostForRect.getAttribute?.('data-src-to'));
    const linesInWidget = lines.filter((entry) => (
      Number(entry?.from) >= widgetFrom && Number(entry?.to) <= widgetTo
    ));
    const lineIndexInWidget = Math.max(0, linesInWidget.findIndex((entry) => Number(entry?.number) === lineNumber));
    const linesInWidgetCount = Math.max(1, linesInWidget.length);
    const yFraction = (lineIndexInWidget + Math.max(0.1, Math.min(0.9, ${Number(yRatio)}))) / linesInWidgetCount;

    return {
      ok: true,
      x: Math.round(rect.left + Math.max(2, Math.min(rect.width - 2, rect.width * ${Number(xRatio)}))),
      y: Math.round(rect.top + Math.max(2, Math.min(rect.height - 2, rect.height * yFraction))),
      lineNumber,
      sourceFrom: Number(line.from),
      sourceTo: Number(line.to),
      hostKind
    };
  })()`;
}

async function dispatchMouseClick(client, sessionId, x, y) {
  await client.send(
    'Input.dispatchMouseEvent',
    {
      type: 'mouseMoved',
      x,
      y,
      buttons: 1
    },
    sessionId
  );
  await client.send(
    'Input.dispatchMouseEvent',
    {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      clickCount: 1
    },
    sessionId
  );
  await client.send(
    'Input.dispatchMouseEvent',
    {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      clickCount: 1
    },
    sessionId
  );
}

const KEY_EVENT_MAP = {
  ArrowLeft: {
    key: 'ArrowLeft',
    code: 'ArrowLeft',
    windowsVirtualKeyCode: 37,
    nativeVirtualKeyCode: 123
  },
  ArrowRight: {
    key: 'ArrowRight',
    code: 'ArrowRight',
    windowsVirtualKeyCode: 39,
    nativeVirtualKeyCode: 124
  },
  ArrowUp: {
    key: 'ArrowUp',
    code: 'ArrowUp',
    windowsVirtualKeyCode: 38,
    nativeVirtualKeyCode: 126
  },
  ArrowDown: {
    key: 'ArrowDown',
    code: 'ArrowDown',
    windowsVirtualKeyCode: 40,
    nativeVirtualKeyCode: 125
  },
  Tab: {
    key: 'Tab',
    code: 'Tab',
    windowsVirtualKeyCode: 9,
    nativeVirtualKeyCode: 48
  }
};

async function dispatchKeyPress(client, sessionId, key) {
  const keyDefinition = KEY_EVENT_MAP[String(key)] ?? null;
  if (!keyDefinition) {
    throw new Error(`Unsupported key press action: ${String(key)}`);
  }

  await client.send(
    'Input.dispatchKeyEvent',
    {
      type: 'rawKeyDown',
      key: keyDefinition.key,
      code: keyDefinition.code,
      windowsVirtualKeyCode: keyDefinition.windowsVirtualKeyCode,
      nativeVirtualKeyCode: keyDefinition.nativeVirtualKeyCode
    },
    sessionId
  );

  await client.send(
    'Input.dispatchKeyEvent',
    {
      type: 'keyUp',
      key: keyDefinition.key,
      code: keyDefinition.code,
      windowsVirtualKeyCode: keyDefinition.windowsVirtualKeyCode,
      nativeVirtualKeyCode: keyDefinition.nativeVirtualKeyCode
    },
    sessionId
  );
}

async function captureScreenshot(client, sessionId, outputPath) {
  const screenshot = await client.send(
    'Page.captureScreenshot',
    {
      format: 'png'
    },
    sessionId
  );

  await writeFile(outputPath, Buffer.from(screenshot.data, 'base64'));
}

function summarizeEvents(records) {
  const counter = new Map();

  for (const record of records) {
    const eventName = readEventName(record);
    counter.set(eventName, (counter.get(eventName) ?? 0) + 1);
  }

  return {
    pointer: {
      fragment: counter.get('pointer.map.fragment') ?? 0,
      fragmentMiss: counter.get('pointer.map.fragment-miss') ?? 0,
      native: counter.get('pointer.map.native') ?? 0,
      activate: counter.get('live-v4.pointer.activate') ?? 0,
      activateMiss: counter.get('block.activate.miss') ?? 0
    },
    cursor: {
      vertical: counter.get('cursor.move.vertical') ?? 0,
      verticalSkipped: counter.get('cursor.move.vertical.skipped') ?? 0,
      verticalBoundary: counter.get('cursor.move.vertical.boundary') ?? 0
    },
    rendering: {
      projectionBuilt: counter.get('live-v4.projection.built') ?? 0,
      activeBlockLarge: counter.get('live-v4.active-block.large') ?? 0
    }
  };
}

function extractImportantEvents(records) {
  return records
    .filter((record) => IMPORTANT_EVENTS.has(readEventName(record)))
    .map((record) => ({
      at: record.entry?.at ?? record.receivedAt ?? null,
      event: readEventName(record),
      data: readEventData(record)
    }));
}

function buildDefaultFixtureSteps() {
  return [
    {
      id: 'load-fixture-default-welcome',
      action: 'load-fixture',
      fixtureName: 'default-welcome'
    },
    {
      id: 'baseline',
      action: 'snapshot'
    },
    {
      id: 'cursor-line-1-col-2',
      action: 'set-cursor',
      lineNumber: 1,
      column: 2
    },
    {
      id: 'cursor-line-3-col-20',
      action: 'set-cursor',
      lineNumber: 3,
      column: 20
    },
    {
      id: 'cursor-line-5-col-12',
      action: 'set-cursor',
      lineNumber: 5,
      column: 12
    },
    {
      id: 'click-source-11-60-left',
      action: 'click-source-range',
      sourceFrom: 11,
      sourceTo: 60,
      xRatio: 0.24,
      yRatio: 0.5
    },
    {
      id: 'cursor-line-5-col-12-reset',
      action: 'set-cursor',
      lineNumber: 5,
      column: 12
    },
    {
      id: 'click-source-11-60-right',
      action: 'click-source-range',
      sourceFrom: 11,
      sourceTo: 60,
      xRatio: 0.78,
      yRatio: 0.5
    }
  ];
}

function buildListFixtureSteps() {
  return [
    {
      id: 'load-fixture-lists-and-tasks',
      action: 'load-fixture',
      fixtureName: 'lists-and-tasks'
    },
    {
      id: 'baseline',
      action: 'snapshot'
    },
    {
      id: 'cursor-line-3-col-8',
      action: 'set-cursor',
      lineNumber: 3,
      column: 8
    },
    {
      id: 'cursor-line-3-col-1-syntax',
      action: 'set-cursor',
      lineNumber: 3,
      column: 1
    },
    {
      id: 'cursor-line-3-col-5-gap-right',
      action: 'set-cursor',
      lineNumber: 3,
      column: 5
    },
    {
      id: 'arrow-right-line-3-gap',
      action: 'move-cursor-horizontal',
      direction: 1
    },
    {
      id: 'arrow-left-line-3-gap',
      action: 'move-cursor-horizontal',
      direction: -1
    },
    {
      id: 'cursor-line-3-col-8-restore',
      action: 'set-cursor',
      lineNumber: 3,
      column: 8
    },
    {
      id: 'cursor-line-5-col-12',
      action: 'set-cursor',
      lineNumber: 5,
      column: 12
    },
    {
      id: 'cursor-line-5-col-1-syntax',
      action: 'set-cursor',
      lineNumber: 5,
      column: 1
    },
    {
      id: 'cursor-line-5-col-7-gap-right',
      action: 'set-cursor',
      lineNumber: 5,
      column: 7
    },
    {
      id: 'arrow-right-line-5-gap',
      action: 'move-cursor-horizontal',
      direction: 1
    },
    {
      id: 'arrow-left-line-5-gap',
      action: 'move-cursor-horizontal',
      direction: -1
    },
    {
      id: 'cursor-line-5-col-12-restore',
      action: 'set-cursor',
      lineNumber: 5,
      column: 12
    },
    {
      id: 'cursor-line-8-col-12',
      action: 'set-cursor',
      lineNumber: 8,
      column: 12
    },
    {
      id: 'cursor-line-8-col-1-syntax',
      action: 'set-cursor',
      lineNumber: 8,
      column: 1
    },
    {
      id: 'cursor-line-8-col-2-gap-right',
      action: 'set-cursor',
      lineNumber: 8,
      column: 2
    },
    {
      id: 'arrow-right-line-8-gap',
      action: 'move-cursor-horizontal',
      direction: 1
    },
    {
      id: 'arrow-left-line-8-gap',
      action: 'move-cursor-horizontal',
      direction: -1
    },
    {
      id: 'cursor-line-8-col-12-restore',
      action: 'set-cursor',
      lineNumber: 8,
      column: 12
    },
    {
      id: 'click-task-source-20',
      action: 'click-task-source',
      sourceFrom: 20
    },
    {
      id: 'cursor-line-6-col-12',
      action: 'set-cursor',
      lineNumber: 6,
      column: 12
    },
    {
      id: 'arrow-up-from-line-6-col-12',
      action: 'press-key',
      key: 'ArrowUp'
    },
    {
      id: 'arrow-down-back-to-line-6-col-12',
      action: 'press-key',
      key: 'ArrowDown'
    },
    {
      id: 'click-line-5-text-area',
      action: 'click-line-number',
      lineNumber: 5,
      xRatio: 0.82,
      yRatio: 0.5
    },
    {
      id: 'click-task-source-87',
      action: 'click-task-source',
      sourceFrom: 87
    },
    {
      id: 'click-line-8-text-area',
      action: 'click-line-number',
      lineNumber: 8,
      xRatio: 0.82,
      yRatio: 0.5
    },
    {
      id: 'cursor-line-9-col-7',
      action: 'set-cursor',
      lineNumber: 9,
      column: 7
    }
  ];
}

function buildMixedInlineFixtureSteps() {
  return [
    {
      id: 'load-fixture-mixed-inline',
      action: 'load-fixture',
      fixtureName: 'mixed-inline'
    },
    {
      id: 'baseline',
      action: 'snapshot'
    },
    {
      id: 'cursor-line-3-col-14',
      action: 'set-cursor',
      lineNumber: 3,
      column: 14
    },
    {
      id: 'cursor-line-6-col-8',
      action: 'set-cursor',
      lineNumber: 6,
      column: 8
    }
  ];
}

function buildEmptyMarkersFixtureSteps() {
  return [
    {
      id: 'load-fixture-empty-markers',
      action: 'load-fixture',
      fixtureName: 'empty-markers'
    },
    {
      id: 'baseline',
      action: 'snapshot'
    },
    {
      id: 'cursor-line-3-col-1',
      action: 'set-cursor',
      lineNumber: 3,
      column: 1
    },
    {
      id: 'cursor-line-4-col-3',
      action: 'set-cursor',
      lineNumber: 4,
      column: 3
    },
    {
      id: 'cursor-line-5-col-1',
      action: 'set-cursor',
      lineNumber: 5,
      column: 1
    },
    {
      id: 'cursor-line-6-col-3',
      action: 'set-cursor',
      lineNumber: 6,
      column: 3
    },
    {
      id: 'cursor-line-7-col-1',
      action: 'set-cursor',
      lineNumber: 7,
      column: 1
    },
    {
      id: 'cursor-line-8-col-3',
      action: 'set-cursor',
      lineNumber: 8,
      column: 3
    }
  ];
}

function buildNestedGuidesFixtureSteps() {
  return [
    {
      id: 'load-fixture-nested-guides',
      action: 'load-fixture',
      fixtureName: 'nested-guides'
    },
    {
      id: 'baseline',
      action: 'snapshot'
    },
    {
      id: 'cursor-line-4-col-1-indent',
      action: 'set-cursor',
      lineNumber: 4,
      column: 1
    },
    {
      id: 'cursor-line-4-col-2-indent',
      action: 'set-cursor',
      lineNumber: 4,
      column: 2
    },
    {
      id: 'cursor-line-4-col-4-pretext',
      action: 'set-cursor',
      lineNumber: 4,
      column: 4
    },
    {
      id: 'arrow-left-line-4-pretext',
      action: 'move-cursor-horizontal',
      direction: -1
    },
    {
      id: 'arrow-left-line-4-pretext-second',
      action: 'move-cursor-horizontal',
      direction: -1
    },
    {
      id: 'cursor-line-5-col-3-indent',
      action: 'set-cursor',
      lineNumber: 5,
      column: 3
    },
    {
      id: 'cursor-line-5-col-10',
      action: 'set-cursor',
      lineNumber: 5,
      column: 10
    }
  ];
}

function buildSingleBulletFixtureSteps() {
  return [
    {
      id: 'load-fixture-single-bullet',
      action: 'load-fixture',
      fixtureName: 'single-bullet'
    },
    {
      id: 'baseline',
      action: 'snapshot'
    },
    {
      id: 'cursor-line-3-col-2-pretext',
      action: 'set-cursor',
      lineNumber: 3,
      column: 2
    },
    {
      id: 'arrow-left-line-3-pretext',
      action: 'move-cursor-horizontal',
      direction: -1
    },
    {
      id: 'arrow-left-line-3-pretext-second',
      action: 'move-cursor-horizontal',
      direction: -1
    }
  ];
}

function buildSingleNestedBulletFixtureSteps() {
  return [
    {
      id: 'load-fixture-single-nested-bullet',
      action: 'load-fixture',
      fixtureName: 'single-nested-bullet'
    },
    {
      id: 'baseline',
      action: 'snapshot'
    },
    {
      id: 'cursor-line-3-col-4-pretext',
      action: 'set-cursor',
      lineNumber: 3,
      column: 4
    },
    {
      id: 'arrow-left-line-3-pretext',
      action: 'move-cursor-horizontal',
      direction: -1
    },
    {
      id: 'arrow-left-line-3-pretext-second',
      action: 'move-cursor-horizontal',
      direction: -1
    }
  ];
}

function buildCodeBlocksFixtureSteps() {
  return [
    {
      id: 'load-fixture-code-blocks',
      action: 'load-fixture',
      fixtureName: 'code-blocks'
    },
    {
      id: 'baseline',
      action: 'snapshot'
    },
    {
      id: 'click-hidden-fence-open',
      action: 'click-hidden-code-fence',
      fenceIndex: 0,
      xRatio: 0.18,
      yRatio: 0.5
    },
    {
      id: 'cursor-line-3-col-8-intro-after-fence-clicks',
      action: 'set-cursor',
      lineNumber: 3,
      column: 8
    },
    {
      id: 'cursor-line-3-col-8-intro',
      action: 'set-cursor',
      lineNumber: 3,
      column: 8
    },
    {
      id: 'cursor-line-4-col-0-before-first-fence',
      action: 'set-cursor',
      lineNumber: 4,
      column: 0
    },
    {
      id: 'arrow-down-into-first-fence',
      action: 'press-key',
      key: 'ArrowDown'
    },
    {
      id: 'cursor-line-5-col-1-fence-open',
      action: 'set-cursor',
      lineNumber: 5,
      column: 1
    },
    {
      id: 'cursor-line-5-col-5-fence-open-right-edge',
      action: 'set-cursor',
      lineNumber: 5,
      column: 5
    },
    {
      id: 'arrow-left-line-5-fence-open',
      action: 'press-key',
      key: 'ArrowLeft'
    },
    {
      id: 'arrow-left-line-5-fence-open-second',
      action: 'press-key',
      key: 'ArrowLeft'
    },
    {
      id: 'cursor-line-6-col-3-code-content',
      action: 'set-cursor',
      lineNumber: 6,
      column: 3
    },
    {
      id: 'cursor-line-6-col-0-code-content-start',
      action: 'set-cursor',
      lineNumber: 6,
      column: 0
    },
    {
      id: 'tab-line-6-code-content-start',
      action: 'press-key',
      key: 'Tab'
    },
    {
      id: 'cursor-line-10-col-1-fence-close',
      action: 'set-cursor',
      lineNumber: 10,
      column: 1
    },
    {
      id: 'click-visible-fence-close-line-10',
      action: 'click-line-number',
      lineNumber: 10,
      xRatio: 0.24,
      yRatio: 0.5
    },
    {
      id: 'cursor-line-10-col-3-fence-close-right-edge',
      action: 'set-cursor',
      lineNumber: 10,
      column: 3
    },
    {
      id: 'arrow-left-line-10-fence-close',
      action: 'press-key',
      key: 'ArrowLeft'
    },
    {
      id: 'cursor-line-12-col-10-middle-para',
      action: 'set-cursor',
      lineNumber: 12,
      column: 10
    },
    {
      id: 'cursor-line-13-col-0-before-second-fence',
      action: 'set-cursor',
      lineNumber: 13,
      column: 0
    },
    {
      id: 'arrow-down-into-second-fence',
      action: 'press-key',
      key: 'ArrowDown'
    },
    {
      id: 'cursor-line-14-col-1-fence-open-plain',
      action: 'set-cursor',
      lineNumber: 14,
      column: 1
    },
    {
      id: 'cursor-line-14-col-3-fence-open-plain-right-edge',
      action: 'set-cursor',
      lineNumber: 14,
      column: 3
    },
    {
      id: 'arrow-left-line-14-fence-open-plain',
      action: 'press-key',
      key: 'ArrowLeft'
    },
    {
      id: 'cursor-line-15-col-5-code-plain-content',
      action: 'set-cursor',
      lineNumber: 15,
      column: 5
    },
    {
      id: 'cursor-line-18-col-6-outro',
      action: 'set-cursor',
      lineNumber: 18,
      column: 6
    }
  ];
}

function readStepSnapshotPayload(step) {
  if (step?.actionResult?.snapshot?.ready) {
    return step.actionResult.snapshot;
  }
  if (step?.snapshot?.payload?.ready) {
    return step.snapshot.payload;
  }
  return null;
}

function findStepResult(steps, stepId) {
  return (Array.isArray(steps) ? steps : []).find((step) => step?.id === stepId) ?? null;
}

function readStepActiveBlockType(step) {
  const snapshot = readStepSnapshotPayload(step);
  return snapshot?.liveState?.activeBlockType ?? null;
}

function readStepSelection(step) {
  const snapshot = readStepSnapshotPayload(step);
  return snapshot?.selection ?? null;
}

function readSelectionColumn(selection) {
  if (
    !selection ||
    !Number.isFinite(selection.head) ||
    !Number.isFinite(selection.lineFrom)
  ) {
    return null;
  }
  return Math.max(0, Math.trunc(selection.head) - Math.trunc(selection.lineFrom));
}

function readStepHasFocus(step) {
  const snapshot = readStepSnapshotPayload(step);
  return snapshot?.hasFocus === true;
}

function readStepCursorVisible(step) {
  const snapshot = readStepSnapshotPayload(step);
  const cursorRect = snapshot?.cursorRect;
  return Boolean(
    cursorRect &&
    Number.isFinite(cursorRect.height) &&
    Number.isFinite(cursorRect.width) &&
    cursorRect.height > 0 &&
    cursorRect.width > 0
  );
}

function stepHasDomLineClass(step, classToken) {
  if (typeof classToken !== 'string' || classToken.length === 0) {
    return false;
  }
  const snapshot = readStepSnapshotPayload(step);
  const domLines = Array.isArray(snapshot?.domLines) ? snapshot.domLines : [];
  return domLines.some((line) => typeof line?.className === 'string' && line.className.includes(classToken));
}

function stepLineTextMatches(step, lineNumber, expectedText) {
  const snapshot = readStepSnapshotPayload(step);
  const lines = Array.isArray(snapshot?.lines) ? snapshot.lines : [];
  const line = lines.find((entry) => Number(entry?.number) === Number(lineNumber));
  if (!line) {
    return false;
  }
  return String(line.text ?? '') === String(expectedText ?? '');
}

function buildCodeBlockAssertions(stepResults, fixtureName) {
  if (fixtureName !== 'code-blocks') {
    return {};
  }

  const codeContentStep = findStepResult(stepResults, 'cursor-line-6-col-3-code-content');
  const plainCodeContentStep = findStepResult(stepResults, 'cursor-line-15-col-5-code-plain-content');
  const blankLineStep = findStepResult(stepResults, 'cursor-line-18-col-6-outro');
  const fenceOpenStep = findStepResult(stepResults, 'cursor-line-5-col-1-fence-open');
  const fenceCloseStep = findStepResult(stepResults, 'cursor-line-10-col-1-fence-close');
  const visibleFenceCloseClickStep = findStepResult(stepResults, 'click-visible-fence-close-line-10');
  const plainFenceOpenStep = findStepResult(stepResults, 'cursor-line-14-col-1-fence-open-plain');
  const hiddenFenceClickOpenStep = findStepResult(stepResults, 'click-hidden-fence-open');
  const arrowDownFirstFenceStep = findStepResult(stepResults, 'arrow-down-into-first-fence');
  const arrowDownSecondFenceStep = findStepResult(stepResults, 'arrow-down-into-second-fence');
  const tabCodeContentStep = findStepResult(stepResults, 'tab-line-6-code-content-start');

  const cursorStepIds = [
    'cursor-line-5-col-1-fence-open',
    'cursor-line-5-col-5-fence-open-right-edge',
    'arrow-left-line-5-fence-open',
    'arrow-left-line-5-fence-open-second',
    'cursor-line-6-col-3-code-content',
    'tab-line-6-code-content-start',
    'cursor-line-10-col-1-fence-close',
    'cursor-line-10-col-3-fence-close-right-edge',
    'arrow-left-line-10-fence-close',
    'cursor-line-14-col-1-fence-open-plain',
    'cursor-line-14-col-3-fence-open-plain-right-edge',
    'arrow-left-line-14-fence-open-plain',
    'cursor-line-15-col-5-code-plain-content'
  ];

  const cursorVisibleAcrossFenceTraversal = cursorStepIds.every((stepId) => {
    const step = findStepResult(stepResults, stepId);
    return readStepCursorVisible(step);
  });

  const firstFenceSelection = readStepSelection(arrowDownFirstFenceStep);
  const secondFenceSelection = readStepSelection(arrowDownSecondFenceStep);
  const arrowDownIntoFirstFenceAtLineEnd = Boolean(
    firstFenceSelection &&
    Number(firstFenceSelection.lineNumber) === 5 &&
    Number(firstFenceSelection.head) === Number(firstFenceSelection.lineTo)
  );
  const arrowDownIntoSecondFenceAtLineEnd = Boolean(
    secondFenceSelection &&
    Number(secondFenceSelection.lineNumber) === 14 &&
    Number(secondFenceSelection.head) === Number(secondFenceSelection.lineTo)
  );
  const codeLineIndentedByTab = (() => {
    const snapshot = readStepSnapshotPayload(tabCodeContentStep);
    const lines = Array.isArray(snapshot?.lines) ? snapshot.lines : [];
    const line = lines.find((entry) => Number(entry?.number) === 6);
    const text = String(line?.text ?? '');
    return /^\s+const value = 1;$/.test(text);
  })();
  const hiddenFenceClickOpenSelection = readStepSelection(hiddenFenceClickOpenStep);
  const visibleFenceCloseClickSelection = readStepSelection(visibleFenceCloseClickStep);
  const hiddenFenceOpenClickAtLineEnd = Boolean(
    hiddenFenceClickOpenSelection &&
    Number(hiddenFenceClickOpenSelection.lineNumber) === 5 &&
    Number(hiddenFenceClickOpenSelection.head) === Number(hiddenFenceClickOpenSelection.lineTo)
  );
  const visibleFenceCloseClickAtLineEnd = Boolean(
    visibleFenceCloseClickSelection &&
    Number(visibleFenceCloseClickSelection.lineNumber) === 10 &&
    Number(visibleFenceCloseClickSelection.head) === Number(visibleFenceCloseClickSelection.lineTo)
  );

  return {
    hiddenFenceOpenClickAtLineEnd,
    visibleFenceCloseClickAtLineEnd,
    codeActivationOnFenceOpen: readStepActiveBlockType(fenceOpenStep) === 'code',
    codeActivationOnFenceClose: readStepActiveBlockType(fenceCloseStep) === 'code',
    codeActivationOnContent: readStepActiveBlockType(codeContentStep) === 'code',
    codeActivationOnPlainFence: readStepActiveBlockType(plainFenceOpenStep) === 'code',
    codeActivationOnPlainContent: readStepActiveBlockType(plainCodeContentStep) === 'code',
    blankLineAfterFenceHasNoActiveBlock: readStepActiveBlockType(blankLineStep) == null,
    blankLineAfterFenceNotCode: readStepActiveBlockType(blankLineStep) !== 'code',
    cursorVisibleAcrossFenceTraversal,
    arrowDownIntoFirstFenceAtLineEnd,
    arrowDownIntoSecondFenceAtLineEnd,
    tabRetainsEditorFocusInCodeBlock: readStepHasFocus(tabCodeContentStep),
    tabIndentsCodeContentInsteadOfMovingUiFocus: codeLineIndentedByTab,
    activeCodeSourceLineStyleApplied: (
      stepHasDomLineClass(codeContentStep, 'mm-live-v4-source-code-line') &&
      stepHasDomLineClass(plainCodeContentStep, 'mm-live-v4-source-code-line')
    ),
    fenceSourceTextPreserved: (
      stepLineTextMatches(fenceOpenStep, 5, '```js') &&
      stepLineTextMatches(fenceCloseStep, 10, '```') &&
      stepLineTextMatches(plainFenceOpenStep, 14, '```')
    )
  };
}

function buildDefaultFixtureAssertions(stepResults, fixtureName) {
  if (fixtureName !== 'default-welcome') {
    return {};
  }

  const leftClickStep = findStepResult(stepResults, 'click-source-11-60-left');
  const rightClickStep = findStepResult(stepResults, 'click-source-11-60-right');
  const leftSelection = readStepSelection(leftClickStep);
  const rightSelection = readStepSelection(rightClickStep);
  const leftColumn = readSelectionColumn(leftSelection);
  const rightColumn = readSelectionColumn(rightSelection);

  return {
    pointerClickLeftResolvedInsideLine: Number.isFinite(leftColumn) && leftColumn > 0,
    pointerClickRightResolvedInsideLine: Number.isFinite(rightColumn) && rightColumn > 0,
    pointerClickRightLandsAfterLeft: (
      Number.isFinite(leftColumn) &&
      Number.isFinite(rightColumn) &&
      rightColumn >= leftColumn + 2
    )
  };
}

function buildListFixtureAssertions(stepResults, fixtureName) {
  if (fixtureName !== 'lists-and-tasks') {
    return {};
  }

  const arrowUpStep = findStepResult(stepResults, 'arrow-up-from-line-6-col-12');
  const arrowDownStep = findStepResult(stepResults, 'arrow-down-back-to-line-6-col-12');
  const clickLine5Step = findStepResult(stepResults, 'click-line-5-text-area');
  const clickLine8Step = findStepResult(stepResults, 'click-line-8-text-area');

  const arrowUpSelection = readStepSelection(arrowUpStep);
  const arrowDownSelection = readStepSelection(arrowDownStep);
  const clickLine5Selection = readStepSelection(clickLine5Step);
  const clickLine8Selection = readStepSelection(clickLine8Step);

  const arrowUpColumn = readSelectionColumn(arrowUpSelection);
  const arrowDownColumn = readSelectionColumn(arrowDownSelection);
  const clickLine5Column = readSelectionColumn(clickLine5Selection);
  const clickLine8Column = readSelectionColumn(clickLine8Selection);

  return {
    arrowUpFromNestedListKeepsColumn: (
      Number(arrowUpSelection?.lineNumber) === 5 &&
      Number.isFinite(arrowUpColumn) &&
      arrowUpColumn >= 10
    ),
    arrowDownFromNestedListKeepsColumn: (
      Number(arrowDownSelection?.lineNumber) === 6 &&
      Number.isFinite(arrowDownColumn) &&
      arrowDownColumn >= 10
    ),
    clickLine5TextDoesNotJumpToLineStart: (
      Number.isFinite(clickLine5Column) &&
      clickLine5Column > 2 &&
      Number(clickLine5Selection?.head) !== Number(arrowDownSelection?.head)
    ),
    clickLine8TextDoesNotJumpToLineStart: (
      Number.isFinite(clickLine8Column) &&
      clickLine8Column > 2 &&
      Number(clickLine8Selection?.head) !== Number(clickLine5Selection?.head)
    )
  };
}

function buildStepDefinitions(fixtureName) {
  if (fixtureName === 'lists-and-tasks') {
    return buildListFixtureSteps();
  }
  if (fixtureName === 'mixed-inline') {
    return buildMixedInlineFixtureSteps();
  }
  if (fixtureName === 'empty-markers') {
    return buildEmptyMarkersFixtureSteps();
  }
  if (fixtureName === 'nested-guides') {
    return buildNestedGuidesFixtureSteps();
  }
  if (fixtureName === 'single-bullet') {
    return buildSingleBulletFixtureSteps();
  }
  if (fixtureName === 'single-nested-bullet') {
    return buildSingleNestedBulletFixtureSteps();
  }
  if (fixtureName === 'code-blocks') {
    return buildCodeBlocksFixtureSteps();
  }
  return buildDefaultFixtureSteps();
}

async function runProbe({
  client,
  sessionId,
  artifactDir,
  fixtureName
}) {
  const stepResults = [];
  const steps = buildStepDefinitions(fixtureName);

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const screenshotName = `${String(index).padStart(2, '0')}-${sanitizeLabel(step.id)}.png`;
    const screenshotPath = path.join(artifactDir, screenshotName);

    let actionResult = null;

    if (step.action === 'set-cursor') {
      actionResult = await evaluate(
        client,
        sessionId,
        buildSetCursorByLineColumnExpression(step.lineNumber, step.column)
      );
    } else if (step.action === 'load-fixture') {
      actionResult = await evaluate(
        client,
        sessionId,
        buildLoadFixtureExpression(step.fixtureName ?? fixtureName ?? 'default-welcome')
      );
    } else if (step.action === 'click-widget') {
      const coordinates = await evaluate(
        client,
        sessionId,
        buildWidgetCoordinatesExpression(step.widgetIndex, step.xRatio, step.yRatio)
      );
      actionResult = coordinates;
      if (coordinates?.ok) {
        await dispatchMouseClick(client, sessionId, coordinates.x, coordinates.y);
      }
    } else if (step.action === 'click-source-range') {
      const coordinates = await evaluate(
        client,
        sessionId,
        buildSourceRangeCoordinatesExpression(step.sourceFrom, step.sourceTo, step.xRatio, step.yRatio)
      );
      actionResult = coordinates;
      if (coordinates?.ok) {
        await dispatchMouseClick(client, sessionId, coordinates.x, coordinates.y);
      }
    } else if (step.action === 'click-checkbox') {
      const coordinates = await evaluate(
        client,
        sessionId,
        buildCheckboxCoordinatesExpression(step.checkboxIndex)
      );
      actionResult = coordinates;
      if (coordinates?.ok) {
        await dispatchMouseClick(client, sessionId, coordinates.x, coordinates.y);
      }
    } else if (step.action === 'click-task-source') {
      const coordinates = await evaluate(
        client,
        sessionId,
        buildTaskCheckboxCoordinatesBySourceExpression(step.sourceFrom)
      );
      actionResult = coordinates;
      if (coordinates?.ok) {
        await dispatchMouseClick(client, sessionId, coordinates.x, coordinates.y);
      }
    } else if (step.action === 'click-hidden-code-fence') {
      const coordinates = await evaluate(
        client,
        sessionId,
        buildHiddenCodeFenceCoordinatesExpression(step.fenceIndex, step.xRatio ?? 0.25, step.yRatio ?? 0.5)
      );
      actionResult = coordinates;
      if (coordinates?.ok) {
        await dispatchMouseClick(client, sessionId, coordinates.x, coordinates.y);
      }
    } else if (step.action === 'click-line-number') {
      const coordinates = await evaluate(
        client,
        sessionId,
        buildLineNumberCoordinatesExpression(step.lineNumber, step.xRatio ?? 0.25, step.yRatio ?? 0.5)
      );
      actionResult = coordinates;
      if (coordinates?.ok) {
        await dispatchMouseClick(client, sessionId, coordinates.x, coordinates.y);
      }
    } else if (step.action === 'move-cursor-horizontal') {
      actionResult = await evaluate(
        client,
        sessionId,
        buildMoveCursorHorizontalExpression(step.direction, step.repeat ?? 1)
      );
    } else if (step.action === 'press-key') {
      await dispatchKeyPress(client, sessionId, step.key);
      actionResult = {
        ok: true,
        key: step.key
      };
    }

    await sleep(STEP_WAIT_MS);
    const snapshot = await evaluate(client, sessionId, buildProbeSnapshotExpression());
    await captureScreenshot(client, sessionId, screenshotPath);

    stepResults.push({
      id: step.id,
      action: step.action,
      actionResult,
      screenshot: screenshotName,
      snapshot
    });
  }

  return stepResults;
}

async function maybeReadLauncherLog(logFilePath, logsDir) {
  const resolvedLogPath = logFilePath ?? await findLatestLogFile(logsDir);
  if (!resolvedLogPath) {
    return {
      logFilePath: null,
      records: []
    };
  }

  let content = '';
  try {
    content = await readFile(resolvedLogPath, 'utf8');
  } catch {
    content = '';
  }

  return {
    logFilePath: resolvedLogPath,
    records: parseJsonLines(content)
  };
}

async function main() {
  const options = parseCliArguments(process.argv);
  const projectRoot = process.cwd();
  const logsDir = path.join(projectRoot, 'logs');
  const artifactRoot = options.outputDir
    ? (path.isAbsolute(options.outputDir) ? options.outputDir : path.join(projectRoot, options.outputDir))
    : DEFAULT_OUTPUT_ROOT;
  const artifactDir = path.join(artifactRoot, `live-v4-probe-${formatTimestampForPath()}`);
  await mkdir(artifactDir, { recursive: true });

  let launcher = null;
  let launchUrl = options.url;
  let launcherLogFilePath = null;
  let launcherOutput = [];

  let chrome = null;
  let cdpClient = null;

  try {
    if (!launchUrl) {
      launcher = await startLauncher(projectRoot);
      launchUrl = launcher.launchUrl;
      launcherLogFilePath = launcher.logFilePath;
      launcherOutput = launcher.outputLines;
    }

    chrome = await startHeadlessChrome(options.chromePath);
    cdpClient = new CDPClient(chrome.webSocketUrl);
    await cdpClient.connect();

    const { targetId } = await cdpClient.send('Target.createTarget', { url: launchUrl });
    const { sessionId } = await cdpClient.send('Target.attachToTarget', {
      targetId,
      flatten: true
    });

    await cdpClient.send('Page.enable', {}, sessionId);
    await cdpClient.send('Runtime.enable', {}, sessionId);
    await cdpClient.send('DOM.enable', {}, sessionId);

    await Promise.race([
      cdpClient.waitForEvent('Page.loadEventFired', sessionId, 10_000),
      sleep(4_000)
    ]);

    await sleep(PAGE_WAIT_MS);

    const stepResults = await runProbe({
      client: cdpClient,
      sessionId,
      artifactDir,
      fixtureName: options.fixture
    });

    await sleep(700);

    const { logFilePath, records } = await maybeReadLauncherLog(launcherLogFilePath, logsDir);
    const eventSummary = summarizeEvents(records);
    const importantEvents = extractImportantEvents(records);

    if (logFilePath) {
      const copiedLogPath = path.join(artifactDir, 'launcher-live-debug.jsonl');
      try {
        await copyFile(logFilePath, copiedLogPath);
      } catch {
        // ignore copy failures and continue with the report
      }
    }

    const report = {
      generatedAt: new Date().toISOString(),
      artifactDir,
      launch: {
        url: launchUrl,
        launcherLogFilePath: logFilePath,
        launcherOutput
      },
      fixture: options.fixture,
      steps: stepResults,
      eventSummary,
      assertions: {
        pointerActivationObserved: eventSummary.pointer.activate > 0,
        noPointerActivateMiss: eventSummary.pointer.activateMiss === 0,
        fragmentMappingObserved: eventSummary.pointer.fragment > 0,
        ...buildDefaultFixtureAssertions(stepResults, options.fixture),
        ...buildListFixtureAssertions(stepResults, options.fixture),
        ...buildCodeBlockAssertions(stepResults, options.fixture)
      }
    };

    await writeFile(path.join(artifactDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    await writeFile(path.join(artifactDir, 'important-events.json'), `${JSON.stringify(importantEvents, null, 2)}\n`, 'utf8');

    console.log(`Live-v4 probe artifacts written to: ${artifactDir}`);
    console.log(`Launch URL: ${launchUrl}`);
    if (logFilePath) {
      console.log(`Launcher log: ${logFilePath}`);
    }
  } finally {
    cdpClient?.close();

    if (chrome) {
      await stopProcessGracefully(chrome.child, CHROME_SHUTDOWN_TIMEOUT_MS, 'chrome');
      await removeDirectoryBestEffort(chrome.profileDir);
    }

    if (launcher && !options.keepLauncherAlive) {
      await stopProcessGracefully(launcher.child, LAUNCHER_SHUTDOWN_TIMEOUT_MS, 'launcher');
    }
  }
}

main().catch((error) => {
  console.error(
    'live-v4 probe failed:',
    error instanceof Error ? error.stack ?? error.message : String(error)
  );
  process.exit(1);
});
