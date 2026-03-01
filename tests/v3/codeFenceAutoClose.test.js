import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { buildCodeFenceAutoCloseSpec } from '../../src/bootstrap/createEditor.js';

function applyAutoClose(docText, lineNumber, column, text) {
  const state = EditorState.create({ doc: docText });
  const line = state.doc.line(lineNumber);
  const from = Math.min(line.to, line.from + column);
  const spec = buildCodeFenceAutoCloseSpec(state, {
    from,
    to: from,
    text
  });

  if (!spec) {
    return {
      spec,
      text: state.doc.toString(),
      head: from
    };
  }

  const nextState = state.update(spec).state;
  return {
    spec,
    text: nextState.doc.toString(),
    head: nextState.selection.main.head
  };
}

test('auto-closing code fence inserts closing fence and moves next-line content down', () => {
  const result = applyAutoClose('``\nnext line\n', 1, 2, '`');
  assert.ok(result.spec);
  assert.equal(result.text, '```\n```\nnext line\n');
  assert.equal(result.head, 3);
});

test('auto-closing code fence appends closing fence when no next line exists', () => {
  const result = applyAutoClose('``', 1, 2, '`');
  assert.ok(result.spec);
  assert.equal(result.text, '```\n```');
  assert.equal(result.head, 3);
});

test('auto-closing code fence preserves indentation on generated closing fence', () => {
  const result = applyAutoClose('  ``\n  keep me\n', 1, 4, '`');
  assert.ok(result.spec);
  assert.equal(result.text, '  ```\n  ```\n  keep me\n');
  assert.equal(result.head, 5);
});

test('auto-closing code fence does not trigger when line has non-fence content', () => {
  const result = applyAutoClose('alpha``\nnext\n', 1, 7, '`');
  assert.equal(result.spec, null);
  assert.equal(result.text, 'alpha``\nnext\n');
});
