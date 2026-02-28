export function createEditorUpdateController({
  app,
  liveDebug,
  handleSelectionUpdate,
  renderPreview,
  updateActionButtons,
  setStatus,
  scheduleAutosave,
  readDocumentModel
} = {}) {
  const runSelectionUpdate =
    typeof handleSelectionUpdate === 'function' ? handleSelectionUpdate : () => {};
  const runRenderPreview = typeof renderPreview === 'function' ? renderPreview : () => {};
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
