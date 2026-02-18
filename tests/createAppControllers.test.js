import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppControllers } from '../src/bootstrap/createAppControllers.js';

test('createAppControllers wires workspace/mode controllers and delegates runtime actions', async () => {
  const workspaceCalls = {
    setStatus: [],
    updateActionButtons: [],
    renderFileList: []
  };
  const workspaceControllerCalls = {
    saveCurrentFile: [],
    scheduleAutosave: 0,
    openFile: [],
    restoreWorkspaceState: 0,
    pickFolder: 0,
    createNewNote: 0
  };
  const modeControllerCalls = {
    setViewMode: []
  };
  const workspaceControllerArgs = [];
  const modeControllerArgs = [];
  const app = {
    folderHandle: { id: 'folder' },
    currentFileHandle: { id: 'file' },
    fileHandles: new Map([['note.md', { id: 'note' }]]),
    currentPath: 'note.md',
    viewMode: 'raw'
  };

  const controllers = createAppControllers({
    app,
    workspaceView: {
      setStatus(message, asError) {
        workspaceCalls.setStatus.push({ message, asError });
      },
      updateActionButtons(payload) {
        workspaceCalls.updateActionButtons.push(payload);
      },
      renderFileList(payload) {
        workspaceCalls.renderFileList.push(payload);
      }
    },
    windowObject: { id: 'window' },
    walkDirectory: () => [],
    ensureReadWritePermission: () => true,
    isMarkdownFile: () => true,
    readWorkspaceFromDb: async () => null,
    writeWorkspaceToDb: async () => {},
    getEditorText: () => 'text',
    setEditorText: () => {},
    renderPreview: () => {},
    liveDebug: { trace() {} },
    sourceFirstMode: true,
    editorElement: { id: 'editor' },
    previewElement: { id: 'preview' },
    rawModeButton: { id: 'raw' },
    liveModeButton: { id: 'live' },
    previewModeButton: { id: 'preview' },
    requestLivePreviewRefresh: () => {},
    getEditorView: () => ({ id: 'view' }),
    emitFenceVisibilityState: () => {},
    requestAnimationFrameFn: (callback) => callback(),
    factories: {
      createWorkspaceController(args) {
        workspaceControllerArgs.push(args);
        return {
          saveCurrentFile(force) {
            workspaceControllerCalls.saveCurrentFile.push(force);
            return Promise.resolve({ force });
          },
          scheduleAutosave() {
            workspaceControllerCalls.scheduleAutosave += 1;
          },
          openFile(path) {
            workspaceControllerCalls.openFile.push(path);
            return Promise.resolve({ path });
          },
          restoreWorkspaceState() {
            workspaceControllerCalls.restoreWorkspaceState += 1;
            return Promise.resolve('restored');
          },
          pickFolder() {
            workspaceControllerCalls.pickFolder += 1;
            return Promise.resolve('picked');
          },
          createNewNote() {
            workspaceControllerCalls.createNewNote += 1;
            return Promise.resolve('created');
          }
        };
      },
      createModeController(args) {
        modeControllerArgs.push(args);
        return {
          setViewMode(mode) {
            modeControllerCalls.setViewMode.push(mode);
          }
        };
      }
    }
  });

  assert.equal(workspaceControllerArgs.length, 1);
  assert.equal(modeControllerArgs.length, 1);
  assert.equal(workspaceControllerArgs[0].app, app);
  assert.equal(modeControllerArgs[0].app, app);
  assert.equal(typeof workspaceControllerArgs[0].setStatus, 'function');
  assert.equal(typeof workspaceControllerArgs[0].updateActionButtons, 'function');
  assert.equal(typeof workspaceControllerArgs[0].renderFileList, 'function');

  controllers.setStatus('ok', false);
  assert.deepEqual(workspaceCalls.setStatus, [{ message: 'ok', asError: false }]);

  controllers.updateActionButtons();
  assert.deepEqual(workspaceCalls.updateActionButtons, [
    {
      folderHandle: app.folderHandle,
      currentFileHandle: app.currentFileHandle
    }
  ]);

  controllers.renderFileList();
  assert.equal(workspaceCalls.renderFileList.length, 1);
  assert.equal(workspaceCalls.renderFileList[0].fileHandles, app.fileHandles);
  assert.equal(workspaceCalls.renderFileList[0].currentPath, 'note.md');
  await workspaceCalls.renderFileList[0].onOpenFile('notes/demo.md');
  assert.deepEqual(workspaceControllerCalls.openFile, ['notes/demo.md']);

  await controllers.saveCurrentFile(true);
  controllers.scheduleAutosave();
  await controllers.openFile('notes/new.md');
  await controllers.restoreWorkspaceState();
  await controllers.pickFolder();
  await controllers.createNewNote();
  controllers.setViewMode('live');

  assert.deepEqual(workspaceControllerCalls.saveCurrentFile, [true]);
  assert.equal(workspaceControllerCalls.scheduleAutosave, 1);
  assert.deepEqual(workspaceControllerCalls.openFile, ['notes/demo.md', 'notes/new.md']);
  assert.equal(workspaceControllerCalls.restoreWorkspaceState, 1);
  assert.equal(workspaceControllerCalls.pickFolder, 1);
  assert.equal(workspaceControllerCalls.createNewNote, 1);
  assert.deepEqual(modeControllerCalls.setViewMode, ['live']);
});
