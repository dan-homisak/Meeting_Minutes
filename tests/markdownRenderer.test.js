import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarkdownRenderer } from '../src/core/render/MarkdownRenderer.js';
import { createMarkdownEngine } from '../src/markdownConfig.js';

function createMarkdownEngineSpy() {
  const calls = {
    render: [],
    parse: []
  };

  return {
    calls,
    render(source) {
      calls.render.push(source);
      return `<p>${source}</p>`;
    },
    parse(source) {
      calls.parse.push(source);
      return [];
    },
    renderer: {
      render() {
        return '';
      }
    },
    options: {}
  };
}

test('renderPreview uses document model block cache for repeated preview updates', () => {
  const markdownEngine = createMarkdownEngineSpy();
  const previewElement = {
    innerHTML: ''
  };
  const renderer = createMarkdownRenderer({
    markdownEngine,
    previewElement,
    annotateMarkdownTokensWithSourceRanges() {}
  });
  const text = 'alpha\n\nbeta\n';
  const model = {
    text,
    blocks: [
      { from: 0, to: 6 },
      { from: 7, to: 12 }
    ]
  };

  renderer.renderPreview(text, {
    documentModel: model
  });
  const firstHtml = previewElement.innerHTML;

  renderer.renderPreview(text, {
    documentModel: model
  });

  assert.deepEqual(markdownEngine.calls.render, ['alpha\n', 'beta\n']);
  assert.equal(previewElement.innerHTML, firstHtml);
});

test('renderPreview falls back to full markdown render when model text is out of sync', () => {
  const markdownEngine = createMarkdownEngineSpy();
  const previewElement = {
    innerHTML: ''
  };
  const renderer = createMarkdownRenderer({
    markdownEngine,
    previewElement,
    annotateMarkdownTokensWithSourceRanges() {}
  });

  renderer.renderPreview('alpha', {
    documentModel: {
      text: 'beta',
      blocks: [{ from: 0, to: 4 }]
    }
  });

  assert.deepEqual(markdownEngine.calls.render, ['alpha']);
});

test('renderPreview transforms wikilinks and embeds before markdown render', () => {
  const markdownEngine = createMarkdownEngineSpy();
  const previewElement = {
    innerHTML: ''
  };
  const renderer = createMarkdownRenderer({
    markdownEngine,
    previewElement,
    annotateMarkdownTokensWithSourceRanges() {}
  });

  renderer.renderPreview('See [[My Note|Alias]] and ![[diagram.png]].');

  assert.equal(markdownEngine.calls.render.length, 1);
  assert.match(markdownEngine.calls.render[0], /\[Alias\]\(#My%20Note\)/);
  assert.match(markdownEngine.calls.render[0], /!\[diagram\.png\]\(diagram\.png\)/);
});

test('renderPreview augments task list markers with interactive checkbox markup', () => {
  const previewElement = {
    innerHTML: ''
  };
  const renderer = createMarkdownRenderer({
    markdownEngine: createMarkdownEngine(),
    previewElement,
    annotateMarkdownTokensWithSourceRanges() {}
  });

  const html = renderer.renderMarkdownHtml('- [ ] open task', {
    sourceFrom: 12,
    sourceTo: 26
  });

  assert.match(html, /input type="checkbox"/);
  assert.match(html, /data-task-source-from="12"/);
  assert.match(html, /task-list-control/);
});

test('renderPreview preserves nested list structure when task items have children', () => {
  const previewElement = {
    innerHTML: ''
  };
  const renderer = createMarkdownRenderer({
    markdownEngine: createMarkdownEngine(),
    previewElement,
    annotateMarkdownTokensWithSourceRanges() {}
  });

  const html = renderer.renderPreview([
    '- [x] Parent task',
    '  - Nested item'
  ].join('\n'));

  assert.match(html, /class="task-list-item"/);
  assert.match(html, /<label class="task-list-control">/);
  assert.match(html, /<ul>/);
  assert.match(html, /<\/span><\/label>\s*<ul>/);
});
