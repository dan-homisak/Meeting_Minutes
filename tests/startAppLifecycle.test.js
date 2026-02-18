import test from 'node:test';
import assert from 'node:assert/strict';
import { startAppLifecycle } from '../src/bootstrap/startAppLifecycle.js';

function createEventTargetStub() {
  const listeners = new Map();
  return {
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    emit(type, event = {}) {
      const handler = listeners.get(type);
      if (typeof handler === 'function') {
        return handler(event);
      }
      return undefined;
    }
  };
}

test('startAppLifecycle performs startup actions and binds UI handlers', async () => {
  const openFolderButton = createEventTargetStub();
  const newNoteButton = createEventTargetStub();
  const saveNowButton = createEventTargetStub();
  const rawModeButton = createEventTargetStub();
  const liveModeButton = createEventTargetStub();
  const previewModeButton = createEventTargetStub();
  const windowObject = createEventTargetStub();
  const calls = {
    setViewMode: [],
    setStatus: [],
    pickFolder: 0,
    createNewNote: 0,
    saveCurrentFile: [],
    restoreWorkspaceState: 0,
    startLauncherHeartbeat: 0,
    installEditorInputDiagnostics: 0,
    installRuntimeDiagnostics: 0,
    mountLiveDebugPanel: 0,
    initTheme: 0,
    renderPreview: [],
    updateActionButtons: 0
  };
  const app = {
    viewMode: 'live',
    hasUnsavedChanges: false
  };
  const editorView = {
    state: {
      doc: {
        toString() {
          return '# hello';
        }
      }
    }
  };

  startAppLifecycle({
    app,
    editorView,
    openFolderButton,
    newNoteButton,
    saveNowButton,
    rawModeButton,
    liveModeButton,
    previewModeButton,
    windowObject,
    installEditorInputDiagnostics: () => {
      calls.installEditorInputDiagnostics += 1;
    },
    installRuntimeDiagnostics: () => {
      calls.installRuntimeDiagnostics += 1;
    },
    mountLiveDebugPanel: () => {
      calls.mountLiveDebugPanel += 1;
    },
    initTheme: () => {
      calls.initTheme += 1;
    },
    renderPreview: (text) => {
      calls.renderPreview.push(text);
    },
    setViewMode: (mode) => {
      calls.setViewMode.push(mode);
    },
    updateActionButtons: () => {
      calls.updateActionButtons += 1;
    },
    pickFolder: () => {
      calls.pickFolder += 1;
    },
    createNewNote: () => {
      calls.createNewNote += 1;
    },
    saveCurrentFile: async (force) => {
      calls.saveCurrentFile.push(force);
    },
    setStatus: (message, asError = false) => {
      calls.setStatus.push({ message, asError });
    },
    restoreWorkspaceState: () => {
      calls.restoreWorkspaceState += 1;
    },
    startLauncherHeartbeat: () => {
      calls.startLauncherHeartbeat += 1;
    }
  });

  assert.equal(calls.installEditorInputDiagnostics, 1);
  assert.equal(calls.installRuntimeDiagnostics, 1);
  assert.equal(calls.mountLiveDebugPanel, 1);
  assert.equal(calls.initTheme, 1);
  assert.deepEqual(calls.renderPreview, ['# hello']);
  assert.deepEqual(calls.setViewMode, ['live']);
  assert.equal(calls.updateActionButtons, 1);
  assert.equal(calls.restoreWorkspaceState, 1);
  assert.equal(calls.startLauncherHeartbeat, 1);

  openFolderButton.emit('click');
  newNoteButton.emit('click');
  rawModeButton.emit('click');
  liveModeButton.emit('click');
  previewModeButton.emit('click');
  saveNowButton.emit('click');
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(calls.pickFolder, 1);
  assert.equal(calls.createNewNote, 1);
  assert.deepEqual(calls.saveCurrentFile, [true]);
  assert.deepEqual(calls.setViewMode, ['live', 'raw', 'live', 'preview']);

  const beforeUnloadEventNoUnsaved = {
    preventDefaultCalled: false,
    returnValue: null,
    preventDefault() {
      this.preventDefaultCalled = true;
    }
  };
  windowObject.emit('beforeunload', beforeUnloadEventNoUnsaved);
  assert.equal(beforeUnloadEventNoUnsaved.preventDefaultCalled, false);
  assert.equal(beforeUnloadEventNoUnsaved.returnValue, null);

  app.hasUnsavedChanges = true;
  const beforeUnloadEventWithUnsaved = {
    preventDefaultCalled: false,
    returnValue: null,
    preventDefault() {
      this.preventDefaultCalled = true;
    }
  };
  windowObject.emit('beforeunload', beforeUnloadEventWithUnsaved);
  assert.equal(beforeUnloadEventWithUnsaved.preventDefaultCalled, true);
  assert.equal(beforeUnloadEventWithUnsaved.returnValue, '');
  assert.deepEqual(calls.setStatus, []);
});

test('startAppLifecycle reports save button failures via setStatus', async () => {
  const saveNowButton = createEventTargetStub();
  const setStatusCalls = [];

  startAppLifecycle({
    app: { viewMode: 'raw', hasUnsavedChanges: false },
    editorView: {
      state: {
        doc: {
          toString() {
            return '';
          }
        }
      }
    },
    saveNowButton,
    saveCurrentFile: () => Promise.reject(new Error('disk full')),
    setStatus: (message, asError = false) => {
      setStatusCalls.push({ message, asError });
    }
  });

  saveNowButton.emit('click');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(setStatusCalls, [
    {
      message: 'Save failed: disk full',
      asError: true
    }
  ]);
});
