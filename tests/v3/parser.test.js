import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { createMarkdownEngine } from '../../src/markdownConfig.js';
import { createObsidianCoreParser } from '../../src/live-v4/parser/ObsidianCoreParser.js';

test('createObsidianCoreParser builds core model and applies transactions incrementally', () => {
  const parser = createObsidianCoreParser({
    markdownEngine: createMarkdownEngine()
  });

  const initial = parser.setText('# Title\n\n- [ ] item\n', 'initial');
  assert.equal(initial.model.meta.dialect, 'obsidian-core');
  assert.equal(initial.model.blocks.length > 0, true);

  const state = EditorState.create({
    doc: '# Title\n\n- [ ] item\n'
  });
  const transaction = state.update({
    changes: {
      from: state.doc.length,
      to: state.doc.length,
      insert: '\n## Next'
    }
  });

  const updated = parser.applyEditorTransaction(transaction);
  assert.equal(updated.model.text.includes('## Next'), true);
  assert.equal(updated.model.meta.parser === 'incremental' || updated.model.meta.parser === 'full', true);
  assert.equal(Array.isArray(updated.model.inlines), true);
});

test('parser preserves frontmatter as source-backed block range', () => {
  const parser = createObsidianCoreParser({
    markdownEngine: createMarkdownEngine()
  });

  const result = parser.setText('---\ntitle: Test\n---\n\n# Note\n', 'frontmatter');
  const frontmatter = result.model.blocks.find((block) => block.type === 'frontmatter');

  assert.ok(frontmatter);
  assert.equal(frontmatter.from, 0);
  assert.equal(frontmatter.to > frontmatter.from, true);
});

test('parser recognizes empty list/task marker lines with stable depth metadata', () => {
  const parser = createObsidianCoreParser({
    markdownEngine: createMarkdownEngine()
  });

  const source = '-\n  -\n- [ ]\n  - [ ]\n1.\n  1.\n';
  const result = parser.setText(source, 'empty-list-markers');

  const summary = result.model.blocks.map((block) => ({
    type: block.type,
    depth: block.depth,
    text: source.slice(block.from, block.to)
  }));

  assert.deepEqual(summary, [
    { type: 'list', depth: 0, text: '-' },
    { type: 'list', depth: 1, text: '  -' },
    { type: 'task', depth: 0, text: '- [ ]' },
    { type: 'task', depth: 1, text: '  - [ ]' },
    { type: 'list', depth: 0, text: '1.' },
    { type: 'list', depth: 1, text: '  1.' }
  ]);
});

test('parser captures highlight inline spans for ==mark== syntax', () => {
  const parser = createObsidianCoreParser({
    markdownEngine: createMarkdownEngine()
  });

  const source = 'Paragraph with ==mark== text\n';
  const result = parser.setText(source, 'highlight-inline');
  const highlight = result.model.inlines.find((inline) => inline.type === 'highlight');

  assert.ok(highlight);
  assert.equal(source.slice(highlight.from, highlight.to), '==mark==');
});
