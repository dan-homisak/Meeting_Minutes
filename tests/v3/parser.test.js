import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { createMarkdownEngine } from '../../src/markdownConfig.js';
import { createObsidianCoreParser } from '../../src/live-v3/parser/ObsidianCoreParser.js';

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
