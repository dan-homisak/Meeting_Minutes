import test from 'node:test';
import assert from 'node:assert/strict';
import { MARKDOWN_ENGINE_OPTIONS, createMarkdownEngine } from '../src/markdownConfig.js';

test('markdown engine enables soft line breaks for live rendering', () => {
  assert.equal(MARKDOWN_ENGINE_OPTIONS.breaks, true);

  const engine = createMarkdownEngine();
  const html = engine.render('First paragraph line.\nSecond paragraph line.\nThird paragraph line.');
  const breakTags = html.match(/<br\s*\/?>/gi) ?? [];

  assert.equal(breakTags.length, 2);
});

test('markdown engine preserves paragraph boundaries on blank lines', () => {
  const engine = createMarkdownEngine();
  const html = engine.render('Paragraph one.\n\nParagraph two.');
  const paragraphTags = html.match(/<p>/g) ?? [];

  assert.equal(paragraphTags.length, 2);
});
