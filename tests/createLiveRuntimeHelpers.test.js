import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveRuntimeHelpers } from '../src/bootstrap/createLiveRuntimeHelpers.js';

test('createLiveRuntimeHelpers delegates through helper modules and controllers', () => {
  const calls = {
    cursorProbe: [],
    gutterProbe: [],
    cursorSuspect: [],
    scheduleCursorProbe: [],
    snapshotSignals: [],
    snapshotReads: [],
    snapshotCapture: [],
    pointerTarget: [],
    pointerCoordinates: [],
    lineInfo: [],
    blockLineBounds: [],
    previewRefresh: [],
    previewState: [],
    previewBlocks: [],
    previewSourceMap: [],
    previewFenceState: [],
    cursorMove: [],
    pointerActivate: [],
    posAtCoords: [],
    posAtDom: []
  };

  const helpers = createLiveRuntimeHelpers({
    liveDebugInputTtlMs: 777,
    windowObject: { id: 'window' },
    nowFn: () => 12345,
    liveDiagnosticsLogHelpers: {
      describeElementForLog(element) {
        return { element };
      },
      readDomSelectionForLog(targetWindow) {
        return { targetWindow };
      }
    },
    liveLineMappingHelpers: {
      readLineInfoForPosition(doc, position) {
        calls.lineInfo.push({ doc, position });
        return { line: position };
      },
      readBlockLineBoundsForLog(doc, blockBounds) {
        calls.blockLineBounds.push({ doc, blockBounds });
        return { doc, blockBounds };
      }
    },
    pointerInputHelpers: {
      normalizePointerTarget(target) {
        calls.pointerTarget.push(target);
        return { target };
      },
      readPointerCoordinates(event) {
        calls.pointerCoordinates.push(event);
        return { event };
      }
    },
    getLiveViewportProbe: () => ({
      readCursorVisibilityForLog(view, head) {
        calls.cursorProbe.push({ view, head });
        return { view, head };
      },
      readGutterVisibilityForLog(view) {
        calls.gutterProbe.push(view);
        return { view };
      }
    }),
    getLivePreviewBridge: () => ({
      requestLivePreviewRefresh(reason) {
        calls.previewRefresh.push(reason);
      },
      readLivePreviewState(state) {
        calls.previewState.push(state);
        return state;
      },
      liveBlocksForView(view) {
        calls.previewBlocks.push(view);
        return [view];
      },
      liveSourceMapIndexForView(view) {
        calls.previewSourceMap.push(view);
        return [{ id: view.id ?? null }];
      },
      emitFenceVisibilityState(view, reason) {
        calls.previewFenceState.push({ view, reason });
      }
    }),
    getLiveSnapshotController: () => ({
      recordInputSignal(kind, details) {
        calls.snapshotSignals.push({ kind, details });
        return { kind, details };
      },
      readRecentInputSignal(maxAgeMs) {
        calls.snapshotReads.push(maxAgeMs);
        return { maxAgeMs };
      },
      captureLiveDebugSnapshot(reason) {
        calls.snapshotCapture.push(reason);
      }
    }),
    getCursorVisibilityController: () => ({
      isCursorVisibilitySuspect(cursorState, selectionLineLength, domSelectionOnContentContainer) {
        calls.cursorSuspect.push({
          cursorState,
          selectionLineLength,
          domSelectionOnContentContainer
        });
        return false;
      },
      scheduleCursorVisibilityProbe(view, reason) {
        calls.scheduleCursorProbe.push({ view, reason });
      }
    }),
    getCursorNavigationController: () => ({
      moveLiveCursorVertically(view, direction, trigger) {
        calls.cursorMove.push({ view, direction, trigger });
        return true;
      }
    }),
    getPointerActivationController: () => ({
      handleLivePointerActivation(view, event, trigger) {
        calls.pointerActivate.push({ view, event, trigger });
        return true;
      }
    })
  });

  assert.deepEqual(helpers.describeElementForLog('x'), { element: 'x' });
  assert.deepEqual(helpers.readDomSelectionForLog(), { targetWindow: { id: 'window' } });
  assert.deepEqual(helpers.readCursorVisibilityForLog('view', 7), { view: 'view', head: 7 });
  assert.deepEqual(helpers.readGutterVisibilityForLog('view'), { view: 'view' });
  assert.equal(helpers.isCursorVisibilitySuspect('cursor', 5, true), false);
  helpers.scheduleCursorVisibilityProbe('view', 'focus');
  assert.deepEqual(helpers.recordInputSignal('keyboard', { key: 'A' }), {
    kind: 'keyboard',
    details: { key: 'A' }
  });
  assert.deepEqual(helpers.readRecentInputSignal(), { maxAgeMs: 777 });
  helpers.captureLiveDebugSnapshot('manual');
  assert.deepEqual(helpers.normalizePointerTarget('node'), { target: 'node' });
  assert.deepEqual(helpers.readPointerCoordinates({ x: 1 }), { event: { x: 1 } });
  assert.deepEqual(helpers.readLineInfoForPosition('doc', 3), { line: 3 });
  assert.deepEqual(helpers.readBlockLineBoundsForLog('doc', { from: 1 }), {
    doc: 'doc',
    blockBounds: { from: 1 }
  });

  const coordinateMappedView = {
    posAtCoords(coords) {
      calls.posAtCoords.push(coords);
      return 13;
    },
    posAtDOM() {
      calls.posAtDom.push('unexpected');
      return null;
    }
  };
  assert.equal(helpers.resolvePointerPosition(coordinateMappedView, 'el', { x: 1, y: 2 }), 13);

  const domMappedView = {
    posAtCoords(coords) {
      calls.posAtCoords.push(coords);
      return null;
    },
    posAtDOM(targetElement, offset) {
      calls.posAtDom.push({ targetElement, offset });
      return 21;
    }
  };
  assert.equal(helpers.resolvePointerPosition(domMappedView, 'el', { x: 2, y: 3 }), 21);

  helpers.requestLivePreviewRefresh('mode-change');
  assert.deepEqual(helpers.readLivePreviewState({ id: 'state' }), { id: 'state' });
  assert.deepEqual(helpers.liveBlocksForView({ id: 'view' }), [{ id: 'view' }]);
  assert.deepEqual(helpers.liveSourceMapIndexForView({ id: 'view' }), [{ id: 'view' }]);
  helpers.emitFenceVisibilityState('view', 'selection');
  assert.equal(helpers.moveLiveCursorVertically('view', 1, 'ArrowDown'), true);
  assert.equal(helpers.handleLivePointerActivation('view', { type: 'mousedown' }, 'mousedown'), true);

  assert.equal(calls.cursorProbe.length, 1);
  assert.equal(calls.gutterProbe.length, 1);
  assert.equal(calls.cursorSuspect.length, 1);
  assert.equal(calls.scheduleCursorProbe.length, 1);
  assert.equal(calls.snapshotSignals.length, 1);
  assert.equal(calls.snapshotReads.length, 1);
  assert.equal(calls.snapshotCapture.length, 1);
  assert.equal(calls.pointerTarget.length, 1);
  assert.equal(calls.pointerCoordinates.length, 1);
  assert.equal(calls.lineInfo.length, 1);
  assert.equal(calls.blockLineBounds.length, 1);
  assert.equal(calls.posAtCoords.length, 2);
  assert.equal(calls.posAtDom.length, 1);
  assert.equal(calls.previewRefresh.length, 1);
  assert.equal(calls.previewState.length, 1);
  assert.equal(calls.previewBlocks.length, 1);
  assert.equal(calls.previewSourceMap.length, 1);
  assert.equal(calls.previewFenceState.length, 1);
  assert.equal(calls.cursorMove.length, 1);
  assert.equal(calls.pointerActivate.length, 1);
});

test('createLiveRuntimeHelpers returns safe fallbacks when dependencies are missing', () => {
  const helpers = createLiveRuntimeHelpers({
    liveDebugInputTtlMs: 200,
    nowFn: () => 50
  });

  assert.equal(helpers.describeElementForLog('el'), null);
  assert.deepEqual(helpers.readDomSelectionForLog({}), { hasSelection: false });
  assert.deepEqual(helpers.readCursorVisibilityForLog('view', 0), { hasView: false });
  assert.deepEqual(helpers.readGutterVisibilityForLog('view'), { hasView: false });
  assert.equal(helpers.isCursorVisibilitySuspect({}, 0, false), true);
  assert.equal(helpers.scheduleCursorVisibilityProbe('view', 'manual'), undefined);
  assert.deepEqual(helpers.recordInputSignal('keyboard', { key: 'A' }), {
    at: 50,
    kind: 'keyboard',
    key: 'A'
  });
  assert.equal(helpers.readRecentInputSignal(), null);
  assert.equal(helpers.captureLiveDebugSnapshot('manual'), undefined);
  assert.equal(helpers.normalizePointerTarget({}), null);
  assert.equal(helpers.readPointerCoordinates({}), null);
  assert.equal(helpers.readLineInfoForPosition('doc', 0), null);
  assert.equal(helpers.readBlockLineBoundsForLog('doc', { from: 0 }), null);
  assert.equal(helpers.resolvePointerPosition('view', null, null), null);
  assert.equal(helpers.requestLivePreviewRefresh('manual'), undefined);
  assert.equal(helpers.readLivePreviewState({ id: 'state' }), null);
  assert.deepEqual(helpers.liveBlocksForView({ id: 'view' }), []);
  assert.deepEqual(helpers.liveSourceMapIndexForView({ id: 'view' }), []);
  assert.equal(helpers.emitFenceVisibilityState('view', 'manual'), undefined);
  assert.equal(helpers.moveLiveCursorVertically('view', 1, 'ArrowDown'), false);
  assert.equal(
    helpers.handleLivePointerActivation('view', { type: 'mousedown' }, 'mousedown'),
    false
  );
});

test('createLiveRuntimeHelpers resolvePointerPosition ignores DOM mapping exceptions', () => {
  const helpers = createLiveRuntimeHelpers();
  const mappedPosition = helpers.resolvePointerPosition(
    {
      posAtDOM() {
        throw new Error('boom');
      }
    },
    { id: 'target' },
    null
  );
  assert.equal(mappedPosition, null);
});
