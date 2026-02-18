import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewRenderer } from '../src/core/render/PreviewRenderer.js';

test('renderPreview reuses cached block fragments when model text matches', () => {
  const calls = [];
  const renderer = createPreviewRenderer({
    renderMarkdownHtml(source) {
      calls.push(source);
      return `<p>${source}</p>`;
    }
  });
  const text = 'alpha\n\nbeta\n';
  const model = {
    text,
    blocks: [
      { from: 0, to: 6 },
      { from: 7, to: 12 }
    ]
  };

  const first = renderer.renderPreview(text, {
    documentModel: model
  });
  const second = renderer.renderPreview(text, {
    documentModel: model
  });

  assert.equal(first, second);
  assert.deepEqual(calls, ['alpha\n', 'beta\n']);
});

test('renderPreview falls back to full render when model is out of sync', () => {
  const calls = [];
  const renderer = createPreviewRenderer({
    renderMarkdownHtml(source) {
      calls.push(source);
      return `<p>${source}</p>`;
    }
  });

  renderer.renderPreview('alpha', {
    documentModel: {
      text: 'beta',
      blocks: [{ from: 0, to: 4 }]
    }
  });

  assert.deepEqual(calls, ['alpha']);
});
