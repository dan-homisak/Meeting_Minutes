import test from 'node:test';
import assert from 'node:assert/strict';
import { createTelemetryBootstrap } from '../src/bootstrap/createTelemetryBootstrap.js';

test('createTelemetryBootstrap wires launcher, snapshot, and debug panel controllers', () => {
  const launcherCalls = {
    connect: 0,
    initialize: 0,
    heartbeat: 0
  };
  const launcherFactoryCalls = [];
  const snapshotFactoryCalls = [];
  const debugPanelFactoryCalls = [];

  const bootstrap = createTelemetryBootstrap({
    app: {
      currentPath: 'notes/test.md',
      viewMode: 'live'
    },
    launcherToken: 'token-123',
    liveDebug: { id: 'live-debug' },
    liveDebugDiagnostics: { id: 'diagnostics' },
    liveDebugInputTtlMs: 777,
    heartbeatMs: 5000,
    uploadDebounceMs: 1000,
    uploadMaxBatch: 250,
    uploadMaxQueue: 5000,
    findBlockContainingPosition: (blocks, position) => ({ blocks, position }),
    findNearestBlockForPosition: (blocks, position) => ({ blocks, position }),
    readLivePreviewState: (state) => ({ state }),
    readDomSelectionForLog: (targetWindow) => ({ targetWindow }),
    appShellElement: { id: 'app-shell' },
    statusElement: { id: 'status' },
    isDevBuild: true,
    setLiveDebugLevel: (level) => level,
    setStatus: (message) => message,
    captureLiveDebugSnapshot: (reason) => reason,
    getEditorView: () => ({ id: 'editor-view' }),
    nowFn: () => 42,
    windowObject: {
      location: {
        pathname: '/app'
      }
    },
    navigatorObject: { id: 'navigator' },
    fetchImpl: () => Promise.resolve(),
    documentObject: { id: 'document' },
    factories: {
      createLauncherBridge(args) {
        launcherFactoryCalls.push(args);
        return {
          connectLiveDebugLogger() {
            launcherCalls.connect += 1;
          },
          initializeLiveDebugCapture() {
            launcherCalls.initialize += 1;
          },
          startLauncherHeartbeat() {
            launcherCalls.heartbeat += 1;
          },
          getQueuedEntryCount() {
            return 33;
          }
        };
      },
      createLiveSnapshotController(args) {
        snapshotFactoryCalls.push(args);
        return {
          id: 'snapshot-controller'
        };
      },
      createLiveDebugPanelController(args) {
        debugPanelFactoryCalls.push(args);
        return {
          id: 'debug-panel-controller'
        };
      }
    }
  });

  assert.equal(launcherFactoryCalls.length, 1);
  assert.equal(snapshotFactoryCalls.length, 1);
  assert.equal(debugPanelFactoryCalls.length, 1);
  assert.equal(launcherCalls.connect, 1);
  assert.equal(launcherCalls.initialize, 1);

  assert.equal(launcherFactoryCalls[0].launcherToken, 'token-123');
  assert.equal(launcherFactoryCalls[0].heartbeatMs, 5000);
  assert.equal(launcherFactoryCalls[0].uploadDebounceMs, 1000);
  assert.equal(launcherFactoryCalls[0].uploadMaxBatch, 250);
  assert.equal(launcherFactoryCalls[0].uploadMaxQueue, 5000);
  assert.equal(launcherFactoryCalls[0].getCurrentPath(), 'notes/test.md');
  assert.equal(launcherFactoryCalls[0].getViewMode(), 'live');
  assert.equal(launcherFactoryCalls[0].getAppPath(), '/app');

  assert.equal(snapshotFactoryCalls[0].liveDebugInputTtlMs, 777);
  assert.equal(snapshotFactoryCalls[0].getQueuedUploadEntryCount(), 33);
  assert.equal(snapshotFactoryCalls[0].nowFn(), 42);

  assert.equal(debugPanelFactoryCalls[0].appShellElement.id, 'app-shell');
  assert.equal(debugPanelFactoryCalls[0].statusElement.id, 'status');
  assert.equal(debugPanelFactoryCalls[0].isDevBuild, true);

  assert.equal(bootstrap.liveSnapshotController.id, 'snapshot-controller');
  assert.equal(bootstrap.liveDebugPanelController.id, 'debug-panel-controller');
  bootstrap.startLauncherHeartbeat();
  assert.equal(launcherCalls.heartbeat, 1);
});
