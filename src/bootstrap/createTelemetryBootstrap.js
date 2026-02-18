import { createLauncherBridge as createLauncherBridgeFactory } from '../telemetry/launcherBridge.js';
import { createLiveDebugPanelController as createLiveDebugPanelControllerFactory } from '../telemetry/liveDebugPanelController.js';
import { createLiveSnapshotController as createLiveSnapshotControllerFactory } from '../live/liveSnapshotController.js';

export function createTelemetryBootstrap({
  app,
  launcherToken,
  liveDebug,
  liveDebugDiagnostics,
  liveDebugInputTtlMs = 900,
  heartbeatMs = 4000,
  uploadDebounceMs = 900,
  uploadMaxBatch = 200,
  uploadMaxQueue = 4000,
  findBlockContainingPosition,
  findNearestBlockForPosition,
  readLivePreviewState,
  readDomSelectionForLog,
  appShellElement,
  statusElement,
  isDevBuild = false,
  setLiveDebugLevel,
  setStatus,
  captureLiveDebugSnapshot,
  getEditorView,
  nowFn = () => Date.now(),
  windowObject,
  navigatorObject,
  fetchImpl,
  documentObject,
  factories = {}
} = {}) {
  const createLauncherBridge = factories.createLauncherBridge ?? createLauncherBridgeFactory;
  const createLiveSnapshotController =
    factories.createLiveSnapshotController ?? createLiveSnapshotControllerFactory;
  const createLiveDebugPanelController =
    factories.createLiveDebugPanelController ?? createLiveDebugPanelControllerFactory;

  const launcherBridge = createLauncherBridge({
    launcherToken,
    liveDebug,
    windowObject,
    navigatorObject,
    fetchImpl,
    heartbeatMs,
    uploadDebounceMs,
    uploadMaxBatch,
    uploadMaxQueue,
    getCurrentPath: () => app.currentPath,
    getViewMode: () => app.viewMode,
    getAppPath: () => windowObject.location.pathname
  });

  launcherBridge.connectLiveDebugLogger();
  launcherBridge.initializeLiveDebugCapture();

  const liveSnapshotController = createLiveSnapshotController({
    app,
    liveDebug,
    liveDebugDiagnostics,
    liveDebugInputTtlMs,
    getEditorView,
    readLivePreviewState,
    findBlockContainingPosition,
    findNearestBlockForPosition,
    readDomSelectionForLog,
    getQueuedUploadEntryCount: () => launcherBridge.getQueuedEntryCount(),
    nowFn
  });

  const liveDebugPanelController = createLiveDebugPanelController({
    appShellElement,
    statusElement,
    liveDebug,
    isDevBuild,
    setLiveDebugLevel,
    setStatus,
    captureLiveDebugSnapshot,
    navigatorObject,
    documentObject
  });

  function startLauncherHeartbeat() {
    launcherBridge.startLauncherHeartbeat();
  }

  return {
    launcherBridge,
    liveSnapshotController,
    liveDebugPanelController,
    startLauncherHeartbeat
  };
}
