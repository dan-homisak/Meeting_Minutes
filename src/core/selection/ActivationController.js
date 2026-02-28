import {
  resolveMappedSelectionRemapPreflight,
  resolveMappedSelectionUpdate,
  emitLiveDebugEvents,
  resolveBlockActivationDispatch,
  resolveBlockActivationSelectionContext,
  resolvePointerActivationDispatch,
  resolvePointerActivationIntent,
  resolveRenderedPointerActivation,
} from './SelectionPolicy.js';

export function createPointerActivationController({
  app,
  liveDebug,
  sourceFirstMode = true,
  livePreviewRenderedDomAnchorStickyMaxPosDelta = 40,
  livePreviewRenderedFencedStickyMaxPosDelta = 12,
  livePreviewRenderedFencedStickyMaxLineDelta = 2,
  livePreviewRenderedBoundaryStickyMaxPosDelta = 30,
  livePreviewRenderedBoundaryStickyMaxLineDelta = 3,
  livePreviewRenderedBoundaryStickyMaxDistanceFromBottomPx = 14,
  livePreviewRenderedBoundaryStickyMinRatioY = 0.3,
  liveDebugBlockMapLargeDeltaPos = 20,
  liveDebugBlockMapLargeDeltaLines = 2,
  requestAnimationFrameFn = (callback) => window.requestAnimationFrame(callback),
  liveBlocksForView,
  liveSourceMapIndexForView,
  normalizePointerTarget,
  readPointerCoordinates,
  describeElementForLog,
  recordInputSignal,
  resolvePointerPosition,
  readLineInfoForPosition,
  readBlockLineBoundsForLog,
  resolveActivationBlockBounds,
  resolveLiveBlockSelection,
  findBlockContainingPosition,
  findNearestBlockForPosition,
  isFencedCodeBlock,
  parseSourceFromAttribute,
  findRenderedSourceRangeTarget,
  resolvePositionFromRenderedSourceRange,
  distanceToBlockBounds,
  shouldPreferRenderedDomAnchorPosition,
  shouldPreferSourceFromForRenderedFencedClick,
  shouldPreferSourceFromForRenderedBoundaryClick,
  buildRenderedPointerProbe,
  summarizeLineNumbersForCoordSamples,
  normalizeLogString
} = {}) {
  function resolveLiveActivationContext(
    view,
    targetElement,
    coordinates,
    trigger,
    renderedBlockTarget = null
  ) {
    const renderedActivation = resolveRenderedPointerActivation({
      view,
      targetElement,
      coordinates,
      trigger,
      renderedBlockTarget,
      liveBlocksForView,
      liveSourceMapIndexForView,
      parseSourceFromAttribute,
      resolvePointerPosition,
      findRenderedSourceRangeTarget,
      resolvePositionFromRenderedSourceRange,
      resolveActivationBlockBounds,
      resolveLiveBlockSelection,
      distanceToBlockBounds,
      shouldPreferRenderedDomAnchorPosition,
      findBlockContainingPosition,
      findNearestBlockForPosition,
      readBlockLineBoundsForLog,
      readLineInfoForPosition,
      isFencedCodeBlock,
      buildRenderedPointerProbe,
      summarizeLineNumbersForCoordSamples,
      shouldPreferSourceFromForRenderedFencedClick,
      shouldPreferSourceFromForRenderedBoundaryClick,
      normalizeLogString,
      livePreviewRenderedDomAnchorStickyMaxPosDelta,
      livePreviewRenderedFencedStickyMaxPosDelta,
      livePreviewRenderedFencedStickyMaxLineDelta,
      livePreviewRenderedBoundaryStickyMaxPosDelta,
      livePreviewRenderedBoundaryStickyMaxLineDelta,
      livePreviewRenderedBoundaryStickyMaxDistanceFromBottomPx,
      livePreviewRenderedBoundaryStickyMinRatioY
    });
    emitLiveDebugEvents(liveDebug, renderedActivation.logs);
    return renderedActivation.activation;
  }

  function activateLiveBlock(
    view,
    sourceFrom,
    coordinates = null,
    trigger = 'unknown',
    blockBounds = null,
    preferredSelection = null,
    allowCoordinateRemap = true,
    strategy = null
  ) {
    const selectionContext = resolveBlockActivationSelectionContext({
      doc: view.state.doc,
      docLength: view.state.doc.length,
      sourceFrom,
      preferredSelection,
      blockBounds,
      resolveLiveBlockSelection,
      readLineInfoForPosition
    });
    const dispatchOutcome = resolveBlockActivationDispatch({
      trigger,
      sourceFrom,
      baseSelection: selectionContext.baseSelection,
      preferredSelection,
      baseSelectionLineInfo: selectionContext.baseSelectionLineInfo,
      allowCoordinateRemap,
      strategy: strategy ?? null,
      blockBounds,
      dispatchActivate: () => {
        view.dispatch({
          selection: { anchor: selectionContext.baseSelection },
          scrollIntoView: true
        });
        view.focus();
      }
    });
    emitLiveDebugEvents(liveDebug, dispatchOutcome.logs);
    if (!dispatchOutcome.handled) {
      throw dispatchOutcome.error ?? new Error('block activation dispatch failed');
    }

    const remapPreflight = resolveMappedSelectionRemapPreflight({
      trigger,
      sourceFrom,
      baseSelection: selectionContext.baseSelection,
      allowCoordinateRemap,
      coordinates,
      strategy: strategy ?? null,
      blockBounds
    });
    emitLiveDebugEvents(liveDebug, remapPreflight.logs);
    if (!remapPreflight.shouldMap) {
      return;
    }

    requestAnimationFrameFn(() => {
      const mappedPos = view.posAtCoords(coordinates);
      const mappedSelectionUpdate = resolveMappedSelectionUpdate({
        trigger,
        sourceFrom,
        mappedPos,
        docLength: view.state.doc.length,
        blockBounds,
        baseSelection: selectionContext.baseSelection,
        baseSelectionLineInfo: selectionContext.baseSelectionLineInfo,
        strategy: strategy ?? null,
        preferredSelection,
        coordinates,
        largeDeltaPosThreshold: liveDebugBlockMapLargeDeltaPos,
        largeDeltaLineThreshold: liveDebugBlockMapLargeDeltaLines,
        resolveLiveBlockSelection,
        readLineInfoForPosition,
        doc: view.state.doc
      });
      emitLiveDebugEvents(liveDebug, mappedSelectionUpdate.logs);

      if (!mappedSelectionUpdate.shouldDispatchSelection) {
        return;
      }

      view.dispatch({
        selection: { anchor: mappedSelectionUpdate.remap.resolvedPos },
        scrollIntoView: true
      });
    });
  }

  function handleLivePointerActivation(view, event, trigger) {
    const targetElement = normalizePointerTarget(event.target);
    const coordinates = readPointerCoordinates(event);
    const targetSummary = describeElementForLog(targetElement);

    const pointerIntent = resolvePointerActivationIntent({
      viewMode: app.viewMode,
      trigger,
      targetElement,
      coordinates,
      targetSummary,
      sourceFirstMode,
      recordInputSignal,
      resolvePointerPosition,
      view,
      liveBlocksForView,
      readLineInfoForPosition,
      resolveActivationBlockBounds,
      readBlockLineBoundsForLog
    });
    emitLiveDebugEvents(liveDebug, pointerIntent.logs);

    if (!pointerIntent.proceed) {
      return false;
    }

    const activation = resolveLiveActivationContext(
      view,
      targetElement,
      coordinates,
      trigger,
      pointerIntent.renderedBlockTarget
    );
    if (!activation) {
      return false;
    }

    const activationDispatch = resolvePointerActivationDispatch({
      trigger,
      activation,
      coordinates,
      beforeActivate: () => {
        if (typeof event.preventDefault === 'function') {
          event.preventDefault();
        }
      },
      activate: () => {
        activateLiveBlock(
          view,
          activation.sourceFrom,
          coordinates,
          trigger,
          activation.blockBounds,
          activation.sourcePos,
          activation.allowCoordinateRemap !== false,
          activation.strategy
        );
      }
    });
    emitLiveDebugEvents(liveDebug, activationDispatch.logs);
    return activationDispatch.handled;
  }

  return {
    resolveLiveActivationContext,
    handleLivePointerActivation,
    activateLiveBlock
  };
}
