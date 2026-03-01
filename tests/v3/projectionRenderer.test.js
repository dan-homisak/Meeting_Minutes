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

function collectSyntaxHiddenRanges(projection, from, to) {
  const ranges = [];
  projection.decorations.between(from, to, (rangeFrom, rangeTo, value) => {
    const className = value?.spec?.class ?? value?.spec?.attributes?.class ?? '';
    if (String(className).includes('mm-live-v4-syntax-hidden')) {
      ranges.push([Number(rangeFrom), Number(rangeTo)]);
    }
  });
  return ranges;
}

test('buildLiveProjection uses source transforms for single-line paragraph blocks', () => {
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
  assert.equal(projection.renderedBlocks.length, 0);
  assert.deepEqual(
    projection.sourceTransforms.map((entry) => entry.type),
    ['heading', 'paragraph', 'paragraph']
  );
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

test('single-line heading/list/task blocks use source transforms for syntax-level live preview', () => {
  const text = '# H\n- [ ] alpha\n- beta\n';
  const state = EditorState.create({
    doc: text,
    selection: { anchor: 6 }
  });
  const model = createModel(text, [
    { id: 'h1', type: 'heading', from: 0, to: 3, lineFrom: 1, lineTo: 1, depth: null, attrs: { level: 1 } },
    { id: 't1', type: 'task', from: 4, to: 15, lineFrom: 2, lineTo: 2, depth: 0, attrs: { checked: false, depth: 0 } },
    { id: 'l1', type: 'list', from: 16, to: 22, lineFrom: 3, lineTo: 3, depth: 0, attrs: { depth: 0 } }
  ]);

  const projection = buildLiveProjection({
    state,
    model,
    renderMarkdownHtml(source) {
      return `<p>${source}</p>`;
    }
  });

  assert.equal(Array.isArray(projection.sourceTransforms), true);
  assert.equal(projection.sourceTransforms.length, 3);
  assert.deepEqual(
    projection.sourceTransforms.map((entry) => entry.type),
    ['heading', 'task', 'list']
  );
  assert.equal(projection.renderedBlocks.length, 0);
});

test('paragraph source transforms include inline spans for syntax rendering', () => {
  const text = 'Line with **bold** and [link](https://example.com)\n';
  const state = EditorState.create({
    doc: text,
    selection: { anchor: 6 }
  });
  const model = createModel(
    text,
    [
      { id: 'p1', type: 'paragraph', from: 0, to: text.length - 1, lineFrom: 1, lineTo: 1, depth: null, attrs: {} }
    ],
    [
      { from: 10, to: 18, type: 'strong' },
      { from: 23, to: 50, type: 'link' }
    ]
  );

  const projection = buildLiveProjection({
    state,
    model,
    renderMarkdownHtml(source) {
      return `<p>${source}</p>`;
    }
  });

  assert.equal(projection.renderedBlocks.length, 0);
  assert.equal(projection.sourceTransforms.length, 1);
  assert.deepEqual(
    projection.sourceTransforms[0].inlineSpans.map((span) => span.type),
    ['strong', 'link']
  );
});

test('inline syntax hides in content mode and reveals when cursor is inside syntax', () => {
  const text = 'Paragraph with **bold** text\n';
  const line = text.trimEnd();
  const model = createModel(
    text,
    [
      { id: 'p1', type: 'paragraph', from: 0, to: line.length, lineFrom: 1, lineTo: 1, depth: null, attrs: {} }
    ],
    [
      { from: 15, to: 23, type: 'strong' }
    ]
  );

  const renderer = createLiveRenderer({
    liveDebug: { trace() {} },
    renderMarkdownHtml(source) {
      return `<p>${source}</p>`;
    }
  });

  const contentState = EditorState.create({
    doc: text,
    selection: { anchor: 18 }
  });
  const contentProjection = renderer.buildRenderProjection(contentState, model);
  const contentHidden = collectSyntaxHiddenRanges(contentProjection, 0, line.length);
  assert.equal(contentHidden.some(([from, to]) => from === 15 && to === 17), true);
  assert.equal(contentHidden.some(([from, to]) => from === 21 && to === 23), true);

  const syntaxState = EditorState.create({
    doc: text,
    selection: { anchor: 16 }
  });
  const syntaxProjection = renderer.buildRenderProjection(syntaxState, model);
  const syntaxHidden = collectSyntaxHiddenRanges(syntaxProjection, 0, line.length);
  assert.equal(syntaxHidden.some(([from, to]) => from === 15 && to === 17), false);
  assert.equal(syntaxHidden.some(([from, to]) => from === 21 && to === 23), false);
});
