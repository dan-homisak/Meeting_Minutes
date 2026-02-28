import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { createLiveRenderer } from '../../src/live-v4/LiveRenderer.js';
import { buildLiveProjection } from '../../src/live-v4/LiveProjection.js';

function createModel(text, blocks, inlines = []) {
  return {
    version: 1,
    text,
    blocks,
    inlines,
    meta: {
      dialect: 'obsidian-core',
      parser: 'full',
      reparsedFrom: null,
      reparsedTo: null
    }
  };
}

test('buildLiveProjection keeps one active editable block and renders others as full block widgets', () => {
  const text = '# A\n\nB\n\nC\n';
  const state = EditorState.create({
    doc: text,
    selection: { anchor: 1 }
  });
  const model = createModel(text, [
    { id: 'b1', type: 'heading', from: 0, to: 3, lineFrom: 1, lineTo: 1, depth: 1, attrs: { level: 1 } },
    { id: 'b2', type: 'paragraph', from: 5, to: 6, lineFrom: 3, lineTo: 3, depth: null, attrs: {} },
    { id: 'b3', type: 'paragraph', from: 8, to: 9, lineFrom: 5, lineTo: 5, depth: null, attrs: {} }
  ]);

  const projection = buildLiveProjection({
    state,
    model,
    renderMarkdownHtml(source) {
      return `<p>${source}</p>`;
    }
  });

  assert.equal(projection.activeBlockId, 'b1');
  assert.equal(projection.renderedBlocks.length, 2);
  assert.equal(projection.renderedBlocks.every((block) => block.sourceTo > block.sourceFrom), true);
});

test('createLiveRenderer enforces render budget for large docs', () => {
  const lines = Array.from({ length: 3000 }, (_, index) => `line ${index + 1}`).join('\n');
  const state = EditorState.create({
    doc: lines,
    selection: { anchor: 0 }
  });
  const blocks = Array.from({ length: state.doc.lines }, (_, index) => {
    const line = state.doc.line(index + 1);
    return {
      id: `b-${index + 1}`,
      type: 'paragraph',
      from: line.from,
      to: line.to,
      lineFrom: line.number,
      lineTo: line.number,
      depth: null,
      attrs: {}
    };
  });

  const renderer = createLiveRenderer({
    liveDebug: { trace() {} },
    renderMarkdownHtml(source) {
      return `<p>${source}</p>`;
    },
    renderBudgetMaxBlocks: 120,
    virtualizationBufferBefore: 24,
    virtualizationBufferAfter: 24
  });

  const projection = renderer.buildRenderProjection(state, createModel(lines, blocks));
  assert.equal(projection.metrics.renderedBlockCount <= 120, true);
  assert.equal(typeof projection.metrics.budgetTruncated, 'boolean');
});

test('active multi-line paragraph keeps only active line editable and renders inactive slices', () => {
  const text = 'line one\nline two\nline three\n';
  const state = EditorState.create({
    doc: text,
    selection: { anchor: 2 }
  });
  const model = createModel(text, [
    {
      id: 'p1',
      type: 'paragraph',
      from: 0,
      to: text.length - 1,
      lineFrom: 1,
      lineTo: 3,
      depth: null,
      attrs: {}
    }
  ]);

  const projection = buildLiveProjection({
    state,
    model,
    renderMarkdownHtml(source) {
      return `<p>${source}</p>`;
    }
  });

  assert.equal(projection.activeBlockId, 'p1');
  assert.equal(projection.renderedBlocks.length > 0, true);
  assert.equal(projection.renderedBlocks.every((entry) => entry.blockId === 'p1'), true);
});
