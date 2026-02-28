import test from 'node:test';
import assert from 'node:assert/strict';
import { MARKDOWN_ENGINE_OPTIONS, createMarkdownEngine } from '../src/markdownConfig.js';

test('markdown engine keeps hard line breaks disabled for Obsidian-like rendering', () => {
  assert.equal(MARKDOWN_ENGINE_OPTIONS.breaks, false);

  const engine = createMarkdownEngine();
  const html = engine.render('First paragraph line.\nSecond paragraph line.\nThird paragraph line.');
  const breakTags = html.match(/<br\s*\/?>/gi) ?? [];

  assert.equal(breakTags.length, 0);
});

test('markdown engine preserves paragraph boundaries on blank lines', () => {
  const engine = createMarkdownEngine();
  const html = engine.render('Paragraph one.\n\nParagraph two.');
  const paragraphTags = html.match(/<p>/g) ?? [];

  assert.equal(paragraphTags.length, 2);
});
