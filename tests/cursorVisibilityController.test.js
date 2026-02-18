import test from 'node:test';
import assert from 'node:assert/strict';
import { createCursorVisibilityController } from '../src/live/cursorVisibilityController.js';

function createLiveDebugSpy() {
  const calls = {
    trace: [],
    warn: [],
    error: [],
    info: []
  };
  return {
    calls,
    trace(event, data) {
      calls.trace.push({ event, data });
    },
    warn(event, data) {
      calls.warn.push({ event, data });
    },
    error(event, data) {
      calls.error.push({ event, data });
    },
    info(event, data) {
      calls.info.push({ event, data });
    }
  };
}

function createHealthyCursorState(overrides = {}) {
  return {
    hasView: true,
    hasCursorElement: true,
    cursorHeight: 12,
    inVerticalViewport: true,
    inHorizontalViewport: true,
    farRightFromScroller: false,
    oversizedHeight: false,
    oversizedWidth: false,
    nearRightEdge: false,
    cursorOutOfSyncWithHeadCoords: false,
    activeLineElementPresent: true,
    ...overrides
  };
}

function createView({ selectionHead = 0, selectionEmpty = true } = {}) {
  const dispatched = [];
  let focusCount = 0;
  return {
    dispatched,
    readFocusCount: () => focusCount,
    view: {
      hasFocus: true,
      state: {
        selection: {
          main: {
            anchor: selectionHead,
            head: selectionHead,
            empty: selectionEmpty
          }
        },
        doc: {
          lineAt(position) {
            return {
              number: 1,
              from: 0,
              to: 5
            };
          }
        }
      },
      dispatch(transaction) {
        dispatched.push(transaction);
      },
      focus() {
        focusCount += 1;
      }
    }
  };
}

function createRafQueue() {
  const queue = [];
  return {
    requestAnimationFrameFn(callback) {
      queue.push(callback);
      return queue.length;
    },
    flushAll(limit = 100) {
      let remaining = limit;
      while (queue.length > 0 && remaining > 0) {
        remaining -= 1;
        const callback = queue.shift();
        callback();
      }
      if (queue.length > 0) {
        throw new Error('RAF queue did not flush in expected limit');
      }
    },
    get size() {
      return queue.length;
    }
  };
}

function createController(overrides = {}) {
  const liveDebug = overrides.liveDebug ?? createLiveDebugSpy();
  const raf = overrides.raf ?? createRafQueue();
  const refreshCalls = [];
  const snapshotCalls = [];
  const liveDebugDiagnostics = overrides.liveDebugDiagnostics ?? {
    lastCursorProbeAt: 0,
    lastCursorActiveLineMissingLoggedAt: 0,
    lastGutterProbeAt: 0,
    lastCursorRecoveryAt: 0,
    cursorRecoveryInFlight: false
  };

  const controller = createCursorVisibilityController({
    app: overrides.app ?? { viewMode: 'live' },
    liveDebug,
    liveDebugDiagnostics,
    readCursorVisibilityForLog:
      overrides.readCursorVisibilityForLog ?? (() => createHealthyCursorState()),
    readDomSelectionForLog:
      overrides.readDomSelectionForLog ?? (() => null),
    readGutterVisibilityForLog:
      overrides.readGutterVisibilityForLog ?? (() => ({ hasGutters: false })),
    requestLivePreviewRefresh(reason) {
      refreshCalls.push(reason);
    },
    captureLiveDebugSnapshot(reason) {
      snapshotCalls.push(reason);
    },
    requestAnimationFrameFn: raf.requestAnimationFrameFn
  });

  return {
    controller,
    liveDebug,
    liveDebugDiagnostics,
    refreshCalls,
    snapshotCalls,
    raf
  };
}

test('isCursorVisibilitySuspect returns false for healthy cursor state', () => {
  const { controller } = createController();
  const suspect = controller.isCursorVisibilitySuspect(
    createHealthyCursorState(),
    0,
    false
  );
  assert.equal(suspect, false);
});

test('scheduleCursorVisibilityProbe is a no-op outside live mode', () => {
  const raf = createRafQueue();
  const { controller } = createController({
    app: { viewMode: 'raw' },
    raf
  });
  const { view } = createView();

  controller.scheduleCursorVisibilityProbe(view, 'manual');

  assert.equal(raf.size, 0);
});

test('attemptCursorRecovery dispatches primary recovery and refreshes live preview', () => {
  const raf = createRafQueue();
  const { controller, refreshCalls, liveDebugDiagnostics, liveDebug } = createController({
    raf
  });
  const { view, dispatched, readFocusCount } = createView({
    selectionHead: 2
  });

  controller.attemptCursorRecovery(
    view,
    'manual',
    2,
    1,
    5,
    createHealthyCursorState({ hasCursorElement: false })
  );

  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].selection.anchor, 2);
  assert.equal(dispatched[0].scrollIntoView, true);
  assert.equal(readFocusCount(), 1);
  assert.deepEqual(refreshCalls, ['cursor-recover-primary']);

  raf.flushAll();

  assert.equal(liveDebugDiagnostics.cursorRecoveryInFlight, false);
  assert.equal(
    liveDebug.calls.warn.some((entry) => entry.event === 'cursor.recover.dispatch'),
    true
  );
});

test('probeCursorVisibility captures snapshot when suspect cursor is detected', () => {
  const { controller, snapshotCalls, liveDebug, liveDebugDiagnostics } = createController({
    liveDebugDiagnostics: {
      lastCursorProbeAt: 0,
      lastCursorActiveLineMissingLoggedAt: 0,
      lastGutterProbeAt: 0,
      lastCursorRecoveryAt: Date.now(),
      cursorRecoveryInFlight: true
    },
    readCursorVisibilityForLog: () => createHealthyCursorState({
      hasCursorElement: false
    })
  });
  const { view } = createView({
    selectionHead: 2,
    selectionEmpty: true
  });

  controller.probeCursorVisibility(view, 'manual');

  assert.deepEqual(snapshotCalls, ['cursor-visibility-suspect']);
  assert.equal(
    liveDebug.calls.warn.some((entry) => entry.event === 'cursor.visibility.suspect'),
    true
  );
});
