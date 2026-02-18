import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_EDITOR_DOC, createEditor } from '../src/bootstrap/createEditor.js';

function createFactoryHarness() {
  const capture = {
    viewConfig: null,
    stateConfig: null,
    keyBindings: null,
    decorationsStateField: null,
    decorationsMapper: null,
    autocompletionConfig: null,
    updateListener: null
  };

  return {
    capture,
    factories: {
      createEditorView(config) {
        capture.viewConfig = config;
        return {
          type: 'view',
          config
        };
      },
      createEditorState(config) {
        capture.stateConfig = config;
        return {
          type: 'state',
          config
        };
      },
      createMarkdownExtension() {
        return { type: 'markdown' };
      },
      createKeymapExtension(bindings) {
        capture.keyBindings = bindings;
        return { type: 'keymap', bindings };
      },
      createDecorationsExtension(stateField, mapDecorations) {
        capture.decorationsStateField = stateField;
        capture.decorationsMapper = mapDecorations;
        return { type: 'decorations' };
      },
      createAutocompletionExtension(config) {
        capture.autocompletionConfig = config;
        return { type: 'autocompletion' };
      },
      createUpdateListenerExtension(listener) {
        capture.updateListener = listener;
        return { type: 'update-listener' };
      },
      lineWrappingExtension: { type: 'line-wrapping' },
      indentWithTabCommand() {
        return true;
      },
      insertNewlineCommand() {
        return true;
      },
      basicSetupExtension: { type: 'basic-setup' }
    }
  };
}

test('createEditor builds default doc/editor state and wires key/update handlers', () => {
  const { capture, factories } = createFactoryHarness();
  const livePreviewStateField = {
    id: 'live-preview-field'
  };
  const livePreviewAtomicRanges = {
    id: 'atomic-ranges'
  };
  const livePreviewPointerHandlers = {
    id: 'pointer-handlers'
  };
  const slashCommandCompletion = {
    id: 'slash-completion'
  };
  const moveCalls = [];
  const updateCalls = [];

  const view = createEditor({
    parent: { id: 'editor-parent' },
    livePreviewStateField,
    livePreviewAtomicRanges,
    livePreviewPointerHandlers,
    slashCommandCompletion,
    moveLiveCursorVertically: (editorView, direction, trigger) => {
      moveCalls.push({ editorView, direction, trigger });
      return true;
    },
    handleEditorUpdate: (update) => updateCalls.push(update),
    factories
  });

  assert.equal(view.type, 'view');
  assert.equal(capture.viewConfig.parent.id, 'editor-parent');
  assert.equal(capture.stateConfig.doc, DEFAULT_EDITOR_DOC);
  assert.deepEqual(capture.stateConfig.selection, { anchor: 0 });
  assert.equal(capture.stateConfig.extensions.length, 10);
  assert.equal(capture.decorationsStateField, livePreviewStateField);
  assert.equal(
    capture.decorationsMapper({
      decorations: 'decorations-sentinel'
    }),
    'decorations-sentinel'
  );
  assert.equal(capture.autocompletionConfig.activateOnTyping, true);
  assert.deepEqual(capture.autocompletionConfig.override, [slashCommandCompletion]);
  assert.equal(capture.keyBindings.length, 4);

  const arrowDownBinding = capture.keyBindings.find((binding) => binding.key === 'ArrowDown');
  const arrowUpBinding = capture.keyBindings.find((binding) => binding.key === 'ArrowUp');
  assert.equal(arrowDownBinding.run({ id: 'view-1' }), true);
  assert.equal(arrowUpBinding.run({ id: 'view-2' }), true);
  assert.deepEqual(moveCalls, [
    {
      editorView: { id: 'view-1' },
      direction: 1,
      trigger: 'ArrowDown'
    },
    {
      editorView: { id: 'view-2' },
      direction: -1,
      trigger: 'ArrowUp'
    }
  ]);

  const updatePayload = { id: 'update-1' };
  capture.updateListener(updatePayload);
  assert.deepEqual(updateCalls, [updatePayload]);
});

test('createEditor uses custom doc and arrow handlers return false without cursor callback', () => {
  const { capture, factories } = createFactoryHarness();

  createEditor({
    parent: { id: 'editor-parent' },
    livePreviewStateField: { id: 'live-preview-field' },
    livePreviewAtomicRanges: { id: 'atomic-ranges' },
    livePreviewPointerHandlers: { id: 'pointer-handlers' },
    slashCommandCompletion: { id: 'slash-completion' },
    initialDoc: 'custom doc',
    factories
  });

  assert.equal(capture.stateConfig.doc, 'custom doc');
  const arrowDownBinding = capture.keyBindings.find((binding) => binding.key === 'ArrowDown');
  const arrowUpBinding = capture.keyBindings.find((binding) => binding.key === 'ArrowUp');
  assert.equal(arrowDownBinding.run({ id: 'view-1' }), false);
  assert.equal(arrowUpBinding.run({ id: 'view-2' }), false);
});
