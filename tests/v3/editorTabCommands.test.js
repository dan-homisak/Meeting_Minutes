import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { runShiftTabIndentCommand, runTabIndentCommand } from '../../src/bootstrap/createEditor.js';

function createEditorView(docText, anchor = 0) {
  let activeState = EditorState.create({
    doc: docText,
    selection: { anchor }
  });

  return {
    get state() {
      return activeState;
    },
    dispatch(transaction) {
      activeState = activeState.update(transaction).state;
    },
    readDoc() {
      return activeState.doc.toString();
    },
    readHead() {
      return activeState.selection.main.head;
    }
  };
}

test('tab command inserts indentation text instead of allowing browser focus traversal', () => {
  const view = createEditorView('alpha');
  const handled = runTabIndentCommand(view, null);

  assert.equal(handled, true);
  assert.equal(view.readDoc().length > 'alpha'.length, true);
  assert.equal(view.readHead() > 0, true);
});

test('tab command prioritizes list indentation handler when provided', () => {
  const view = createEditorView('- [ ] item', 2);
  let called = 0;
  const handled = runTabIndentCommand(view, () => {
    called += 1;
    return true;
  });

  assert.equal(handled, true);
  assert.equal(called, 1);
  assert.equal(view.readDoc(), '- [ ] item');
});

test('shift-tab command returns handled state even when no unindent applies', () => {
  const view = createEditorView('plain text', 5);
  const handled = runShiftTabIndentCommand(view, null);

  assert.equal(handled, true);
  assert.equal(view.readDoc(), 'plain text');
});
