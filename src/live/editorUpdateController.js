export function createEditorUpdateController({
  app,
  liveDebug,
  handleSelectionUpdate,
  renderPreview,
  updateActionButtons,
  setStatus,
  scheduleAutosave
} = {}) {
  const runSelectionUpdate =
    typeof handleSelectionUpdate === 'function' ? handleSelectionUpdate : () => {};
  const runRenderPreview = typeof renderPreview === 'function' ? renderPreview : () => {};
  const runUpdateActionButtons =
    typeof updateActionButtons === 'function' ? updateActionButtons : () => {};
  const runSetStatus = typeof setStatus === 'function' ? setStatus : () => {};
  const runScheduleAutosave =
    typeof scheduleAutosave === 'function' ? scheduleAutosave : () => {};

  function handleEditorUpdate(update) {
    if (app.viewMode === 'live' && update.selectionSet) {
      runSelectionUpdate(update);
    }

    if (!update.docChanged) {
      return;
    }

    const markdownText = update.state.doc.toString();
    liveDebug.trace('document.changed', {
      mode: app.viewMode,
      length: markdownText.length
    });
    if (app.viewMode === 'preview') {
      runRenderPreview(markdownText);
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
