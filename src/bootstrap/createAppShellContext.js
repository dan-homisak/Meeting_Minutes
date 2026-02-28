export function createAppShellContext({
  documentObject = document
} = {}) {
  const openFolderButton = documentObject.querySelector('#open-folder');
  const newNoteButton = documentObject.querySelector('#new-note');
  const saveNowButton = documentObject.querySelector('#save-now');
  const rawModeButton = documentObject.querySelector('#mode-raw');
  const liveModeButton = documentObject.querySelector('#mode-live');
  const previewModeButton = documentObject.querySelector('#mode-preview');
  const themeToggleButton = documentObject.querySelector('#theme-toggle');
  const statusElement = documentObject.querySelector('#status');
  const fileCountElement = documentObject.querySelector('#file-count');
  const fileListElement = documentObject.querySelector('#file-list');
  const editorElement = documentObject.querySelector('#editor');
  const previewElement = documentObject.querySelector('#preview');
  const appShellElement = documentObject.querySelector('.app-shell');
  const rootElement = documentObject.documentElement;

  const app = {
    folderHandle: null,
    fileHandles: new Map(),
    currentPath: null,
    currentFileHandle: null,
    lastSavedText: '',
    hasUnsavedChanges: false,
    isLoadingFile: false,
    autosaveTimer: null,
    viewMode: 'live'
  };

  return {
    app,
    openFolderButton,
    newNoteButton,
    saveNowButton,
    rawModeButton,
    liveModeButton,
    previewModeButton,
    themeToggleButton,
    statusElement,
    fileCountElement,
    fileListElement,
    editorElement,
    previewElement,
    appShellElement,
    rootElement
  };
}
