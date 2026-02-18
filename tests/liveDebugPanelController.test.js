import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLiveDebugPanelController,
  formatLiveDebugEntry
} from '../src/telemetry/liveDebugPanelController.js';

function createElementMock(tagName) {
  const attributes = new Map();
  const listeners = new Map();

  return {
    tagName: String(tagName).toUpperCase(),
    id: '',
    className: '',
    textContent: '',
    type: '',
    value: '',
    children: [],
    append(...nodes) {
      this.children.push(...nodes);
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    getAttribute(name) {
      return attributes.get(name) ?? null;
    },
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    trigger(type, event = {}) {
      listeners.get(type)?.(event);
    }
  };
}

function createDocumentMock() {
  return {
    createElement(tagName) {
      return createElementMock(tagName);
    }
  };
}

function createLiveDebugMock({ level = 'off', entries = [] } = {}) {
  let currentLevel = level;
  const sink = [...entries];
  const subscribers = [];

  return {
    getLevel() {
      return currentLevel;
    },
    setLevel(nextLevel) {
      currentLevel = String(nextLevel);
      subscribers.forEach((listener) => listener({ type: 'level', level: currentLevel }));
      return currentLevel;
    },
    clearEntries() {
      sink.length = 0;
      subscribers.forEach((listener) => listener({ type: 'clear' }));
    },
    getEntries() {
      return sink.slice();
    },
    subscribe(listener) {
      subscribers.push(listener);
      return () => {};
    }
  };
}

function tick() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

test('formatLiveDebugEntry includes uppercase level and JSON payload', () => {
  const line = formatLiveDebugEntry({
    at: '2026-01-01T00:00:00.000Z',
    level: 'info',
    event: 'snapshot.editor',
    data: { mode: 'live' }
  });

  assert.equal(
    line,
    '2026-01-01T00:00:00.000Z INFO snapshot.editor {"mode":"live"}'
  );
});

test('mountLiveDebugPanel renders panel state and wires controls', async () => {
  let mountedPanel = null;
  const statusMessages = [];
  const snapshotReasons = [];
  const copiedPayloads = [];
  const liveDebug = createLiveDebugMock({
    level: 'trace',
    entries: [
      {
        at: '2026-01-01T00:00:00.000Z',
        level: 'trace',
        event: 'selection.changed',
        data: { head: 9 }
      }
    ]
  });
  const appShellElement = createElementMock('div');
  const statusElement = {
    insertAdjacentElement(position, element) {
      assert.equal(position, 'afterend');
      mountedPanel = element;
    }
  };
  const panelController = createLiveDebugPanelController({
    appShellElement,
    statusElement,
    liveDebug,
    isDevBuild: false,
    setLiveDebugLevel: (nextLevel) => liveDebug.setLevel(nextLevel),
    setStatus: (message, asError = false) => statusMessages.push({ message, asError }),
    captureLiveDebugSnapshot: (reason) => snapshotReasons.push(reason),
    navigatorObject: {
      clipboard: {
        async writeText(payload) {
          copiedPayloads.push(payload);
        }
      }
    },
    documentObject: createDocumentMock()
  });

  panelController.mountLiveDebugPanel();

  assert.ok(mountedPanel);
  assert.equal(mountedPanel.getAttribute('open'), 'open');

  const summary = mountedPanel.children[0];
  const controls = mountedPanel.children[1];
  const log = mountedPanel.children[2];
  const badge = summary.children[1];
  const levelSelect = controls.children[1];
  const clearButton = controls.children[2];
  const copyButton = controls.children[3];
  const snapshotButton = controls.children[4];

  assert.equal(badge.textContent, 'TRACE');
  assert.match(log.textContent, /selection\.changed/);

  levelSelect.value = 'warn';
  levelSelect.trigger('change');
  assert.equal(badge.textContent, 'WARN');
  assert.equal(statusMessages.at(-1).message, 'Live debug level set to warn.');

  clearButton.trigger('click');
  assert.equal(log.textContent, 'No live-view events captured yet.');

  copyButton.trigger('click');
  await tick();
  assert.equal(copiedPayloads.length, 1);
  assert.equal(statusMessages.at(-1).message, 'Copied 0 live debug entries.');

  snapshotButton.trigger('click');
  assert.deepEqual(snapshotReasons, ['manual-panel']);
  assert.equal(statusMessages.at(-1).message, 'Captured live debug snapshot.');
});

test('copy control reports clipboard failures via status', async () => {
  let mountedPanel = null;
  const statusMessages = [];
  const panelController = createLiveDebugPanelController({
    appShellElement: createElementMock('div'),
    statusElement: {
      insertAdjacentElement(_position, element) {
        mountedPanel = element;
      }
    },
    liveDebug: createLiveDebugMock({
      level: 'off',
      entries: []
    }),
    setStatus: (message, asError = false) => statusMessages.push({ message, asError }),
    navigatorObject: {
      clipboard: {
        async writeText() {
          throw new Error('clipboard-blocked');
        }
      }
    },
    documentObject: createDocumentMock()
  });

  panelController.mountLiveDebugPanel();
  const copyButton = mountedPanel.children[1].children[3];
  copyButton.trigger('click');
  await tick();

  assert.equal(statusMessages.length, 1);
  assert.equal(
    statusMessages[0].message,
    'Could not copy live debug entries: clipboard-blocked'
  );
  assert.equal(statusMessages[0].asError, true);
});
