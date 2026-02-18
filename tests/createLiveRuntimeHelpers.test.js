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
    blockDistance: [],
    pointerTarget: [],
    pointerCoordinates: [],
    clamp: [],
    summarizeRect: [],
    styleSnapshot: [],
    lineInfo: [],
    blockLineBounds: [],
    coordSamples: [],
    summarizeLineNumbers: [],
    renderedPointerProbe: [],
    sourceRangeTarget: [],
    sourceRangePosition: [],
    pointerPosition: [],
    previewRefresh: [],
    previewState: [],
    previewBlocks: [],
    previewFenceState: [],
    cursorMove: [],
    pointerActivate: []
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
      clampNumber(value, min, max) {
        calls.clamp.push({ value, min, max });
        return Math.max(min, Math.min(max, value));
      },
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
      distanceToBlockBounds(position, blockBounds) {
        calls.blockDistance.push({ position, blockBounds });
        return { position, blockBounds };
      },
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
    getPointerProbeGeometry: () => ({
      summarizeRectForLog(rect) {
        calls.summarizeRect.push(rect);
        return rect;
      },
      readComputedStyleSnapshotForLog(element) {
        calls.styleSnapshot.push(element);
        return { element };
      },
      buildCoordSamples(view, samples) {
        calls.coordSamples.push({ view, samples });
        return samples;
      },
      summarizeLineNumbersForCoordSamples(samples) {
        calls.summarizeLineNumbers.push(samples);
        return samples;
      }
    }),
    getPointerSourceMapping: () => ({
      findRenderedSourceRangeTarget(targetElement, renderedBlock) {
        calls.sourceRangeTarget.push({ targetElement, renderedBlock });
        return { targetElement, renderedBlock };
      },
      resolvePositionFromRenderedSourceRange(
        doc,
        sourceRange,
        sourceRangeElement,
        coordinates,
        fallbackPosition
      ) {
        calls.sourceRangePosition.push({
          doc,
          sourceRange,
          sourceRangeElement,
          coordinates,
          fallbackPosition
        });
        return fallbackPosition ?? 0;
      },
      resolvePointerPosition(view, targetElement, coordinates) {
        calls.pointerPosition.push({ view, targetElement, coordinates });
        return 13;
      }
    }),
    getPointerMappingProbe: () => ({
      buildRenderedPointerProbe(
        view,
        renderedBlock,
        targetElement,
        coordinates,
        blockBounds,
        sourcePos,
        sourceFromBlockBounds,
        sourcePosBlockBounds
      ) {
        calls.renderedPointerProbe.push({
          view,
          renderedBlock,
          targetElement,
          coordinates,
          blockBounds,
          sourcePos,
          sourceFromBlockBounds,
          sourcePosBlockBounds
        });
        return { sourcePos };
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
  assert.deepEqual(helpers.distanceToBlockBounds(4, { from: 1, to: 5 }), {
    position: 4,
    blockBounds: { from: 1, to: 5 }
  });
  assert.deepEqual(helpers.normalizePointerTarget('node'), { target: 'node' });
  assert.deepEqual(helpers.readPointerCoordinates({ x: 1 }), { event: { x: 1 } });
  assert.equal(helpers.clampNumber(11, 0, 10), 10);
  assert.deepEqual(helpers.summarizeRectForLog({ left: 1 }), { left: 1 });
  assert.deepEqual(helpers.readComputedStyleSnapshotForLog('el'), { element: 'el' });
  assert.deepEqual(helpers.readLineInfoForPosition('doc', 3), { line: 3 });
  assert.deepEqual(helpers.readBlockLineBoundsForLog('doc', { from: 1 }), {
    doc: 'doc',
    blockBounds: { from: 1 }
  });
  assert.deepEqual(helpers.buildCoordSamples('view', [{ x: 1, y: 2 }]), [{ x: 1, y: 2 }]);
  assert.deepEqual(helpers.summarizeLineNumbersForCoordSamples([1, 2]), [1, 2]);
  assert.deepEqual(
    helpers.buildRenderedPointerProbe('view', 'block', 'el', { x: 1 }, { from: 1 }, 10),
    { sourcePos: 10 }
  );
  assert.deepEqual(helpers.findRenderedSourceRangeTarget('el', 'block'), {
    targetElement: 'el',
    renderedBlock: 'block'
  });
  assert.equal(
    helpers.resolvePositionFromRenderedSourceRange('doc', [1, 2], 'el', { x: 1 }, 11),
    11
  );
  assert.equal(helpers.resolvePointerPosition('view', 'el', { x: 1 }), 13);
  helpers.requestLivePreviewRefresh('mode-change');
  assert.deepEqual(helpers.readLivePreviewState({ id: 'state' }), { id: 'state' });
  assert.deepEqual(helpers.liveBlocksForView({ id: 'view' }), [{ id: 'view' }]);
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
  assert.equal(calls.blockDistance.length, 1);
  assert.equal(calls.pointerTarget.length, 1);
  assert.equal(calls.pointerCoordinates.length, 1);
  assert.equal(calls.clamp.length, 1);
  assert.equal(calls.summarizeRect.length, 1);
  assert.equal(calls.styleSnapshot.length, 1);
  assert.equal(calls.lineInfo.length, 1);
  assert.equal(calls.blockLineBounds.length, 1);
  assert.equal(calls.coordSamples.length, 1);
  assert.equal(calls.summarizeLineNumbers.length, 1);
  assert.equal(calls.renderedPointerProbe.length, 1);
  assert.equal(calls.sourceRangeTarget.length, 1);
  assert.equal(calls.sourceRangePosition.length, 1);
  assert.equal(calls.pointerPosition.length, 1);
  assert.equal(calls.previewRefresh.length, 1);
  assert.equal(calls.previewState.length, 1);
  assert.equal(calls.previewBlocks.length, 1);
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
  assert.equal(helpers.distanceToBlockBounds(1, { from: 0, to: 2 }), null);
  assert.equal(helpers.normalizePointerTarget({}), null);
  assert.equal(helpers.readPointerCoordinates({}), null);
  assert.equal(helpers.clampNumber(1, 0, 2), null);
  assert.equal(helpers.summarizeRectForLog({}), null);
  assert.equal(helpers.readComputedStyleSnapshotForLog({}), null);
  assert.equal(helpers.readLineInfoForPosition('doc', 0), null);
  assert.equal(helpers.readBlockLineBoundsForLog('doc', { from: 0 }), null);
  assert.deepEqual(helpers.buildCoordSamples('view', []), []);
  assert.deepEqual(helpers.summarizeLineNumbersForCoordSamples([]), []);
  assert.equal(helpers.buildRenderedPointerProbe('view', null, null, null, null, 0), null);
  assert.equal(helpers.findRenderedSourceRangeTarget(null, null), null);
  assert.equal(helpers.resolvePositionFromRenderedSourceRange('doc', [], null, null, 7), null);
  assert.equal(helpers.resolvePointerPosition('view', null, null), null);
  assert.equal(helpers.requestLivePreviewRefresh('manual'), undefined);
  assert.equal(helpers.readLivePreviewState({ id: 'state' }), null);
  assert.deepEqual(helpers.liveBlocksForView({ id: 'view' }), []);
  assert.equal(helpers.emitFenceVisibilityState('view', 'manual'), undefined);
  assert.equal(helpers.moveLiveCursorVertically('view', 1, 'ArrowDown'), false);
  assert.equal(
    helpers.handleLivePointerActivation('view', { type: 'mousedown' }, 'mousedown'),
    false
  );
});
