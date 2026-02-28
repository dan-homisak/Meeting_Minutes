import test from 'node:test';
import assert from 'node:assert/strict';
import { createModeController } from '../src/ui/modeController.js';

function createElementMock() {
  const classes = new Set();
  const attributes = new Map();
  return {
    hidden: false,
    classList: {
      toggle(className, enabled) {
        if (enabled) {
          classes.add(className);
        } else {
          classes.delete(className);
        }
      },
      contains(className) {
        return classes.has(className);
      }
    },
    setAttribute(name, value) {
      attributes.set(name, value);
    },
    getAttribute(name) {
      return attributes.get(name) ?? null;
    }
  };
}

test('setViewMode preview toggles UI and renders preview content', () => {
  const app = { viewMode: 'raw' };
  const editorElement = createElementMock();
  const previewElement = createElementMock();
  const rawModeButton = createElementMock();
  const liveModeButton = createElementMock();
  const previewModeButton = createElementMock();
  const previewCalls = [];
  const refreshCalls = [];
  const documentModel = {
    text: '# note',
    blocks: [{ from: 0, to: 6 }]
  };

  const modeController = createModeController({
    app,
    liveDebug: { info() {} },
    editorElement,
    previewElement,
    rawModeButton,
    liveModeButton,
    previewModeButton,
    getEditorText: () => '# note',
    readDocumentModel: () => documentModel,
    renderPreview: (text, options) => previewCalls.push({ text, options }),
    requestLivePreviewRefresh: (reason) => refreshCalls.push(reason),
    getEditorView: () => ({
      focus() {}
    }),
    emitFenceVisibilityState() {},
    requestAnimationFrameFn: (callback) => {
      callback();
      return 1;
    }
  });

  modeController.setViewMode('preview');

  assert.equal(app.viewMode, 'preview');
  assert.equal(editorElement.hidden, true);
  assert.equal(previewElement.hidden, false);
  assert.equal(previewModeButton.classList.contains('active'), true);
  assert.equal(rawModeButton.classList.contains('active'), false);
  assert.equal(liveModeButton.classList.contains('active'), false);
  assert.equal(previewCalls.length, 1);
  assert.equal(previewCalls[0].text, '# note');
  assert.equal(previewCalls[0].options.documentModel, documentModel);
  assert.deepEqual(refreshCalls, []);
});

test('setViewMode live refreshes editor and emits fence visibility state', () => {
  const app = { viewMode: 'raw' };
  const editorElement = createElementMock();
  const previewElement = createElementMock();
  const rawModeButton = createElementMock();
  const liveModeButton = createElementMock();
  const previewModeButton = createElementMock();
  const refreshCalls = [];
  const fenceCalls = [];
  let focusCount = 0;

  const view = {
    focus() {
      focusCount += 1;
    }
  };

  const modeController = createModeController({
    app,
    liveDebug: { info() {} },
    editorElement,
    previewElement,
    rawModeButton,
    liveModeButton,
    previewModeButton,
    getEditorText: () => '# note',
    renderPreview() {},
    requestLivePreviewRefresh: (reason) => refreshCalls.push(reason),
    getEditorView: () => view,
    emitFenceVisibilityState: (emittedView, reason) => {
      fenceCalls.push({ emittedView, reason });
    },
    requestAnimationFrameFn: (callback) => {
      callback();
      return 1;
    }
  });

  modeController.setViewMode('live');

  assert.equal(app.viewMode, 'live');
  assert.equal(editorElement.hidden, false);
  assert.equal(previewElement.hidden, true);
  assert.equal(editorElement.classList.contains('live-mode'), true);
  assert.equal(liveModeButton.classList.contains('active'), true);
  assert.equal(focusCount, 1);
  assert.deepEqual(refreshCalls, ['mode-change', 'mode-change-post-frame']);
  assert.equal(fenceCalls.length, 2);
  assert.equal(fenceCalls[0].reason, 'mode-change');
  assert.equal(fenceCalls[1].reason, 'mode-change-post-frame');
  assert.equal(fenceCalls[0].emittedView, view);
  assert.equal(fenceCalls[1].emittedView, view);
});
