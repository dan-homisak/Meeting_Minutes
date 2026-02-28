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
    await rm(profileDir, { recursive: true, force: true });
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
    if (!widget) {
      return { ok: false, reason: 'source-range-widget-not-found', sourceFrom: from, sourceTo: to };
    }

    const rect = widget.getBoundingClientRect();
    return {
      ok: true,
      x: Math.round(rect.left + Math.max(2, Math.min(rect.width - 2, rect.width * ${Number(xRatio)}))),
      y: Math.round(rect.top + Math.max(2, Math.min(rect.height - 2, rect.height * ${Number(yRatio)}))),
      sourceFrom: from,
      sourceTo: to
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
      id: 'click-task-source-87',
      action: 'click-task-source',
      sourceFrom: 87
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
    } else if (step.action === 'move-cursor-horizontal') {
      actionResult = await evaluate(
        client,
        sessionId,
        buildMoveCursorHorizontalExpression(step.direction, step.repeat ?? 1)
      );
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
        fragmentMappingObserved: eventSummary.pointer.fragment > 0
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
      await rm(chrome.profileDir, { recursive: true, force: true });
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
