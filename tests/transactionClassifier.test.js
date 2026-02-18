import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import {
  applyChangeSpansToText,
  classifyEditorTransaction
} from '../src/core/document/TransactionClassifier.js';

test('classifyEditorTransaction summarizes document edits and change bounds', () => {
  const startState = EditorState.create({
    doc: 'alpha\nbeta\n'
  });
  const transaction = startState.update({
    changes: {
      from: 6,
      to: 10,
      insert: 'BETA'
    }
  });

  const classification = classifyEditorTransaction(transaction);

  assert.equal(classification.docChanged, true);
  assert.equal(classification.selectionSet, false);
  assert.equal(classification.changeCount, 1);
  assert.deepEqual(classification.oldChangedBounds, { from: 6, to: 10 });
  assert.deepEqual(classification.newChangedBounds, { from: 6, to: 10 });
  assert.equal(classification.changeSpans[0].insertedText, 'BETA');
  assert.equal(
    applyChangeSpansToText(startState.doc.toString(), classification.changeSpans),
    'alpha\nBETA\n'
  );
});

test('classifyEditorTransaction marks selection-only updates', () => {
  const startState = EditorState.create({
    doc: 'line one\nline two\n'
  });
  const transaction = startState.update({
    selection: {
      anchor: 5,
      head: 5
    }
  });

  const classification = classifyEditorTransaction(transaction);
  assert.equal(classification.docChanged, false);
  assert.equal(classification.selectionSet, true);
  assert.equal(classification.changeCount, 0);
});
