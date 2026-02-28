import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { createDocumentSession } from '../src/core/document/DocumentSession.js';
import { createMarkdownEngine } from '../src/markdownConfig.js';

test('DocumentSession seeds and incrementally updates model from editor transactions', () => {
  const session = createDocumentSession({
    markdownEngine: createMarkdownEngine()
  });

  const source = '# Title\n\nParagraph one.\n\nParagraph two.\n';
  const seeded = session.setText(source, {
    reason: 'seed'
  });
  assert.equal(seeded.model.text, source);
  assert.ok(seeded.model.blocks.length > 0);

  const startState = EditorState.create({
    doc: source
  });
  const editTransaction = startState.update({
    changes: {
      from: source.indexOf('two'),
      to: source.indexOf('two') + 3,
      insert: 'two (edited)'
    }
  });
  const seededEditedBlock = seeded.model.blocks.find((block) => (
    source.slice(block.from, block.to).includes('Paragraph two.')
  ));
  const updated = session.applyEditorTransaction(editTransaction);
  const updatedEditedBlock = updated.model.blocks.find((block) => (
    updated.model.text.slice(block.from, block.to).includes('Paragraph two (edited).')
  ));

  assert.equal(updated.classification.docChanged, true);
  assert.equal(updated.model.meta.parser, 'incremental');
  assert.equal(updated.model.text, editTransaction.state.doc.toString());
  assert.equal(updated.diff.textChanged, true);
  assert.ok(seededEditedBlock?.id);
  assert.equal(updatedEditedBlock?.id, seededEditedBlock?.id);
  assert.ok(Array.isArray(updated.diff.changedBlockIds));
  assert.ok(updated.diff.changedBlockIds.includes(seededEditedBlock.id));
});

test('DocumentSession ensureText avoids unnecessary reparses', () => {
  const session = createDocumentSession({
    markdownEngine: createMarkdownEngine()
  });

  const source = 'alpha\n\nbeta\n';
  session.setText(source, {
    reason: 'seed'
  });
  const ensured = session.ensureText(source);
  assert.equal(ensured.diff, null);
  assert.equal(ensured.model.text, source);
});
