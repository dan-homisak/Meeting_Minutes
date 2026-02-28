export function createLiveRuntimeHelpers({
  liveDebugInputTtlMs = 900,
  windowObject,
  nowFn = () => Date.now(),
  liveDiagnosticsLogHelpers = null,
  liveLineMappingHelpers = null,
  pointerInputHelpers = null,
  getLiveViewportProbe = () => null,
  getLivePreviewBridge = () => null,
  getLiveSnapshotController = () => null,
  getCursorVisibilityController = () => null,
  getCursorNavigationController = () => null,
  getPointerActivationController = () => null
} = {}) {
  function describeElementForLog(element) {
    return liveDiagnosticsLogHelpers?.describeElementForLog(element) ?? null;
  }

  function readDomSelectionForLog(targetWindow = windowObject) {
    return liveDiagnosticsLogHelpers?.readDomSelectionForLog(targetWindow) ?? { hasSelection: false };
  }

  function readCursorVisibilityForLog(view, selectionHead = Number.NaN) {
    const liveViewportProbe = getLiveViewportProbe();
    if (!liveViewportProbe) {
      return {
        hasView: false
      };
    }

    return liveViewportProbe.readCursorVisibilityForLog(view, selectionHead);
  }

  function readGutterVisibilityForLog(view) {
    const liveViewportProbe = getLiveViewportProbe();
    if (!liveViewportProbe) {
      return {
        hasView: false
      };
    }

    return liveViewportProbe.readGutterVisibilityForLog(view);
  }

  function isCursorVisibilitySuspect(
    cursorState,
    selectionLineLength,
    domSelectionOnContentContainer
  ) {
    const cursorVisibilityController = getCursorVisibilityController();
    if (!cursorVisibilityController) {
      return true;
    }

    return cursorVisibilityController.isCursorVisibilitySuspect(
      cursorState,
      selectionLineLength,
      domSelectionOnContentContainer
    );
  }

  function scheduleCursorVisibilityProbe(view, reason = 'manual') {
    const cursorVisibilityController = getCursorVisibilityController();
    if (!cursorVisibilityController) {
      return;
    }

    cursorVisibilityController.scheduleCursorVisibilityProbe(view, reason);
  }

  function recordInputSignal(kind, details = {}) {
    const liveSnapshotController = getLiveSnapshotController();
    if (!liveSnapshotController) {
      return {
        at: nowFn(),
        kind,
        ...details
      };
    }

    return liveSnapshotController.recordInputSignal(kind, details);
  }

  function readRecentInputSignal(maxAgeMs = liveDebugInputTtlMs) {
    const liveSnapshotController = getLiveSnapshotController();
    if (!liveSnapshotController) {
      return null;
    }

    return liveSnapshotController.readRecentInputSignal(maxAgeMs);
  }

  function captureLiveDebugSnapshot(reason = 'manual') {
    getLiveSnapshotController()?.captureLiveDebugSnapshot(reason);
  }

  function normalizePointerTarget(target) {
    return pointerInputHelpers?.normalizePointerTarget(target) ?? null;
  }

  function readPointerCoordinates(event) {
    return pointerInputHelpers?.readPointerCoordinates(event) ?? null;
  }

  function readLineInfoForPosition(doc, position) {
    return liveLineMappingHelpers?.readLineInfoForPosition(doc, position) ?? null;
  }

  function readBlockLineBoundsForLog(doc, blockBounds) {
    return liveLineMappingHelpers?.readBlockLineBoundsForLog(doc, blockBounds) ?? null;
  }

  function resolvePointerPosition(view, targetElement, coordinates = null) {
    if (coordinates && typeof view?.posAtCoords === 'function') {
      const mappedPos = view.posAtCoords(coordinates);
      if (Number.isFinite(mappedPos)) {
        return mappedPos;
      }
    }

    try {
      if (typeof view?.posAtDOM === 'function') {
        const domPos = view.posAtDOM(targetElement, 0);
        if (Number.isFinite(domPos)) {
          return domPos;
        }
      }
    } catch {
      // Ignore DOM mapping failures and preserve native pointer behavior.
    }

    return null;
  }

  function requestLivePreviewRefresh(reason = 'manual') {
    getLivePreviewBridge()?.requestLivePreviewRefresh(reason);
  }

  function readLivePreviewState(state) {
    return getLivePreviewBridge()?.readLivePreviewState(state) ?? null;
  }

  function liveBlocksForView(view) {
    return getLivePreviewBridge()?.liveBlocksForView(view) ?? [];
  }

  function liveSourceMapIndexForView(view) {
    return getLivePreviewBridge()?.liveSourceMapIndexForView(view) ?? [];
  }

  function emitFenceVisibilityState(view, reason = 'selection-changed') {
    getLivePreviewBridge()?.emitFenceVisibilityState(view, reason);
  }

  function moveLiveCursorVertically(view, direction, trigger = 'arrow') {
    return getCursorNavigationController()?.moveLiveCursorVertically(view, direction, trigger) ?? false;
  }

  function handleLivePointerActivation(view, event, trigger) {
    return getPointerActivationController()?.handleLivePointerActivation(view, event, trigger) ?? false;
  }

  return {
    describeElementForLog,
    readDomSelectionForLog,
    readCursorVisibilityForLog,
    readGutterVisibilityForLog,
    isCursorVisibilitySuspect,
    scheduleCursorVisibilityProbe,
    recordInputSignal,
    readRecentInputSignal,
    captureLiveDebugSnapshot,
    normalizePointerTarget,
    readPointerCoordinates,
    readLineInfoForPosition,
    readBlockLineBoundsForLog,
    resolvePointerPosition,
    requestLivePreviewRefresh,
    readLivePreviewState,
    liveBlocksForView,
    liveSourceMapIndexForView,
    emitFenceVisibilityState,
    moveLiveCursorVertically,
    handleLivePointerActivation
  };
}
