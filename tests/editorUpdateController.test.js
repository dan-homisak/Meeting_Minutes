import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditorUpdateController } from '../src/live/editorUpdateController.js';

function createLiveDebugSpy() {
  const calls = {
    trace: []
  };
  return {
    calls,
    trace(event, data) {
      calls.trace.push({ event, data });
    }
  };
}

test('handleEditorUpdate forwards live selection updates', () => {
  const app = {
    viewMode: 'live',
    isLoadingFile: false,
    hasUnsavedChanges: false,
    lastSavedText: '',
    currentPath: 'notes/demo.md'
  };
  const selectionUpdates = [];
  const controller = createEditorUpdateController({
    app,
    liveDebug: createLiveDebugSpy(),
    handleSelectionUpdate: (update) => selectionUpdates.push(update)
  });
  const update = {
    selectionSet: true,
    docChanged: false,
    state: {
      doc: {
        toString() {
          return '';
        }
      }
    }
  };

  controller.handleEditorUpdate(update);

  assert.equal(selectionUpdates.length, 1);
  assert.equal(selectionUpdates[0], update);
});

test('handleEditorUpdate processes doc changes, preview render, and autosave scheduling', () => {
  const app = {
    viewMode: 'preview',
    isLoadingFile: false,
    hasUnsavedChanges: false,
    lastSavedText: 'previous',
    currentPath: 'notes/demo.md'
  };
  const liveDebug = createLiveDebugSpy();
  const previewCalls = [];
  const updateButtonCalls = [];
  const statusCalls = [];
  const autosaveCalls = [];
  const controller = createEditorUpdateController({
    app,
    liveDebug,
    handleSelectionUpdate() {},
    renderPreview: (text) => previewCalls.push(text),
    updateActionButtons: () => updateButtonCalls.push(true),
    setStatus: (message, asError = false) => statusCalls.push({ message, asError }),
    scheduleAutosave: () => autosaveCalls.push(true)
  });
  const update = {
    selectionSet: false,
    docChanged: true,
    state: {
      doc: {
        toString() {
          return 'updated';
        }
      }
    }
  };

  controller.handleEditorUpdate(update);

  assert.equal(liveDebug.calls.trace.length, 1);
  assert.equal(liveDebug.calls.trace[0].event, 'document.changed');
  assert.equal(liveDebug.calls.trace[0].data.mode, 'preview');
  assert.equal(liveDebug.calls.trace[0].data.length, 7);
  assert.deepEqual(previewCalls, ['updated']);
  assert.equal(app.hasUnsavedChanges, true);
  assert.equal(updateButtonCalls.length, 1);
  assert.equal(statusCalls.length, 1);
  assert.equal(statusCalls[0].message, 'Unsaved changes in notes/demo.md...');
  assert.equal(statusCalls[0].asError, false);
  assert.equal(autosaveCalls.length, 1);
});

test('handleEditorUpdate exits after tracing when file is loading', () => {
  const app = {
    viewMode: 'raw',
    isLoadingFile: true,
    hasUnsavedChanges: false,
    lastSavedText: 'saved',
    currentPath: 'notes/demo.md'
  };
  const liveDebug = createLiveDebugSpy();
  const updateButtonCalls = [];
  const statusCalls = [];
  const autosaveCalls = [];
  const controller = createEditorUpdateController({
    app,
    liveDebug,
    updateActionButtons: () => updateButtonCalls.push(true),
    setStatus: (message) => statusCalls.push(message),
    scheduleAutosave: () => autosaveCalls.push(true)
  });
  const update = {
    selectionSet: false,
    docChanged: true,
    state: {
      doc: {
        toString() {
          return 'new-content';
        }
      }
    }
  };

  controller.handleEditorUpdate(update);

  assert.equal(liveDebug.calls.trace.length, 1);
  assert.equal(app.hasUnsavedChanges, false);
  assert.equal(updateButtonCalls.length, 0);
  assert.equal(statusCalls.length, 0);
  assert.equal(autosaveCalls.length, 0);
});
