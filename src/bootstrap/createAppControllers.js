import { createModeController as createModeControllerFactory } from '../ui/modeController.js';
import { createWorkspaceController as createWorkspaceControllerFactory } from '../workspace/workspaceController.js';

export function createAppControllers({
  app,
  workspaceView,
  windowObject,
  walkDirectory,
  ensureReadWritePermission,
  isMarkdownFile,
  readWorkspaceFromDb,
  writeWorkspaceToDb,
  getEditorText,
  setEditorText,
  renderPreview,
  liveDebug,
  sourceFirstMode,
  editorElement,
  previewElement,
  rawModeButton,
  liveModeButton,
  previewModeButton,
  requestLivePreviewRefresh,
  getEditorView,
  emitFenceVisibilityState,
  requestAnimationFrameFn,
  factories = {}
} = {}) {
  const createWorkspaceController =
    factories.createWorkspaceController ?? createWorkspaceControllerFactory;
  const createModeController = factories.createModeController ?? createModeControllerFactory;

  function setStatus(message, asError = false) {
    workspaceView.setStatus(message, asError);
  }

  function updateActionButtons() {
    workspaceView.updateActionButtons({
      folderHandle: app.folderHandle,
      currentFileHandle: app.currentFileHandle
    });
  }

  async function openFile(path) {
    return workspaceController.openFile(path);
  }

  function renderFileList() {
    workspaceView.renderFileList({
      fileHandles: app.fileHandles,
      currentPath: app.currentPath,
      onOpenFile: openFile
    });
  }

  const workspaceController = createWorkspaceController({
    app,
    windowObject,
    walkDirectory,
    ensureReadWritePermission,
    isMarkdownFile,
    readWorkspaceFromDb,
    writeWorkspaceToDb,
    setStatus,
    updateActionButtons,
    renderFileList,
    getEditorText,
    setEditorText,
    renderPreview,
    liveDebug
  });

  const modeController = createModeController({
    app,
    sourceFirstMode,
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
    requestAnimationFrameFn
  });

  function setViewMode(nextMode) {
    modeController.setViewMode(nextMode);
  }

  async function saveCurrentFile(force = false) {
    return workspaceController.saveCurrentFile(force);
  }

  function scheduleAutosave() {
    workspaceController.scheduleAutosave();
  }

  async function restoreWorkspaceState() {
    return workspaceController.restoreWorkspaceState();
  }

  async function pickFolder() {
    return workspaceController.pickFolder();
  }

  async function createNewNote() {
    return workspaceController.createNewNote();
  }

  return {
    workspaceController,
    modeController,
    setStatus,
    updateActionButtons,
    renderFileList,
    setViewMode,
    saveCurrentFile,
    scheduleAutosave,
    openFile,
    restoreWorkspaceState,
    pickFolder,
    createNewNote
  };
}
