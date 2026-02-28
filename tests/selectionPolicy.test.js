import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVerticalCursorMoveLogEvents,
  emitLiveDebugEvents,
  readSourceMapIndexForView,
  resolvePointerActivationIntent,
  resolveVerticalCursorAssocCorrection,
  resolveVerticalCursorMoveContext
} from '../src/core/selection/SelectionPolicy.js';

test('readSourceMapIndexForView returns normalized source-map index arrays', () => {
  const view = { id: 'view-1' };

  assert.deepEqual(readSourceMapIndexForView(null, view), []);
  assert.deepEqual(readSourceMapIndexForView(() => null, view), []);
  assert.deepEqual(readSourceMapIndexForView(() => [{ id: 'entry' }], view), [{ id: 'entry' }]);
});

test('resolveVerticalCursorMoveContext resolves boundary and clamped targets', () => {
  const doc = {
    lines: 2,
    lineAt(position) {
      if (position <= 4) {
        return { from: 0, to: 4, number: 1, text: 'abcd' };
      }
      return { from: 5, to: 7, number: 2, text: 'xy' };
    },
    line(number) {
      if (number === 1) {
        return { from: 0, to: 4, number: 1, text: 'abcd' };
      }
      return { from: 5, to: 7, number: 2, text: 'xy' };
    }
  };

  const nonEmpty = resolveVerticalCursorMoveContext({
    doc,
    selection: {
      anchor: 0,
      head: 2,
      empty: false
    },
    direction: 1,
    sourceMapIndex: []
  });
  assert.equal(nonEmpty.status, 'non-empty-selection');

  const boundary = resolveVerticalCursorMoveContext({
    doc,
    selection: {
      anchor: 0,
      head: 0,
      empty: true
    },
    direction: -1,
    sourceMapIndex: []
  });
  assert.equal(boundary.status, 'boundary');
  assert.equal(boundary.fromLine, 1);

  const target = resolveVerticalCursorMoveContext({
    doc,
    selection: {
      anchor: 2,
      head: 2,
      empty: true
    },
    direction: 1,
    sourceMapIndex: [
      {
        id: 'block:line-2',
        kind: 'block',
        sourceFrom: 5,
        sourceTo: 6,
        blockFrom: 5,
        blockTo: 6,
        fragmentFrom: 5,
        fragmentTo: 6
      }
    ]
  });
  assert.equal(target.status, 'target');
  assert.equal(target.rawTargetPos, 7);
  assert.equal(target.to, 6);
  assert.equal(target.sourceMapClamp.clamped, true);
  assert.equal(target.sourceMapTargetBlock.id, 'block:line-2');
  assert.equal(target.primaryAssoc, -1);
  assert.equal(target.secondaryAssoc, 1);
});

test('buildVerticalCursorMoveLogEvents serializes move diagnostics', () => {
  const moveContext = {
    status: 'target',
    direction: 1,
    from: 2,
    to: 6,
    fromLine: 1,
    toLine: 2,
    currentColumn: 2,
    currentLineLength: 4,
    targetLineLength: 2,
    rawTargetPos: 7,
    sourceMapTargetBlock: {
      id: 'block:line-2',
      sourceFrom: 5,
      sourceTo: 6
    },
    sourceMapClamp: {
      clamped: true
    },
    primaryAssoc: -1,
    secondaryAssoc: 1
  };

  const events = buildVerticalCursorMoveLogEvents({
    trigger: 'ArrowDown',
    moveContext,
    targetLineTextPreview: 'xy'
  });
  assert.equal(events.length, 2);
  assert.equal(events[0].event, 'cursor.move.vertical');
  assert.equal(events[1].event, 'cursor.move.vertical.source-map-clamped');

  const boundaryEvents = buildVerticalCursorMoveLogEvents({
    trigger: 'ArrowUp',
    moveContext: {
      status: 'boundary',
      direction: -1,
      from: 0,
      fromLine: 1
    }
  });
  assert.equal(boundaryEvents.length, 1);
  assert.equal(boundaryEvents[0].event, 'cursor.move.vertical.boundary');
});

test('resolveVerticalCursorAssocCorrection emits corrected-assoc warning when suspect', () => {
  const result = resolveVerticalCursorAssocCorrection({
    trigger: 'root-keydown-ArrowDown',
    moveContext: {
      status: 'target',
      to: 7,
      primaryAssoc: -1,
      secondaryAssoc: 1
    },
    cursorState: {
      hasCursorElement: true
    },
    selectedLine: {
      number: 2,
      from: 5,
      to: 7
    },
    domSelectionOnContentContainer: true,
    isCursorVisibilitySuspect: () => true
  });

  assert.equal(result.shouldCorrectAssoc, true);
  assert.equal(result.logs.length, 1);
  assert.equal(result.logs[0].event, 'cursor.move.vertical.corrected-assoc');
  assert.equal(result.logs[0].payload.targetPos, 7);
});

test('emitLiveDebugEvents routes event batches by level and ignores malformed entries', () => {
  const calls = [];
  const liveDebug = {
    trace(event, payload) {
      calls.push(`trace:${event}:${payload?.id ?? 'na'}`);
    },
    warn(event, payload) {
      calls.push(`warn:${event}:${payload?.id ?? 'na'}`);
    },
    error(event, payload) {
      calls.push(`error:${event}:${payload?.id ?? 'na'}`);
    },
    info(event, payload) {
      calls.push(`info:${event}:${payload?.id ?? 'na'}`);
    }
  };

  const emitted = emitLiveDebugEvents(liveDebug, [
    { level: 'trace', event: 'a', payload: { id: 1 } },
    { level: 'warn', event: 'b', payload: { id: 2 } },
    { level: 'error', event: 'c', payload: { id: 3 } },
    { level: 'info', event: 'd', payload: { id: 4 } },
    { level: 'trace', event: '', payload: { id: 5 } },
    null
  ]);

  assert.equal(emitted, 4);
  assert.deepEqual(calls, [
    'trace:a:1',
    'warn:b:2',
    'error:c:3',
    'info:d:4'
  ]);
});

test('resolvePointerActivationIntent composes pointer-input, preflight, and hybrid mapping logs', () => {
  const recordedSignals = [];
  const intent = resolvePointerActivationIntent({
    viewMode: 'live',
    trigger: 'mousedown',
    targetElement: {
      tagName: 'DIV',
      className: 'cm-content'
    },
    coordinates: { x: 30, y: 45 },
    targetSummary: {
      tagName: 'DIV',
      className: 'cm-content',
      sourceFrom: 10
    },
    recordInputSignal: (kind, payload) => {
      recordedSignals.push({ kind, payload });
      return {
        ...payload,
        kind,
        signalId: 'sig-1'
      };
    },
    resolvePointerPosition: () => 24,
    view: {
      state: {
        doc: {
          length: 20
        }
      }
    },
    liveBlocksForView: () => [{ from: 10, to: 15 }],
    readLineInfoForPosition: () => ({ lineNumber: 2 }),
    resolveActivationBlockBounds: () => ({ from: 10, to: 15 }),
    readBlockLineBoundsForLog: () => ({ startLineNumber: 2, endLineNumber: 3 })
  });

  assert.equal(intent.proceed, true);
  assert.equal(intent.mode, 'hybrid');
  assert.equal(intent.renderedBlockTarget, null);
  assert.equal(intent.pointerSignal.signalId, 'sig-1');
  assert.ok(intent.hybridActivation);
  assert.equal(intent.targetPosition, 20);
  assert.equal(intent.logs[0].event, 'input.pointer');
  assert.equal(intent.logs[1].event, 'pointer.map.native');
  assert.equal(intent.logs[2].event, 'pointer.map.clamped');
  assert.equal(intent.logs[3].event, 'block.activate.request');
  assert.equal(recordedSignals.length, 1);

  const missIntent = resolvePointerActivationIntent({
    viewMode: 'live',
    trigger: 'mousedown',
    targetElement: null,
    coordinates: { x: 30, y: 45 },
    targetSummary: null
  });
  assert.equal(missIntent.proceed, false);
  assert.equal(missIntent.mode, 'miss');
  assert.equal(missIntent.hybridActivation, null);
  assert.equal(missIntent.logs[0].event, 'input.pointer');
  assert.equal(missIntent.logs[1].event, 'block.activate.miss');

  const inactiveIntent = resolvePointerActivationIntent({
    viewMode: 'preview',
    trigger: 'mousedown',
    targetElement: null,
    coordinates: { x: 30, y: 45 },
    targetSummary: null
  });
  assert.equal(inactiveIntent.mode, 'inactive');
  assert.deepEqual(inactiveIntent.logs, []);
});

test('resolvePointerActivationIntent prefers fragment-map source lookup over coordinate mapping', () => {
  const intent = resolvePointerActivationIntent({
    viewMode: 'live',
    trigger: 'mousedown',
    targetElement: {
      tagName: 'SECTION',
      className: 'cm-rendered-block-widget',
      getAttribute(name) {
        if (name === 'data-fragment-id') {
          return 'fragment-1';
        }
        if (name === 'data-block-id') {
          return 'block-1';
        }
        return null;
      },
      closest() {
        return null;
      }
    },
    coordinates: { x: 10, y: 12 },
    targetSummary: {
      tagName: 'SECTION',
      className: 'cm-rendered-block-widget',
      sourceFrom: null
    },
    resolvePointerPosition: () => null,
    view: {
      state: {
        doc: {
          length: 120
        }
      }
    },
    liveBlocksForView: () => [{ from: 30, to: 40 }],
    liveSourceMapIndexForView: () => [
      {
        kind: 'line-fragment',
        fragmentId: 'fragment-1',
        blockId: 'block-1',
        sourceFrom: 33,
        sourceTo: 40,
        blockFrom: 30,
        blockTo: 40,
        fragmentFrom: 33,
        fragmentTo: 40
      }
    ],
    readLineInfoForPosition: () => ({ lineNumber: 3 }),
    resolveActivationBlockBounds: () => ({ from: 30, to: 40 }),
    readBlockLineBoundsForLog: () => ({ startLineNumber: 3, endLineNumber: 4 })
  });

  assert.equal(intent.proceed, true);
  assert.equal(intent.targetPosition, 33);
  assert.ok(intent.logs.some((entry) => entry.event === 'pointer.map.fragment'));
});
