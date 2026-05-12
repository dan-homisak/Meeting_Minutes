import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarkdownEngine } from '../../src/markdownConfig.js';
import { createMarkdownRenderer } from '../../src/live-v4/render/MarkdownRenderer.js';

function createRenderer() {
  return createMarkdownRenderer({
    markdownEngine: createMarkdownEngine()
  });
}

test('markdown renderer renders tables as table markup', () => {
  const renderer = createRenderer();
  const html = renderer.renderMarkdownHtml('| A | B |\n| --- | --- |\n| 1 | 2 |', {
    blockType: 'table'
  });

  assert.match(html, /<table>/);
  assert.match(html, /<th>A<\/th>/);
  assert.match(html, /<td>1<\/td>/);
});

test('markdown renderer uses stable placeholders for relative images and embeds', () => {
  const renderer = createRenderer();
  const html = renderer.renderMarkdownHtml('![alt text](missing-image.png) and ![[diagram.png]]', {
    blockType: 'paragraph'
  });

  assert.match(html, /mm-live-v4-image-placeholder/);
  assert.match(html, /alt text/);
  assert.match(html, /diagram\.png/);
  assert.doesNotMatch(html, /<img\b/);
});

test('markdown renderer renders html and footnote definitions', () => {
  const renderer = createRenderer();
  const html = renderer.renderMarkdownHtml('Inline HTML <span>span text</span>', {
    blockType: 'html'
  });
  assert.match(html, /<span>span text<\/span>/);

  const footnote = renderer.renderMarkdownHtml('[^1]: Footnote body.', {
    blockType: 'footnote'
  });
  assert.match(footnote, /mm-live-v4-footnote-definition/);
  assert.match(footnote, /Footnote body/);
});
