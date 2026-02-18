import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarkdownRenderer } from '../src/render/markdownRenderer.js';

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
