import { slashCommandCompletion } from '../editor/slashCommands.js';
import { createEditor } from '../bootstrap/createEditor.js';
import { createEditorDocumentAdapter } from '../bootstrap/createEditorDocumentAdapter.js';
import { createLiveDebugBootstrap } from '../bootstrap/createLiveDebugBootstrap.js';
import { createWorkspaceView } from '../ui/workspaceView.js';
import { createWorkspaceController } from '../workspace/workspaceController.js';
import {
  ensureReadWritePermission,
  isMarkdownFile,
  walkDirectory
} from '../workspace/fileSystem.js';
import { readWorkspaceFromDb, writeWorkspaceToDb } from '../workspace/workspaceDb.js';
import { createLiveRuntime } from './LiveRuntime.js';

export function createLiveApp({
  windowObject,
  documentObject,
  isDevBuild = false
} = {}) {
  const window = windowObject;
  const document = documentObject;

  const openFolderButton = document.querySelector('#open-folder');
  const newNoteButton = document.querySelector('#new-note');
  const saveNowButton = document.querySelector('#save-now');
  const statusElement = document.querySelector('#status');
  const fileCountElement = document.querySelector('#file-count');
  const fileListElement = document.querySelector('#file-list');
  const editorElement = document.querySelector('#editor');

  const app = {
    folderHandle: null,
    fileHandles: new Map(),
    currentPath: null,
    currentFileHandle: null,
    lastSavedText: '',
    hasUnsavedChanges: false,
    isLoadingFile: false,
    autosaveTimer: null
  };

  const workspaceView = createWorkspaceView({
    statusElement,
    fileCountElement,
    fileListElement,
    newNoteButton,
    saveNowButton
  });

  const { liveDebug } = createLiveDebugBootstrap({
    windowObject: window,
    isDevBuild,
    markdownEngineOptions: {
      dialect: 'obsidian-core',
      runtime: 'live-v3'
    },
    scope: 'live-v3'
  });

  const liveDebugDiagnostics = {
    lastProgrammaticSelectionAt: 0
  };

  function setStatus(message, asError = false) {
    workspaceView.setStatus(message, asError);
  }

  function updateActionButtons() {
    workspaceView.updateActionButtons({
      folderHandle: app.folderHandle,
      currentFileHandle: app.currentFileHandle
    });
  }

  let editorView = null;

  const runtime = createLiveRuntime({
    app,
    liveDebug
  });

  const { getEditorText, setEditorText } = createEditorDocumentAdapter({
    app,
    liveDebug,
    liveDebugDiagnostics,
    getEditorView: () => editorView,
    nowFn: () => Date.now()
  });

  function renderFileList() {
    workspaceView.renderFileList({
      fileHandles: app.fileHandles,
      currentPath: app.currentPath,
      onOpenFile: (path) => workspaceController.openFile(path)
    });
  }

  const workspaceController = createWorkspaceController({
    app,
    windowObject: window,
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
    liveDebug
  });

  editorView = createEditor({
    parent: editorElement,
    livePreviewStateField: runtime.liveStateField,
    livePreviewAtomicRanges: runtime.liveAtomicRanges,
    livePreviewPointerHandlers: runtime.livePointerHandlers,
    slashCommandCompletion,
    moveLiveCursorVertically: runtime.moveCursorVertically,
    handleEditorUpdate(update) {
      if (update.viewportChanged) {
        const viewportWindow = (
          Number.isFinite(update?.view?.viewport?.from) &&
          Number.isFinite(update?.view?.viewport?.to)
        )
          ? {
            from: Math.trunc(update.view.viewport.from),
            to: Math.trunc(update.view.viewport.to)
          }
          : null;
        runtime.requestRefresh(update.view, 'viewport-change', viewportWindow);
      }

      if (!update.docChanged) {
        return;
      }

      const markdownText = getEditorText();
      liveDebug.trace('live-v3.document.changed', {
        length: markdownText.length
      });

      if (app.isLoadingFile) {
        return;
      }

      app.hasUnsavedChanges = markdownText !== app.lastSavedText;
      updateActionButtons();

      if (!app.hasUnsavedChanges) {
        return;
      }

      setStatus(`Unsaved changes in ${app.currentPath ?? 'scratch buffer'}...`);
      workspaceController.scheduleAutosave();
    }
  });

  runtime.requestRefresh(editorView, 'startup');
  updateActionButtons();
  setStatus('Choose a vault folder with markdown files to start editing.');

  openFolderButton?.addEventListener('click', () => {
    void workspaceController.pickFolder();
  });

  newNoteButton?.addEventListener('click', () => {
    void workspaceController.createNewNote();
  });

  saveNowButton?.addEventListener('click', () => {
    void workspaceController.saveCurrentFile(true).catch((error) => {
      setStatus(`Save failed: ${error.message}`, true);
    });
  });

  window.addEventListener('beforeunload', (event) => {
    if (!app.hasUnsavedChanges) {
      return;
    }
    event.preventDefault();
    event.returnValue = '';
  });

  void workspaceController.restoreWorkspaceState();
}
