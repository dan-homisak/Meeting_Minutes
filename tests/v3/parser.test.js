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

test('parser keeps table and html ranges renderable as whole blocks', () => {
  const parser = createObsidianCoreParser({
    markdownEngine: createMarkdownEngine()
  });

  const source = [
    '| Left | Right |',
    '| --- | --- |',
    '| A | B |',
    '',
    'Inline HTML <span>text</span>',
    '',
    '<div>',
    'HTML block',
    '</div>',
    ''
  ].join('\n');
  const result = parser.setText(source, 'renderable-blocks');

  const table = result.model.blocks.find((block) => block.type === 'table');
  assert.ok(table);
  assert.equal(source.slice(table.from, table.to), '| Left | Right |\n| --- | --- |\n| A | B |');

  const htmlBlocks = result.model.blocks.filter((block) => block.type === 'html');
  assert.equal(htmlBlocks.length, 2);
  assert.equal(source.slice(htmlBlocks[0].from, htmlBlocks[0].to), 'Inline HTML <span>text</span>');
  assert.equal(source.slice(htmlBlocks[1].from, htmlBlocks[1].to), '<div>\nHTML block\n</div>');
});

test('parser covers reference definitions and footnote definitions', () => {
  const parser = createObsidianCoreParser({
    markdownEngine: createMarkdownEngine()
  });

  const source = '[ref]: https://example.net\n\nFootnote marker[^1].\n\n[^1]: Footnote body.\n';
  const result = parser.setText(source, 'definitions');

  const definition = result.model.blocks.find((block) => block.type === 'definition');
  assert.ok(definition);
  assert.equal(source.slice(definition.from, definition.to), '[ref]: https://example.net');

  const footnote = result.model.blocks.find((block) => block.type === 'footnote');
  assert.ok(footnote);
  assert.equal(source.slice(footnote.from, footnote.to), '[^1]: Footnote body.');
});

test('parser captures richer inline spans used by live inline rendering', () => {
  const parser = createObsidianCoreParser({
    markdownEngine: createMarkdownEngine()
  });

  const source = [
    'Inline [inline link](https://example.com "title"), [ref link][ref], <https://example.com>, https://example.org, ***both***, \\*literal\\*, ![[diagram.png]], [^1], and code ``tick ` inside``.',
    `Hard break${'\\'}`,
    ''
  ].join('\n');
  const result = parser.setText(source, 'richer-inline');
  const spans = result.model.inlines.map((inline) => ({
    type: inline.type,
    text: source.slice(inline.from, inline.to)
  }));

  assert.ok(spans.some((span) => span.type === 'link' && span.text === '[inline link](https://example.com "title")'));
  assert.ok(spans.some((span) => span.type === 'reference-link' && span.text === '[ref link][ref]'));
  assert.ok(spans.some((span) => span.type === 'autolink' && span.text === '<https://example.com>'));
  assert.ok(spans.some((span) => span.type === 'bare-link' && span.text === 'https://example.org'));
  assert.ok(spans.some((span) => span.type === 'strong-emphasis' && span.text === '***both***'));
  assert.equal(spans.filter((span) => span.type === 'escape').length >= 2, true);
  assert.ok(spans.some((span) => span.type === 'image' && span.text === '![[diagram.png]]'));
  assert.ok(spans.some((span) => span.type === 'footnote-ref' && span.text === '[^1]'));
  assert.ok(spans.some((span) => span.type === 'code' && span.text === '``tick ` inside``'));
  assert.ok(spans.some((span) => span.type === 'hardbreak' && span.text === '\\'));
});
