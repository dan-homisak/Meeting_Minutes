export function createEditorUpdateController({
  app,
  liveDebug,
  handleSelectionUpdate,
  renderPreview,
  requestLivePreviewRefresh,
  updateActionButtons,
  setStatus,
  scheduleAutosave,
  readDocumentModel
} = {}) {
  const runSelectionUpdate =
    typeof handleSelectionUpdate === 'function' ? handleSelectionUpdate : () => {};
  const runRenderPreview = typeof renderPreview === 'function' ? renderPreview : () => {};
  const runRequestLivePreviewRefresh =
    typeof requestLivePreviewRefresh === 'function' ? requestLivePreviewRefresh : () => {};
  const runUpdateActionButtons =
    typeof updateActionButtons === 'function' ? updateActionButtons : () => {};
  const runSetStatus = typeof setStatus === 'function' ? setStatus : () => {};
  const runScheduleAutosave =
    typeof scheduleAutosave === 'function' ? scheduleAutosave : () => {};
  const runReadDocumentModel =
    typeof readDocumentModel === 'function' ? readDocumentModel : null;

  function readSharedDocumentModel() {
    if (!runReadDocumentModel) {
      return null;
    }

    const model = runReadDocumentModel();
    if (!model || typeof model.text !== 'string') {
      return null;
    }

    return model;
  }

  function resolveDocumentText(update, documentModel = null) {
    if (documentModel && typeof documentModel.text === 'string') {
      return documentModel.text;
    }

    if (runReadDocumentModel) {
      const model = runReadDocumentModel();
      if (model && typeof model.text === 'string') {
        return model.text;
      }
    }

    return update?.state?.doc?.toString?.() ?? '';
  }

  function handleEditorUpdate(update) {
    if (app.viewMode === 'live' && update.viewportChanged) {
      const viewportWindow = (
        Number.isFinite(update?.view?.viewport?.from) &&
        Number.isFinite(update?.view?.viewport?.to)
      )
        ? {
          from: Math.trunc(update.view.viewport.from),
          to: Math.trunc(update.view.viewport.to)
        }
        : null;
      runRequestLivePreviewRefresh({
        reason: 'viewport-change',
        viewportWindow
      });
    }

    if (app.viewMode === 'live' && update.selectionSet) {
      runSelectionUpdate(update);
    }

    if (!update.docChanged) {
      return;
    }

    const documentModel = readSharedDocumentModel();
    const markdownText = resolveDocumentText(update, documentModel);
    liveDebug.trace('document.changed', {
      mode: app.viewMode,
      length: markdownText.length
    });
    if (app.viewMode === 'preview') {
      runRenderPreview(markdownText, {
        documentModel
      });
    }

    if (app.isLoadingFile) {
      return;
    }

    app.hasUnsavedChanges = markdownText !== app.lastSavedText;
    runUpdateActionButtons();

    if (!app.hasUnsavedChanges) {
      return;
    }

    runSetStatus(`Unsaved changes in ${app.currentPath ?? 'scratch buffer'}...`);
    runScheduleAutosave();
  }

  return {
    handleEditorUpdate
  };
}
