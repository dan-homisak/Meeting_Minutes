export function createModeController({
  app,
  sourceFirstMode = true,
  liveDebug,
  editorElement,
  previewElement,
  rawModeButton,
  liveModeButton,
  previewModeButton,
  getEditorText,
  renderPreview,
  requestLivePreviewRefresh,
  getEditorView,
  emitFenceVisibilityState,
  requestAnimationFrameFn = (callback) => window.requestAnimationFrame(callback)
} = {}) {
  function setViewMode(nextMode) {
    const previousMode = app.viewMode;
    const mode = nextMode === 'preview' || nextMode === 'live' ? nextMode : 'raw';
    app.viewMode = mode;
    liveDebug.info('mode.changed', {
      from: previousMode,
      to: mode,
      sourceFirst: sourceFirstMode
    });

    const showEditor = mode !== 'preview';
    const showPreview = mode === 'preview';

    if (editorElement) {
      editorElement.hidden = !showEditor;
      editorElement.classList.toggle('live-mode', mode === 'live');
    }

    if (previewElement) {
      previewElement.hidden = !showPreview;
    }

    if (rawModeButton) {
      rawModeButton.classList.toggle('active', mode === 'raw');
      rawModeButton.setAttribute('aria-pressed', String(mode === 'raw'));
    }

    if (liveModeButton) {
      liveModeButton.classList.toggle('active', mode === 'live');
      liveModeButton.setAttribute('aria-pressed', String(mode === 'live'));
    }

    if (previewModeButton) {
      previewModeButton.classList.toggle('active', mode === 'preview');
      previewModeButton.setAttribute('aria-pressed', String(mode === 'preview'));
    }

    if (mode === 'preview') {
      renderPreview(getEditorText());
      return;
    }

    requestLivePreviewRefresh('mode-change');
    const view = getEditorView();
    view?.focus?.();
    if (mode === 'live' && view) {
      emitFenceVisibilityState(view, 'mode-change');
    }

    requestAnimationFrameFn(() => {
      if (app.viewMode !== mode) {
        return;
      }

      requestLivePreviewRefresh('mode-change-post-frame');
      if (mode === 'live') {
        const frameView = getEditorView();
        if (frameView) {
          emitFenceVisibilityState(frameView, 'mode-change-post-frame');
        }
      }
    });
  }

  return {
    setViewMode
  };
}
