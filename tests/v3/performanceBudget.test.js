import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { createLiveRenderer } from '../../src/live-v3/LiveRenderer.js';

function buildModelFromState(state) {
  const text = state.doc.toString();
  const blocks = Array.from({ length: state.doc.lines }, (_, index) => {
    const line = state.doc.line(index + 1);
    return {
      id: `block-${index + 1}`,
      type: 'paragraph',
      from: line.from,
      to: line.to,
      lineFrom: line.number,
      lineTo: line.number,
      depth: null,
      attrs: {}
    };
  });

  return {
    version: 1,
    text,
    blocks,
    inlines: [],
    meta: {
      dialect: 'obsidian-core',
      parser: 'full',
      reparsedFrom: null,
      reparsedTo: null
    }
  };
}

test('live-v3 render stays bounded for 5k, 20k, and 50k line documents', () => {
  const renderer = createLiveRenderer({
    liveDebug: { trace() {} },
    renderMarkdownHtml(source) {
      return `<p>${source}</p>`;
    },
    renderBudgetMaxBlocks: 140,
    virtualizationBufferBefore: 30,
    virtualizationBufferAfter: 30
  });

  for (const lineCount of [5000, 20000, 50000]) {
    const text = Array.from({ length: lineCount }, (_, index) => `line ${index + 1}`).join('\n');
    const state = EditorState.create({
      doc: text,
      selection: {
        anchor: Math.floor(text.length / 2)
      }
    });

    const model = buildModelFromState(state);
    const projection = renderer.buildRenderProjection(state, model);

    assert.equal(projection.metrics.renderedBlockCount <= 140, true);
    assert.equal(typeof projection.metrics.budgetTruncated, 'boolean');
    assert.equal(Number.isFinite(projection.metrics.renderMs), true);
  }
});
