import {
  emitLiveDebugEvents,
  resolvePointerActivationIntent
} from './SelectionPolicy.js';

export function createPointerActivationController({
  app,
  liveDebug,
  liveBlocksForView,
  normalizePointerTarget,
  readPointerCoordinates,
  describeElementForLog,
  recordInputSignal,
  resolvePointerPosition,
  readLineInfoForPosition,
  readBlockLineBoundsForLog,
  resolveActivationBlockBounds
} = {}) {
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
      recordInputSignal,
      resolvePointerPosition,
      view,
      liveBlocksForView,
      readLineInfoForPosition,
      resolveActivationBlockBounds,
      readBlockLineBoundsForLog
    });
    emitLiveDebugEvents(liveDebug, pointerIntent.logs);
    return false;
  }

  return {
    handleLivePointerActivation
  };
}
