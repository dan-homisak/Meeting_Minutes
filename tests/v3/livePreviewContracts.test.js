import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createMarkdownEngine } from '../../src/markdownConfig.js';
import { createObsidianCoreParser } from '../../src/live-v4/parser/ObsidianCoreParser.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

test('live-v4 parser splits list items into separate editable blocks', () => {
  const parser = createObsidianCoreParser({
    markdownEngine: createMarkdownEngine()
  });

  const markdown = '- [ ] alpha\n- [x] beta\n\nParagraph\n';
  const result = parser.setText(markdown, 'list-split');
  const blocks = result.model.blocks;

  const taskBlocks = blocks.filter((block) => block.type === 'task');
  assert.equal(taskBlocks.length >= 2, true);

  assert.equal(taskBlocks[0].to <= taskBlocks[1].from, true);
  assert.equal(taskBlocks[0].lineFrom < taskBlocks[1].lineFrom, true);
  assert.equal(taskBlocks.some((block) => block.attrs?.checked === true), true);
  assert.equal(taskBlocks.some((block) => block.attrs?.checked === false), true);
});

test('live-v4 parser splits multi-line paragraphs into line-sized editable blocks', () => {
  const parser = createObsidianCoreParser({
    markdownEngine: createMarkdownEngine()
  });

  const markdown = 'Alpha line one that is wrapped by source\nAlpha line two same paragraph\n\nNext block\n';
  const result = parser.setText(markdown, 'paragraph-split');
  const paragraphBlocks = result.model.blocks.filter((block) => block.type === 'paragraph');

  assert.equal(paragraphBlocks.length >= 3, true);
  assert.equal(paragraphBlocks[0].lineFrom < paragraphBlocks[1].lineFrom, true);
  assert.equal(paragraphBlocks[0].to <= paragraphBlocks[1].from, true);
});

test('editor stack removed basicSetup and keeps persistent line-number gutters', async () => {
  const createEditorPath = join(ROOT, 'src/bootstrap/createEditor.js');
  const stylePath = join(ROOT, 'src/style.css');

  const [createEditorContent, styleContent] = await Promise.all([
    readFile(createEditorPath, 'utf8'),
    readFile(stylePath, 'utf8')
  ]);

  assert.doesNotMatch(createEditorContent, /basicSetup/);
  assert.match(createEditorContent, /lineNumbers\(\)/);
  assert.doesNotMatch(styleContent, /\.cm-gutters\s*\{[^}]*display:\s*none\s*!important/i);
});
