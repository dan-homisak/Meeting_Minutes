import { createCursorNavigationController as createCursorNavigationControllerFactory } from '../live/cursorNavigationController.js';
import { createCursorVisibilityController as createCursorVisibilityControllerFactory } from '../live/cursorVisibilityController.js';
import { createEditorUpdateController as createEditorUpdateControllerFactory } from '../live/editorUpdateController.js';
import { createLiveDiagnosticsController as createLiveDiagnosticsControllerFactory } from '../live/liveDiagnosticsController.js';
import { createLiveViewportProbe as createLiveViewportProbeFactory } from '../live/liveViewportProbe.js';
import { createPointerActivationController as createPointerActivationControllerFactory } from '../live/pointerActivationController.js';
import { createPointerMappingProbe as createPointerMappingProbeFactory } from '../live/pointerMappingProbe.js';
import { createPointerProbeGeometry as createPointerProbeGeometryFactory } from '../live/pointerProbeGeometry.js';
import { createPointerSourceMapping as createPointerSourceMappingFactory } from '../live/pointerSourceMapping.js';
import { createSelectionDiagnosticsController as createSelectionDiagnosticsControllerFactory } from '../live/selectionDiagnosticsController.js';

export function createLiveControllers({
  app,
  liveDebug,
  liveDebugDiagnostics,
  sourceFirstMode = true,
  config,
  helpers,
  runtime = {},
  factories = {}
} = {}) {
  const createLiveViewportProbe =
    factories.createLiveViewportProbe ?? createLiveViewportProbeFactory;
  const createPointerProbeGeometry =
    factories.createPointerProbeGeometry ?? createPointerProbeGeometryFactory;
  const createPointerSourceMapping =
    factories.createPointerSourceMapping ?? createPointerSourceMappingFactory;
  const createPointerMappingProbe =
    factories.createPointerMappingProbe ?? createPointerMappingProbeFactory;
  const createPointerActivationController =
    factories.createPointerActivationController ?? createPointerActivationControllerFactory;
  const createCursorVisibilityController =
    factories.createCursorVisibilityController ?? createCursorVisibilityControllerFactory;
  const createCursorNavigationController =
    factories.createCursorNavigationController ?? createCursorNavigationControllerFactory;
  const createLiveDiagnosticsController =
    factories.createLiveDiagnosticsController ?? createLiveDiagnosticsControllerFactory;
  const createSelectionDiagnosticsController =
    factories.createSelectionDiagnosticsController ?? createSelectionDiagnosticsControllerFactory;
  const createEditorUpdateController =
    factories.createEditorUpdateController ?? createEditorUpdateControllerFactory;

  const requestAnimationFrameFn =
    typeof runtime.requestAnimationFrameFn === 'function'
      ? runtime.requestAnimationFrameFn
      : (callback) => callback();
  const createCursorSelection =
    typeof runtime.createCursorSelection === 'function'
      ? runtime.createCursorSelection
      : (position, assoc) => ({ position, assoc });

  const liveViewportProbe = createLiveViewportProbe({
    normalizeLogString: helpers.normalizeLogString,
    liveDebugCursorMaxExpectedHeightPx: config.liveDebugCursorMaxExpectedHeightPx,
    liveDebugCursorMaxExpectedWidthPx: config.liveDebugCursorMaxExpectedWidthPx,
    liveDebugCursorRightDriftPx: config.liveDebugCursorRightDriftPx,
    liveDebugCursorTransientDriftDeltaPx: config.liveDebugCursorTransientDriftDeltaPx,
    windowObject: runtime.windowObject
  });

  const pointerProbeGeometry = createPointerProbeGeometry({
    normalizeLogString: helpers.normalizeLogString,
    readLineInfoForPosition: helpers.readLineInfoForPosition,
    windowObject: runtime.windowObject,
    elementConstructor: runtime.elementConstructor
  });

  const pointerSourceMapping = createPointerSourceMapping({
    clampNumber: helpers.clampNumber,
    traceDomPosFailure: (error) => {
      liveDebug.trace('block.activate.dom-pos-failed', {
        message: error instanceof Error ? error.message : String(error)
      });
    },
    elementConstructor: runtime.elementConstructor
  });

  const pointerMappingProbe = createPointerMappingProbe({
    clampNumber: helpers.clampNumber,
    readBlockLineBoundsForLog: helpers.readBlockLineBoundsForLog,
    buildCoordSamples: helpers.buildCoordSamples,
    readLineInfoForPosition: helpers.readLineInfoForPosition,
    resolvePointerPosition: helpers.resolvePointerPosition,
    summarizeRectForLog: helpers.summarizeRectForLog,
    readComputedStyleSnapshotForLog: helpers.readComputedStyleSnapshotForLog,
    normalizeLogString: helpers.normalizeLogString
  });

  const pointerActivationController = createPointerActivationController({
    app,
    liveDebug,
    sourceFirstMode,
    livePreviewRenderedDomAnchorStickyMaxPosDelta:
      config.livePreviewRenderedDomAnchorStickyMaxPosDelta,
    livePreviewRenderedFencedStickyMaxPosDelta: config.livePreviewRenderedFencedStickyMaxPosDelta,
    livePreviewRenderedFencedStickyMaxLineDelta: config.livePreviewRenderedFencedStickyMaxLineDelta,
    livePreviewRenderedBoundaryStickyMaxPosDelta:
      config.livePreviewRenderedBoundaryStickyMaxPosDelta,
    livePreviewRenderedBoundaryStickyMaxLineDelta:
      config.livePreviewRenderedBoundaryStickyMaxLineDelta,
    livePreviewRenderedBoundaryStickyMaxDistanceFromBottomPx:
      config.livePreviewRenderedBoundaryStickyMaxDistanceFromBottomPx,
    livePreviewRenderedBoundaryStickyMinRatioY: config.livePreviewRenderedBoundaryStickyMinRatioY,
    liveDebugBlockMapLargeDeltaPos: config.liveDebugBlockMapLargeDeltaPos,
    liveDebugBlockMapLargeDeltaLines: config.liveDebugBlockMapLargeDeltaLines,
    requestAnimationFrameFn,
    liveBlocksForView: helpers.liveBlocksForView,
    normalizePointerTarget: helpers.normalizePointerTarget,
    readPointerCoordinates: helpers.readPointerCoordinates,
    describeElementForLog: helpers.describeElementForLog,
    recordInputSignal: helpers.recordInputSignal,
    resolvePointerPosition: helpers.resolvePointerPosition,
    readLineInfoForPosition: helpers.readLineInfoForPosition,
    readBlockLineBoundsForLog: helpers.readBlockLineBoundsForLog,
    resolveActivationBlockBounds: helpers.resolveActivationBlockBounds,
    resolveLiveBlockSelection: helpers.resolveLiveBlockSelection,
    findBlockContainingPosition: helpers.findBlockContainingPosition,
    findNearestBlockForPosition: helpers.findNearestBlockForPosition,
    isFencedCodeBlock: helpers.isFencedCodeBlock,
    parseSourceFromAttribute: helpers.parseSourceFromAttribute,
    findRenderedSourceRangeTarget: helpers.findRenderedSourceRangeTarget,
    resolvePositionFromRenderedSourceRange: helpers.resolvePositionFromRenderedSourceRange,
    distanceToBlockBounds: helpers.distanceToBlockBounds,
    shouldPreferRenderedDomAnchorPosition: helpers.shouldPreferRenderedDomAnchorPosition,
    shouldPreferSourceFromForRenderedFencedClick: helpers.shouldPreferSourceFromForRenderedFencedClick,
    shouldPreferSourceFromForRenderedBoundaryClick:
      helpers.shouldPreferSourceFromForRenderedBoundaryClick,
    buildRenderedPointerProbe: helpers.buildRenderedPointerProbe,
    summarizeLineNumbersForCoordSamples: helpers.summarizeLineNumbersForCoordSamples,
    normalizeLogString: helpers.normalizeLogString
  });

  const cursorVisibilityController = createCursorVisibilityController({
    app,
    liveDebug,
    liveDebugDiagnostics,
    liveDebugCursorMaxExpectedHeightPx: config.liveDebugCursorMaxExpectedHeightPx,
    liveDebugCursorProbeThrottleMs: config.liveDebugCursorProbeThrottleMs,
    liveDebugCursorActiveLineMissingThrottleMs: config.liveDebugCursorActiveLineMissingThrottleMs,
    liveDebugGutterProbeThrottleMs: config.liveDebugGutterProbeThrottleMs,
    liveDebugCursorRecoveryCooldownMs: config.liveDebugCursorRecoveryCooldownMs,
    readCursorVisibilityForLog: helpers.readCursorVisibilityForLog,
    readDomSelectionForLog: helpers.readDomSelectionForLog,
    readGutterVisibilityForLog: helpers.readGutterVisibilityForLog,
    requestLivePreviewRefresh: helpers.requestLivePreviewRefresh,
    captureLiveDebugSnapshot: helpers.captureLiveDebugSnapshot,
    requestAnimationFrameFn,
    createCursorSelection
  });

  const cursorNavigationController = createCursorNavigationController({
    app,
    liveDebug,
    recordInputSignal: helpers.recordInputSignal,
    normalizeLogString: helpers.normalizeLogString,
    scheduleCursorVisibilityProbe: helpers.scheduleCursorVisibilityProbe,
    readCursorVisibilityForLog: helpers.readCursorVisibilityForLog,
    readDomSelectionForLog: helpers.readDomSelectionForLog,
    isCursorVisibilitySuspect: helpers.isCursorVisibilitySuspect,
    requestAnimationFrameFn
  });

  const liveDiagnosticsController = createLiveDiagnosticsController({
    app,
    liveDebug,
    liveDebugDiagnostics,
    liveDebugKeylogKeys: config.liveDebugKeylogKeys,
    liveDebugDomSelectionThrottleMs: config.liveDebugDomSelectionThrottleMs,
    normalizeLogString: helpers.normalizeLogString,
    normalizePointerTarget: helpers.normalizePointerTarget,
    readPointerCoordinates: helpers.readPointerCoordinates,
    describeElementForLog: helpers.describeElementForLog,
    recordInputSignal: helpers.recordInputSignal,
    moveLiveCursorVertically: helpers.moveLiveCursorVertically,
    scheduleCursorVisibilityProbe: helpers.scheduleCursorVisibilityProbe,
    readDomSelectionForLog: helpers.readDomSelectionForLog,
    windowObject: runtime.windowObject,
    documentObject: runtime.documentObject,
    performanceObserverClass: runtime.performanceObserverClass,
    elementConstructor: runtime.elementConstructor,
    nodeConstructor: runtime.nodeConstructor
  });

  const selectionDiagnosticsController = createSelectionDiagnosticsController({
    app,
    liveDebug,
    liveDebugDiagnostics,
    liveDebugSelectionJumpWarnLineDelta: config.liveDebugSelectionJumpWarnLineDelta,
    liveDebugSelectionJumpWarnPosDelta: config.liveDebugSelectionJumpWarnPosDelta,
    liveDebugSelectionJumpSuppressAfterProgrammaticMs:
      config.liveDebugSelectionJumpSuppressAfterProgrammaticMs,
    readRecentInputSignal: helpers.readRecentInputSignal,
    readDomSelectionForLog: helpers.readDomSelectionForLog,
    scheduleCursorVisibilityProbe: helpers.scheduleCursorVisibilityProbe,
    emitFenceVisibilityState: helpers.emitFenceVisibilityState,
    captureLiveDebugSnapshot: helpers.captureLiveDebugSnapshot,
    transactionUserEventAnnotation: runtime.transactionUserEventAnnotation,
    isRefreshEffect: helpers.isRefreshEffect,
    nowFn: runtime.nowFn
  });

  const editorUpdateController = createEditorUpdateController({
    app,
    liveDebug,
    handleSelectionUpdate: (update) => selectionDiagnosticsController?.handleSelectionUpdate(update),
    renderPreview: helpers.renderPreview,
    updateActionButtons: helpers.updateActionButtons,
    setStatus: helpers.setStatus,
    scheduleAutosave: helpers.scheduleAutosave
  });

  return {
    liveViewportProbe,
    pointerProbeGeometry,
    pointerSourceMapping,
    pointerMappingProbe,
    pointerActivationController,
    cursorVisibilityController,
    cursorNavigationController,
    liveDiagnosticsController,
    selectionDiagnosticsController,
    editorUpdateController
  };
}
