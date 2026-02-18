import test from 'node:test';
import assert from 'node:assert/strict';
import { createLauncherBridge } from '../src/telemetry/launcherBridge.js';

function createWindowStub() {
  return {
    location: { pathname: '/workspace' },
    document: { visibilityState: 'visible' },
    setTimeout() {
      return 1;
    },
    clearTimeout() {},
    setInterval() {
      return 1;
    },
    clearInterval() {},
    addEventListener() {}
  };
}

test('launcher bridge queues live-debug entries and flushes batches', async () => {
  const subscriptions = [];
  const fetchCalls = [];
  const windowObject = createWindowStub();

  const bridge = createLauncherBridge({
    launcherToken: 'abc123',
    liveDebug: {
      subscribe(listener) {
        subscriptions.push(listener);
      }
    },
    windowObject,
    navigatorObject: { sendBeacon() { return true; } },
    fetchImpl: async (url, options) => {
      fetchCalls.push({ url, options });
      return { ok: true, status: 200 };
    },
    uploadDebounceMs: 50,
    uploadMaxBatch: 200,
    uploadMaxQueue: 4000,
    getCurrentPath: () => 'notes/demo.md',
    getViewMode: () => 'live',
    getAppPath: () => '/workspace'
  });

  bridge.connectLiveDebugLogger();
  subscriptions[0]({
    type: 'entry',
    entry: {
      at: new Date().toISOString(),
      scope: 'live-preview',
      level: 'info',
      event: 'sample',
      data: {}
    }
  });

  assert.equal(bridge.getQueuedEntryCount(), 1);
  await bridge.flushLiveDebugUploads('manual');
  assert.equal(bridge.getQueuedEntryCount(), 0);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, '/__launcher/live-debug?token=abc123');
  const payload = JSON.parse(fetchCalls[0].options.body);
  assert.equal(payload.reason, 'manual');
  assert.equal(payload.entries.length, 1);
  assert.equal(payload.entries[0].currentPath, 'notes/demo.md');
  assert.equal(payload.entries[0].viewMode, 'live');
});

test('notifyLauncher posts launcher heartbeat endpoint with token', async () => {
  const fetchCalls = [];
  const bridge = createLauncherBridge({
    launcherToken: 'token-42',
    windowObject: createWindowStub(),
    navigatorObject: { sendBeacon() { return true; } },
    fetchImpl: async (url, options) => {
      fetchCalls.push({ url, options });
      return { ok: true, status: 200 };
    }
  });

  bridge.notifyLauncher('/__launcher/heartbeat');

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, '/__launcher/heartbeat?token=token-42');
  assert.equal(fetchCalls[0].options.method, 'POST');
  assert.equal(fetchCalls[0].options.body, '1');
  assert.equal(fetchCalls[0].options.headers['content-type'], 'text/plain');
});
