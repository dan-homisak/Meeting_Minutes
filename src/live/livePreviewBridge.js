export function createLivePreviewBridge({
  getLivePreviewController,
  getEditorView
} = {}) {
  const readController =
    typeof getLivePreviewController === 'function'
      ? getLivePreviewController
      : () => null;
  const readView = typeof getEditorView === 'function' ? getEditorView : () => null;

  function requestLivePreviewRefresh(reason = 'manual') {
    const controller = readController();
    const view = readView();
    if (!controller || !view || typeof controller.requestLivePreviewRefresh !== 'function') {
      return;
    }

    controller.requestLivePreviewRefresh(view, reason);
  }

  function readLivePreviewState(state) {
    const controller = readController();
    if (!controller || typeof controller.readLivePreviewState !== 'function') {
      return null;
    }

    return controller.readLivePreviewState(state);
  }

  function liveBlocksForView(view) {
    const controller = readController();
    if (!controller || typeof controller.liveBlocksForView !== 'function') {
      return [];
    }

    return controller.liveBlocksForView(view);
  }

  function liveBlockIndexForView(view) {
    const controller = readController();
    if (!controller || typeof controller.liveBlockIndexForView !== 'function') {
      return [];
    }

    return controller.liveBlockIndexForView(view);
  }

  function emitFenceVisibilityState(view, reason = 'selection-changed') {
    const controller = readController();
    if (!controller || typeof controller.emitFenceVisibilityState !== 'function') {
      return;
    }

    controller.emitFenceVisibilityState(view, reason);
  }

  return {
    requestLivePreviewRefresh,
    readLivePreviewState,
    liveBlocksForView,
    liveBlockIndexForView,
    emitFenceVisibilityState
  };
}
