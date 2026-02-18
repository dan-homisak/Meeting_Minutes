export function startAppLifecycle({
  app,
  editorView,
  openFolderButton,
  newNoteButton,
  saveNowButton,
  rawModeButton,
  liveModeButton,
  previewModeButton,
  windowObject,
  installEditorInputDiagnostics,
  installRuntimeDiagnostics,
  mountLiveDebugPanel,
  initTheme,
  renderPreview,
  setViewMode,
  updateActionButtons,
  pickFolder,
  createNewNote,
  saveCurrentFile,
  setStatus,
  restoreWorkspaceState,
  startLauncherHeartbeat
} = {}) {
  installEditorInputDiagnostics?.(editorView);
  installRuntimeDiagnostics?.();
  mountLiveDebugPanel?.();
  initTheme?.();
  renderPreview?.(editorView?.state?.doc?.toString?.() ?? '');
  setViewMode?.(app?.viewMode);
  updateActionButtons?.();

  openFolderButton?.addEventListener('click', () => {
    void pickFolder?.();
  });

  newNoteButton?.addEventListener('click', () => {
    void createNewNote?.();
  });

  saveNowButton?.addEventListener('click', () => {
    const savePromise = saveCurrentFile?.(true);
    if (savePromise && typeof savePromise.catch === 'function') {
      void savePromise.catch((error) => {
        setStatus?.(`Save failed: ${error.message}`, true);
      });
    }
  });

  rawModeButton?.addEventListener('click', () => {
    setViewMode?.('raw');
  });

  liveModeButton?.addEventListener('click', () => {
    setViewMode?.('live');
  });

  previewModeButton?.addEventListener('click', () => {
    setViewMode?.('preview');
  });

  windowObject?.addEventListener('beforeunload', (event) => {
    if (!app?.hasUnsavedChanges) {
      return;
    }

    event.preventDefault();
    event.returnValue = '';
  });

  void restoreWorkspaceState?.();
  startLauncherHeartbeat?.();
}
