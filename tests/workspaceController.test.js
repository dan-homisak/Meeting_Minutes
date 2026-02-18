import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceController } from '../src/workspace/workspaceController.js';

function createBaseHarness(overrides = {}) {
  const statusCalls = [];
  const app = {
    folderHandle: null,
    fileHandles: new Map(),
    currentPath: null,
    currentFileHandle: null,
    lastSavedText: '',
    hasUnsavedChanges: true,
    autosaveTimer: null,
    viewMode: 'raw',
    ...overrides.app
  };

  const deps = {
    app,
    windowObject: overrides.windowObject ?? {
      setTimeout(callback) {
        callback();
        return 1;
      },
      clearTimeout() {},
      prompt() {
        return null;
      }
    },
    walkDirectory: overrides.walkDirectory ?? (async () => new Map()),
    ensureReadWritePermission: overrides.ensureReadWritePermission ?? (async () => true),
    isMarkdownFile: overrides.isMarkdownFile ?? ((name) => /\.md$/i.test(name)),
    readWorkspaceFromDb: overrides.readWorkspaceFromDb ?? (async () => null),
    writeWorkspaceToDb: overrides.writeWorkspaceToDb ?? (async () => {}),
    setStatus: overrides.setStatus ?? ((message, asError = false) => statusCalls.push({ message, asError })),
    updateActionButtons: overrides.updateActionButtons ?? (() => {}),
    renderFileList: overrides.renderFileList ?? (() => {}),
    getEditorText: overrides.getEditorText ?? (() => 'note body'),
    setEditorText: overrides.setEditorText ?? (() => {}),
    readDocumentModel: overrides.readDocumentModel ?? (() => null),
    renderPreview: overrides.renderPreview ?? (() => {}),
    liveDebug: overrides.liveDebug ?? { info() {} }
  };

  return {
    app,
    statusCalls,
    controller: createWorkspaceController(deps)
  };
}

test('saveCurrentFile reports permission denial without writing', async () => {
  let createWritableCalled = false;
  const handle = {
    async createWritable() {
      createWritableCalled = true;
      return {
        async write() {},
        async close() {}
      };
    }
  };

  const { controller, statusCalls } = createBaseHarness({
    app: {
      currentFileHandle: handle,
      currentPath: 'notes/demo.md',
      hasUnsavedChanges: true
    },
    ensureReadWritePermission: async () => false
  });

  await controller.saveCurrentFile();

  assert.equal(createWritableCalled, false);
  assert.deepEqual(statusCalls.at(-1), {
    message: 'Write permission was denied for this file.',
    asError: true
  });
});

test('openFile updates app state and persists workspace', async () => {
  let persistedPayload = null;
  let renderedPreview = null;
  let renderedPreviewOptions = null;
  let editorTextSet = null;
  let loggedRead = null;
  let renderFileListCalls = 0;
  let updateActionCalls = 0;

  const handle = {
    async getFile() {
      return {
        size: 11,
        async text() {
          return '# heading\n';
        }
      };
    }
  };

  const { app, controller, statusCalls } = createBaseHarness({
    app: {
      folderHandle: { name: 'workspace' },
      fileHandles: new Map([['notes/demo.md', handle]]),
      viewMode: 'preview'
    },
    writeWorkspaceToDb: async (payload) => {
      persistedPayload = payload;
    },
    setEditorText: (value) => {
      editorTextSet = value;
    },
    renderPreview: (value, options) => {
      renderedPreview = value;
      renderedPreviewOptions = options;
    },
    readDocumentModel: () => ({
      text: '# heading\n',
      blocks: [{ from: 0, to: 10 }]
    }),
    liveDebug: {
      info(event, data) {
        if (event === 'file.open.read') {
          loggedRead = data;
        }
      }
    },
    renderFileList: () => {
      renderFileListCalls += 1;
    },
    updateActionButtons: () => {
      updateActionCalls += 1;
    }
  });

  await controller.openFile('notes/demo.md');

  assert.equal(app.currentPath, 'notes/demo.md');
  assert.equal(app.currentFileHandle, handle);
  assert.equal(app.lastSavedText, '# heading\n');
  assert.equal(app.hasUnsavedChanges, false);
  assert.equal(editorTextSet, '# heading\n');
  assert.equal(renderedPreview, '# heading\n');
  assert.equal(renderedPreviewOptions.documentModel.text, '# heading\n');
  assert.equal(renderFileListCalls, 1);
  assert.equal(updateActionCalls, 1);
  assert.deepEqual(persistedPayload, {
    folderHandle: app.folderHandle,
    currentPath: 'notes/demo.md'
  });
  assert.deepEqual(loggedRead, {
    path: 'notes/demo.md',
    byteLength: 11,
    textLength: 10
  });
  assert.deepEqual(statusCalls.at(-1), {
    message: 'Editing notes/demo.md',
    asError: false
  });
});

test('pickFolder warns when directory picker is unavailable', async () => {
  const { controller, statusCalls } = createBaseHarness({
    windowObject: {
      setTimeout(callback) {
        callback();
        return 1;
      },
      clearTimeout() {},
      prompt() {
        return null;
      }
    }
  });

  await controller.pickFolder();

  assert.deepEqual(statusCalls.at(-1), {
    message: 'This browser does not support local folder editing. Use Chrome or Edge desktop.',
    asError: true
  });
});
