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
    liveDebug: createLiveDebugStub(),
    renderMarkdownHtml() {
      return '';
    },
    normalizeLogString(value) {
      return String(value);
    },
    sourceFirstMode: true
  });

  const state = EditorState.create({
    doc: 'alpha\n'
  });
  const result = renderer.buildDecorations(state, [{ from: 0, to: 6 }], new Map());

  assert.equal(result.decorations, Decoration.none);
  assert.deepEqual(result.sourceMapIndex, []);
});

test('buildDecorations in source-first mode emits block-only source map entries', () => {
  const renderer = createLiveHybridRenderer({
    app: { viewMode: 'live' },
    liveDebug: createLiveDebugStub(),
    renderMarkdownHtml() {
      return '';
    },
    normalizeLogString(value) {
      return String(value);
    },
    sourceFirstMode: true
  });

  const state = EditorState.create({
    doc: '## Heading\nParagraph\n'
  });
  const result = renderer.buildDecorations(state, [{ from: 0, to: state.doc.length }], new Map());

  assert.notEqual(result.decorations, Decoration.none);
  assert.equal(result.sourceMapIndex.some((entry) => entry.kind === 'block'), true);
  assert.equal(result.sourceMapIndex.some((entry) => entry.kind === 'rendered-fragment'), false);
});

test('buildDecorations in hybrid mode renders only non-active fragments', () => {
  const renderCalls = [];
  const renderer = createLiveHybridRenderer({
    app: { viewMode: 'live' },
    liveDebug: createLiveDebugStub(),
    renderMarkdownHtml(source, options) {
      renderCalls.push({
        source,
        sourceFrom: Number(options?.sourceFrom),
        sourceTo: Number(options?.sourceTo)
      });
      return `<p>${source}</p>`;
    },
    normalizeLogString(value) {
      return String(value);
    },
    sourceFirstMode: false
  });

  const state = EditorState.create({
    doc: '# Title\nactive\nafter\n',
    selection: {
      anchor: '# Title\n'.length
    }
  });
  const activeLine = state.doc.lineAt(state.selection.main.head);
  const result = renderer.buildDecorations(state, [{ from: 0, to: state.doc.length }], new Map());

  assert.notEqual(result.decorations, Decoration.none);
  assert.equal(result.sourceMapIndex.filter((entry) => entry.kind === 'block').length, 1);
  assert.equal(result.sourceMapIndex.filter((entry) => entry.kind === 'rendered-fragment').length, 2);
  assert.equal(
    renderCalls.every((call) => !(call.sourceFrom < activeLine.to && call.sourceTo > activeLine.from)),
    true
  );
});

test('buildDecorations in hybrid mode emits viewport windowing and budget stats', () => {
  const liveDebug = createLiveDebugSpy();
  const renderer = createLiveHybridRenderer({
    app: { viewMode: 'live' },
    liveDebug,
    renderMarkdownHtml(source) {
      return `<p>${source}</p>`;
    },
    normalizeLogString(value) {
      return String(value);
    },
    sourceFirstMode: false,
    viewportLineBuffer: 0,
    viewportMinimumLineSpan: 1,
    maxViewportBlocks: 2,
    maxViewportCharacters: 100
  });

  const state = EditorState.create({
    doc: 'line1\n\nline2\n\nline3\n\nline4',
    selection: {
      anchor: 0
    }
  });
  const doc = state.doc;
  const block1 = { from: doc.line(1).from, to: doc.line(1).to };
  const block2 = { from: doc.line(3).from, to: doc.line(3).to };
  const block3 = { from: doc.line(5).from, to: doc.line(5).to };
  const block4 = { from: doc.line(7).from, to: doc.line(7).to };
  renderer.buildDecorations(state, [block1, block2, block3, block4], new Map(), {
    visibleRanges: [{ from: block3.from, to: block4.to }]
  });

  const builtEvent = liveDebug.calls.trace.find((entry) => entry.event === 'decorations.built');
  assert.equal(Boolean(builtEvent), true);
  assert.equal(builtEvent.data.blockCount, 4);
  assert.equal(builtEvent.data.windowedBlockCount, 4);
  assert.equal(builtEvent.data.budgetedBlockCount, 2);
  assert.equal(builtEvent.data.budgetLimitHit, 'max-blocks');
  assert.equal(builtEvent.data.viewportLineFrom, 1);
  assert.equal(builtEvent.data.viewportLineTo, 7);
});
