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

test('scheduleAutosave replaces pending timer and writes current file on timeout', async () => {
  const timerCallbacks = new Map();
  let nextTimerId = 1;
  const cleared = [];

  let writtenText = null;
  let writableClosed = false;
  const currentFileHandle = {
    async createWritable() {
      return {
        async write(value) {
          writtenText = value;
        },
        async close() {
          writableClosed = true;
        }
      };
    }
  };

  const { app, controller, statusCalls } = createBaseHarness({
    app: {
      currentFileHandle,
      currentPath: 'notes/autosave.md',
      hasUnsavedChanges: true,
      autosaveTimer: 7
    },
    windowObject: {
      setTimeout(callback) {
        const timerId = nextTimerId;
        nextTimerId += 1;
        timerCallbacks.set(timerId, callback);
        return timerId;
      },
      clearTimeout(timerId) {
        cleared.push(timerId);
      },
      prompt() {
        return null;
      }
    },
    getEditorText: () => 'autosave body',
    ensureReadWritePermission: async () => true,
    updateActionButtons: () => {}
  });

  controller.scheduleAutosave();
  assert.deepEqual(cleared, [7]);
  assert.equal(typeof app.autosaveTimer, 'number');
  const callback = timerCallbacks.get(app.autosaveTimer);
  assert.equal(typeof callback, 'function');

  callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writtenText, 'autosave body');
  assert.equal(writableClosed, true);
  assert.equal(app.hasUnsavedChanges, false);
  assert.deepEqual(statusCalls.at(-1), {
    message: 'Saved notes/autosave.md',
    asError: false
  });
});

test('restoreWorkspaceState loads granted folder and preferred file path', async () => {
  const handleAlpha = {
    async getFile() {
      return {
        size: 8,
        async text() {
          return '# Alpha\n';
        }
      };
    }
  };
  const handleBeta = {
    async getFile() {
      return {
        size: 7,
        async text() {
          return '# Beta\n';
        }
      };
    }
  };

  let editorTextSet = null;
  const { app, controller, statusCalls } = createBaseHarness({
    app: {
      viewMode: 'raw'
    },
    readWorkspaceFromDb: async () => ({
      folderHandle: {
        name: 'vault',
        async queryPermission() {
          return 'granted';
        }
      },
      currentPath: 'notes/beta.md'
    }),
    walkDirectory: async () => new Map([
      ['notes/alpha.md', handleAlpha],
      ['notes/beta.md', handleBeta]
    ]),
    setEditorText: (value) => {
      editorTextSet = value;
    },
    liveDebug: { info() {} }
  });

  await controller.restoreWorkspaceState();

  assert.equal(app.folderHandle.name, 'vault');
  assert.equal(app.currentPath, 'notes/beta.md');
  assert.equal(app.currentFileHandle, handleBeta);
  assert.equal(editorTextSet, '# Beta\n');
  assert.deepEqual(statusCalls.at(-1), {
    message: 'Restored folder "vault".',
    asError: false
  });
});

test('restoreWorkspaceState prompts re-open when persisted folder permission is not granted', async () => {
  const { app, controller, statusCalls } = createBaseHarness({
    app: {
      currentPath: 'existing/path.md'
    },
    readWorkspaceFromDb: async () => ({
      folderHandle: {
        name: 'vault',
        async queryPermission() {
          return 'prompt';
        }
      },
      currentPath: 'notes/demo.md'
    })
  });

  await controller.restoreWorkspaceState();

  assert.equal(app.currentPath, 'existing/path.md');
  assert.deepEqual(statusCalls.at(-1), {
    message: 'Re-open your folder to continue editing local markdown files.',
    asError: false
  });
});
