import test from 'node:test';
import assert from 'node:assert/strict';
import { createCursorNavigationController } from '../src/live/cursorNavigationController.js';

function createDoc(text) {
  const lines = text.split('\n');
  const lineRecords = [];
  let offset = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const lineText = lines[index];
    const from = offset;
    const to = from + lineText.length;
    lineRecords.push({
      from,
      to,
      number: index + 1,
      text: lineText
    });
    offset = to + 1;
  }

  const length = text.length;
  return {
    length,
    lines: lineRecords.length,
    sliceString(from, to) {
      return text.slice(from, to);
    },
    line(number) {
      return lineRecords[number - 1];
    },
    lineAt(position) {
      const clamped = Math.max(0, Math.min(length, Math.trunc(position)));
      for (let index = 0; index < lineRecords.length; index += 1) {
        const line = lineRecords[index];
        const nextLine = lineRecords[index + 1] ?? null;
        if (clamped <= line.to) {
          return line;
        }
        if (nextLine && clamped < nextLine.from) {
          return line;
        }
      }
      return lineRecords[lineRecords.length - 1];
    }
  };
}

function createView({
  text = 'alpha\nbeta',
  head = 0
} = {}) {
  const doc = createDoc(text);
  const dispatched = [];
  let focusCount = 0;

  const view = {
    state: {
      doc,
      selection: {
        main: {
          anchor: head,
          head,
          empty: true
        }
      }
    },
    dispatch(transaction) {
      dispatched.push(transaction);
      if (transaction?.selection) {
        const nextSelection = transaction.selection;
        if (nextSelection?.main) {
          this.state.selection = nextSelection;
        } else if (
          Number.isFinite(nextSelection?.anchor) &&
          Number.isFinite(nextSelection?.head)
        ) {
          this.state.selection = {
            main: nextSelection
          };
        }
      }
    },
    focus() {
      focusCount += 1;
    }
  };

  return {
    view,
    dispatched,
    readFocusCount: () => focusCount
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
    }
  };
}

function createController(overrides = {}) {
  const app = overrides.app ?? { viewMode: 'live' };
  const liveDebug = overrides.liveDebug ?? createLiveDebugSpy();
  const probes = [];
  const inputSignals = [];

  const controller = createCursorNavigationController({
    app,
    liveDebug,
    recordInputSignal(kind, payload) {
      inputSignals.push({ kind, payload });
      return payload;
    },
    normalizeLogString(value) {
      return String(value);
    },
    scheduleCursorVisibilityProbe(_view, reason) {
      probes.push(reason);
    },
    readCursorVisibilityForLog: overrides.readCursorVisibilityForLog ?? (() => ({ hasCursorElement: false })),
    readDomSelectionForLog: overrides.readDomSelectionForLog ?? (() => null),
    isCursorVisibilitySuspect: overrides.isCursorVisibilitySuspect ?? (() => false),
    liveSourceMapIndexForView: overrides.liveSourceMapIndexForView ?? (() => []),
    requestAnimationFrameFn: overrides.requestAnimationFrameFn ?? ((callback) => {
      callback();
      return 1;
    })
  });

  return {
    controller,
    app,
    liveDebug,
    probes,
    inputSignals
  };
}

test('moveLiveCursorVertically returns false when mode is not live', () => {
  const { controller, inputSignals } = createController({
    app: { viewMode: 'raw' }
  });
  const { view, dispatched } = createView({
    text: 'alpha\nbeta',
    head: 0
  });

  const handled = controller.moveLiveCursorVertically(view, 1, 'ArrowDown');

  assert.equal(handled, false);
  assert.equal(inputSignals.length, 0);
  assert.equal(dispatched.length, 0);
});

test('moveLiveCursorVertically returns true at document boundary without dispatch', () => {
  const { controller, inputSignals } = createController();
  const { view, dispatched } = createView({
    text: 'alpha\nbeta',
    head: 0
  });

  const handled = controller.moveLiveCursorVertically(view, -1, 'ArrowUp');

  assert.equal(handled, true);
  assert.equal(inputSignals.length, 1);
  assert.equal(dispatched.length, 0);
});

test('moveLiveCursorVertically dispatches target position and schedules visibility probe', () => {
  const { controller, probes } = createController();
  const { view, dispatched, readFocusCount } = createView({
    text: 'abcd\nxy',
    head: 2
  });

  const handled = controller.moveLiveCursorVertically(view, 1, 'ArrowDown');

  assert.equal(handled, true);
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].scrollIntoView, true);
  assert.equal(view.state.selection.main.head, 7);
  assert.equal(readFocusCount(), 1);
  assert.deepEqual(probes, ['moveLiveCursorVertically']);
});

test('moveLiveCursorVertically applies assoc correction when cursor state is suspect', () => {
  const debugSpy = createLiveDebugSpy();
  const { controller, probes } = createController({
    liveDebug: debugSpy,
    readCursorVisibilityForLog: () => ({ hasCursorElement: true }),
    readDomSelectionForLog: () => ({
      anchorNode: {
        className: 'cm-content mirror'
      }
    }),
    isCursorVisibilitySuspect: () => true
  });
  const { view, dispatched, readFocusCount } = createView({
    text: 'abcd\nxy',
    head: 2
  });

  const handled = controller.moveLiveCursorVertically(view, 1, 'ArrowDown');

  assert.equal(handled, true);
  assert.equal(dispatched.length, 2);
  assert.equal(dispatched[0].scrollIntoView, true);
  assert.equal(dispatched[1].scrollIntoView, true);
  assert.equal(view.state.selection.main.head, 7);
  assert.equal(readFocusCount(), 2);
  assert.deepEqual(probes, [
    'moveLiveCursorVertically',
    'moveLiveCursorVertically-corrected-assoc'
  ]);
  assert.equal(debugSpy.calls.warn.length, 1);
  assert.equal(debugSpy.calls.warn[0].event, 'cursor.move.vertical.corrected-assoc');
});

test('moveLiveCursorVertically clamps target to source-map block bounds', () => {
  const debugSpy = createLiveDebugSpy();
  const { controller } = createController({
    liveDebug: debugSpy,
    liveSourceMapIndexForView: () => [
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
  const { view, dispatched } = createView({
    text: 'abcd\nxy',
    head: 2
  });

  const handled = controller.moveLiveCursorVertically(view, 1, 'ArrowDown');

  assert.equal(handled, true);
  assert.equal(dispatched.length, 1);
  assert.equal(view.state.selection.main.head, 6);
  assert.equal(debugSpy.calls.warn.length, 1);
  assert.equal(debugSpy.calls.warn[0].event, 'cursor.move.vertical.source-map-clamped');
  assert.equal(debugSpy.calls.warn[0].data.rawTargetPos, 7);
  assert.equal(debugSpy.calls.warn[0].data.targetPos, 6);
});
