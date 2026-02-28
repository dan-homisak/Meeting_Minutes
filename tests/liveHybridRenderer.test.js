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
});

test('buildDecorations in source-first mode emits block-only source map entries', () => {
  const renderer = createLiveHybridRenderer({
    app: { viewMode: 'live' },
    liveDebug: createLiveDebugStub()
  });

  const state = EditorState.create({
    doc: '## Heading\nParagraph\n'
  });
  const result = renderer.buildDecorations(state, [{ from: 0, to: state.doc.length }], new Map());

  assert.notEqual(result.decorations, Decoration.none);
  assert.equal(result.sourceMapIndex.some((entry) => entry.kind === 'block'), true);
  assert.equal(result.sourceMapIndex.some((entry) => entry.kind === 'rendered-fragment'), false);
});

test('buildDecorations always uses source-first output and logs source-first telemetry', () => {
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
  const block1 = { from: doc.line(1).from, to: doc.line(1).to };
  const block2 = { from: doc.line(3).from, to: doc.line(3).to };
  const result = renderer.buildDecorations(state, [block1, block2]);

  assert.notEqual(result.decorations, Decoration.none);
  assert.equal(result.sourceMapIndex.filter((entry) => entry.kind === 'block').length, 2);
  assert.equal(result.sourceMapIndex.some((entry) => entry.kind === 'rendered-fragment'), false);
  assert.equal(renderCalls, 0);
  const sourceFirstEvent = liveDebug.calls.trace.find(
    (entry) => entry.event === 'decorations.source-first-built'
  );
  assert.equal(Boolean(sourceFirstEvent), true);
  assert.equal(sourceFirstEvent.data.blockCount, 2);
  const legacyBuiltEvent = liveDebug.calls.trace.find((entry) => entry.event === 'decorations.built');
  assert.equal(legacyBuiltEvent, undefined);
  assert.equal(liveDebug.calls.warn.length, 0);
});
