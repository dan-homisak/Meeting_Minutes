import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createMarkdownEngine } from '../src/markdownConfig.js';
import { createMarkdownRenderer } from '../src/core/render/MarkdownRenderer.js';
import { annotateMarkdownTokensWithSourceRanges } from '../src/core/mapping/SourceRangeMapper.js';
import { createIncrementalMarkdownParser } from '../src/core/parser/IncrementalMarkdownParser.js';
import { createDocModel } from '../src/core/model/DocModel.js';

function resolveFixturePath(relativePath) {
  return fileURLToPath(new URL(`../Markdown_Test_Files/v2/${relativePath}`, import.meta.url));
}

function normalizeHtml(value) {
  return String(value ?? '').replace(/\r\n/g, '\n').trim();
}

test('fixture vault preview snapshots stay stable for core parity fixtures', async () => {
  const markdownEngine = createMarkdownEngine();
  const renderer = createMarkdownRenderer({
    markdownEngine,
    previewElement: null,
    annotateMarkdownTokensWithSourceRanges
  });

  const fixtures = [
    ['core_live_preview_fixture.md', 'snapshots/core_live_preview_fixture.preview.html'],
    ['cursor_mapping_fixture.md', 'snapshots/cursor_mapping_fixture.preview.html']
  ];

  for (const [fixtureFile, snapshotFile] of fixtures) {
    const fixtureSource = await readFile(resolveFixturePath(fixtureFile), 'utf8');
    const expectedHtml = await readFile(resolveFixturePath(snapshotFile), 'utf8');
    const actualHtml = renderer.renderPreview(fixtureSource);
    assert.equal(normalizeHtml(actualHtml), normalizeHtml(expectedHtml));
  }
});

test('fixture vault core markdown produces expected V2 model semantics', async () => {
  const markdownEngine = createMarkdownEngine();
  const parser = createIncrementalMarkdownParser({
    markdownEngine
  });
  const source = await readFile(resolveFixturePath('core_live_preview_fixture.md'), 'utf8');
  const parsed = parser.parseFull(source, {
    reason: 'fixture-parity'
  });
  const model = createDocModel({
    version: 1,
    text: source,
    blocks: parsed.blocks,
    inlineSpans: parsed.inlineSpans
  });

  assert.equal(model.frontmatter?.type, 'frontmatter');
  assert.ok(model.blocks.some((block) => block.type === 'heading'));
  assert.ok(model.blocks.some((block) => block.type === 'task'));
  assert.ok(model.blocks.some((block) => block.type === 'table'));
  assert.ok(model.inline.some((span) => span.type === 'wikilink'));
  assert.ok(model.inline.some((span) => span.type === 'embed'));
});
