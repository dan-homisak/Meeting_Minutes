import test from 'node:test';
import assert from 'node:assert/strict';
import { createSelectionDiagnosticsController } from '../src/live/selectionDiagnosticsController.js';

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

function createDocStub() {
  return {
    lineAt(position) {
      if (position < 40) {
        return {
          number: 1,
          from: 0,
          to: 39
        };
      }
      return {
        number: 30,
        from: 40,
        to: 79
      };
    }
  };
}

function createTransaction({
  docChanged = false,
  hasSelection = false,
  effects = [],
  userEvent = null,
  annotationKey
} = {}) {
  return {
    docChanged,
    selection: hasSelection ? {} : null,
    effects,
    annotation(annotation) {
      if (annotation === annotationKey) {
        return userEvent;
      }
      return null;
    }
  };
}

function createController(overrides = {}) {
  const liveDebug = overrides.liveDebug ?? createLiveDebugSpy();
  const liveDebugDiagnostics = overrides.liveDebugDiagnostics ?? {
    lastProgrammaticSelectionAt: 0,
    lastSelectionJumpLoggedAt: 0
  };

  return {
    controller: createSelectionDiagnosticsController({
      app: overrides.app ?? {
        isLoadingFile: false
      },
      liveDebug,
      liveDebugDiagnostics,
      liveDebugSelectionJumpWarnLineDelta: 2,
      liveDebugSelectionJumpWarnPosDelta: 20,
      liveDebugSelectionJumpSuppressAfterProgrammaticMs: 900,
      readRecentInputSignal: overrides.readRecentInputSignal ?? (() => null),
      readDomSelectionForLog: overrides.readDomSelectionForLog ?? (() => ({ hasSelection: true })),
      scheduleCursorVisibilityProbe: overrides.scheduleCursorVisibilityProbe ?? (() => {}),
      emitFenceVisibilityState: overrides.emitFenceVisibilityState ?? (() => {}),
      captureLiveDebugSnapshot: overrides.captureLiveDebugSnapshot ?? (() => {}),
      transactionUserEventAnnotation: overrides.transactionUserEventAnnotation ?? 'user-event',
      isRefreshEffect: overrides.isRefreshEffect ?? ((effect) => effect?.refresh === true),
      nowFn: overrides.nowFn ?? (() => 5000)
    }),
    liveDebug,
    liveDebugDiagnostics
  };
}

function createSelectionUpdate({
  previousHead = 1,
  currentHead = 60,
  docChanged = false,
  transactions = []
} = {}) {
  const doc = createDocStub();
  return {
    selectionSet: true,
    docChanged,
    view: { id: 'view' },
    transactions,
    startState: {
      doc,
      selection: {
        main: {
          anchor: previousHead,
          head: previousHead
        }
      }
    },
    state: {
      doc,
      selection: {
        main: {
          anchor: currentHead,
          head: currentHead
        }
      }
    }
  };
}

test('summarizeTransactionsForLog counts doc, selection, refresh, and user events', () => {
  const annotationKey = Symbol('user-event');
  const { controller } = createController({
    transactionUserEventAnnotation: annotationKey,
    isRefreshEffect: (effect) => effect?.kind === 'refresh'
  });
  const summary = controller.summarizeTransactionsForLog({
    transactions: [
      createTransaction({
        docChanged: true,
        hasSelection: true,
        effects: [{ kind: 'refresh' }, { kind: 'other' }],
        userEvent: 'select.pointer',
        annotationKey
      }),
      createTransaction({
        docChanged: false,
        hasSelection: false,
        effects: [{ kind: 'refresh' }],
        userEvent: 'input.type',
        annotationKey
      })
    ]
  });

  assert.equal(summary.count, 2);
  assert.equal(summary.selectionTransactions, 1);
  assert.equal(summary.docChangedTransactions, 1);
  assert.equal(summary.refreshEffectTransactions, 2);
  assert.deepEqual(summary.details.map((entry) => entry.userEvent), ['select.pointer', 'input.type']);
});

test('collectTransactionUserEvents deduplicates and drops empty values', () => {
  const annotationKey = Symbol('user-event');
  const { controller } = createController({
    transactionUserEventAnnotation: annotationKey
  });
  const events = controller.collectTransactionUserEvents({
    transactions: [
      createTransaction({ userEvent: 'select.pointer', annotationKey }),
      createTransaction({ userEvent: 'select.pointer', annotationKey }),
      createTransaction({ userEvent: ' ', annotationKey }),
      createTransaction({ userEvent: 'input.type', annotationKey })
    ]
  });

  assert.deepEqual(events, ['select.pointer', 'input.type']);
});

test('handleSelectionUpdate logs suppressed jump and avoids warn/capture', () => {
  const scheduledProbeReasons = [];
  const emittedFenceReasons = [];
  const capturedReasons = [];
  const { controller, liveDebug } = createController({
    readRecentInputSignal: () => null,
    scheduleCursorVisibilityProbe: (_view, reason) => scheduledProbeReasons.push(reason),
    emitFenceVisibilityState: (_view, reason) => emittedFenceReasons.push(reason),
    captureLiveDebugSnapshot: (reason) => capturedReasons.push(reason),
    nowFn: () => 1000
  });
  const update = createSelectionUpdate({
    docChanged: true,
    transactions: [
      createTransaction({
        userEvent: 'input.type',
        annotationKey: 'user-event'
      })
    ]
  });

  controller.handleSelectionUpdate(update);

  assert.equal(liveDebug.calls.warn.length, 0);
  assert.equal(capturedReasons.length, 0);
  assert.deepEqual(scheduledProbeReasons, ['selection-changed']);
  assert.deepEqual(emittedFenceReasons, ['selection-changed']);
  assert.equal(liveDebug.calls.trace[0].event, 'selection.changed');
  assert.equal(liveDebug.calls.trace[1].event, 'selection.jump.suppressed');
});

test('handleSelectionUpdate logs detected jump and throttles repeated warnings', () => {
  const capturedReasons = [];
  let now = 2000;
  const { controller, liveDebug, liveDebugDiagnostics } = createController({
    readRecentInputSignal: () => ({
      kind: 'keyboard',
      trigger: 'keydown',
      key: 'ArrowDown',
      ageMs: 12
    }),
    captureLiveDebugSnapshot: (reason) => capturedReasons.push(reason),
    nowFn: () => now
  });
  const update = createSelectionUpdate({
    docChanged: false,
    transactions: [
      createTransaction({
        userEvent: 'select.pointer',
        annotationKey: 'user-event'
      })
    ]
  });

  controller.handleSelectionUpdate(update);
  now = 2200;
  controller.handleSelectionUpdate(update);

  assert.equal(liveDebug.calls.warn.length, 1);
  assert.equal(liveDebug.calls.warn[0].event, 'selection.jump.detected');
  assert.deepEqual(capturedReasons, ['selection-jump-detected']);
  assert.equal(liveDebugDiagnostics.lastSelectionJumpLoggedAt, 2000);
});
