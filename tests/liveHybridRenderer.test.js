import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { Decoration } from '@codemirror/view';
import { createLiveHybridRenderer } from '../src/core/render/LiveHybridRenderer.js';

function createLiveDebugStub() {
  return {
    trace() {},
    warn() {},
    error() {},
    info() {}
  };
}

function createLiveDebugSpy() {
  const calls = {
    trace: [],
    warn: []
  };
  return {
    calls,
    trace(event, data) {
      calls.trace.push({ event, data });
    },
    warn(event, data) {
      calls.warn.push({ event, data });
    },
    error() {},
    info() {}
  };
}

test('buildDecorations returns empty output when view mode is not live', () => {
  const renderer = createLiveHybridRenderer({
    app: { viewMode: 'preview' },
    liveDebug: createLiveDebugStub()
  });

  const state = EditorState.create({
    doc: 'alpha\n'
  });
  const result = renderer.buildDecorations(state, [{ from: 0, to: 6 }], new Map());

  assert.equal(result.decorations, Decoration.none);
  assert.deepEqual(result.sourceMapIndex, []);
  assert.equal(result.fragmentMap.length, 0);
});

test('buildDecorations emits rendered fragment entries for inactive blocks', () => {
  const renderer = createLiveHybridRenderer({
    app: { viewMode: 'live' },
    liveDebug: createLiveDebugStub(),
    renderMarkdownHtml(source) {
      return `<p>${source}</p>`;
    }
  });

  const state = EditorState.create({
    doc: 'line1\n\nline2\n',
    selection: { anchor: 2 }
  });
  const doc = state.doc;
  const block1 = { id: 'b1', from: doc.line(1).from, to: doc.line(1).to };
  const block2 = { id: 'b2', from: doc.line(3).from, to: doc.line(3).to };
  const result = renderer.buildDecorations(state, [block1, block2]);

  assert.notEqual(result.decorations, Decoration.none);
  assert.equal(result.activeBlockId, 'b1');
  assert.equal(result.fragmentMap.length, 1);
  assert.equal(result.sourceMapIndex.some((entry) => entry.kind === 'block'), true);
  assert.equal(result.sourceMapIndex.some((entry) => entry.kind === 'line-fragment'), true);
});

test('buildDecorations logs hybrid telemetry and renders only inactive blocks', () => {
  let renderCalls = 0;
  const liveDebug = createLiveDebugSpy();
  const renderer = createLiveHybridRenderer({
    app: { viewMode: 'live' },
    liveDebug,
    renderMarkdownHtml() {
      renderCalls += 1;
      return '';
    }
  });

  const state = EditorState.create({
    doc: 'line1\n\nline2\n',
    selection: {
      anchor: 2
    }
  });
  const doc = state.doc;
  const block1 = { id: 'b1', from: doc.line(1).from, to: doc.line(1).to };
  const block2 = { id: 'b2', from: doc.line(3).from, to: doc.line(3).to };
  const result = renderer.buildDecorations(state, [block1, block2]);

  assert.notEqual(result.decorations, Decoration.none);
  assert.equal(result.fragmentMap.length, 1);
  assert.equal(renderCalls, 1);
  const hybridEvent = liveDebug.calls.trace.find(
    (entry) => entry.event === 'decorations.hybrid-built'
  );
  assert.equal(Boolean(hybridEvent), true);
  assert.equal(hybridEvent.data.blockCount, 2);
  assert.equal(hybridEvent.data.renderedFragmentCount, 1);
  assert.equal(Number.isFinite(hybridEvent.data.virtualizedFromIndex), true);
  assert.equal(Number.isFinite(hybridEvent.data.virtualizedToIndexExclusive), true);
  assert.equal(typeof hybridEvent.data.renderBudgetTruncated, 'boolean');
  assert.equal(liveDebug.calls.warn.length, 0);
});

test('buildDecorations applies virtualization and render budget', () => {
  const renderer = createLiveHybridRenderer({
    app: { viewMode: 'live' },
    liveDebug: createLiveDebugStub(),
    renderMarkdownHtml(source) {
      return `<p>${source}</p>`;
    },
    renderBudgetMaxBlocks: 5,
    virtualizationBufferBefore: 3,
    virtualizationBufferAfter: 3
  });

  const lines = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join('\n');
  const state = EditorState.create({
    doc: lines,
    selection: { anchor: 200 }
  });

  const blocks = Array.from({ length: state.doc.lines }, (_, index) => {
    const line = state.doc.line(index + 1);
    return {
      id: `b${index + 1}`,
      from: line.from,
      to: line.to
    };
  });

  const result = renderer.buildDecorations(state, blocks);
  assert.ok(result.fragmentMap.length <= 5);
});

test('buildDecorations keeps render output bounded for 5k/20k/50k-line documents', () => {
  const liveDebug = createLiveDebugSpy();
  const renderBudgetMaxBlocks = 120;
  const renderer = createLiveHybridRenderer({
    app: { viewMode: 'live' },
    liveDebug,
    renderMarkdownHtml(source) {
      return `<p>${source}</p>`;
    },
    renderBudgetMaxBlocks,
    virtualizationBufferBefore: 40,
    virtualizationBufferAfter: 40
  });

  for (const lineCount of [5000, 20000, 50000]) {
    const lines = Array.from({ length: lineCount }, (_, index) => `line ${index + 1}`).join('\n');
    const state = EditorState.create({
      doc: lines,
      selection: { anchor: Math.floor(lines.length / 2) }
    });
    const blocks = Array.from({ length: state.doc.lines }, (_, index) => {
      const line = state.doc.line(index + 1);
      return {
        id: `b${index + 1}`,
        from: line.from,
        to: line.to
      };
    });

    const result = renderer.buildDecorations(state, blocks);
    assert.ok(result.fragmentMap.length <= renderBudgetMaxBlocks);
    const hybridEvent = liveDebug.calls.trace.at(-1);
    assert.equal(hybridEvent?.event, 'decorations.hybrid-built');
    assert.equal(hybridEvent?.data.blockCount, lineCount);
    assert.equal(typeof hybridEvent?.data.renderBudgetTruncated, 'boolean');
  }
});
