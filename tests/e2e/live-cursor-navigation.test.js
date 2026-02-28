import test from 'node:test';
import assert from 'node:assert/strict';
import { createCursorNavigationController } from '../../src/core/selection/CursorNavigator.js';
import { createLiveDiagnosticsController } from '../../src/live/liveDiagnosticsController.js';

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
  text = 'abcd\nxy',
  head = 2
} = {}) {
  const doc = createDoc(text);
  const dispatched = [];
  let focusCount = 0;
  const domHandlers = new Map();

  const view = {
    hasFocus: true,
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
      const selection = transaction?.selection;
      if (!selection) {
        return;
      }
      if (selection.main) {
        this.state.selection = selection;
        return;
      }
      if (!Number.isFinite(selection.anchor)) {
        return;
      }
      const nextHead = Number.isFinite(selection.head) ? selection.head : selection.anchor;
      this.state.selection = {
        main: {
          anchor: selection.anchor,
          head: nextHead,
          empty: selection.anchor === nextHead
        }
      };
    },
    focus() {
      focusCount += 1;
    },
    dom: {
      addEventListener(type, handler) {
        domHandlers.set(type, handler);
      },
      contains() {
        return true;
      }
    }
  };

  return {
    view,
    dispatched,
    domHandlers,
    readFocusCount: () => focusCount
  };
}

test('root keydown drives cursor navigation and applies source-map clamping', () => {
  const app = { viewMode: 'live' };
  const liveDebug = createLiveDebugSpy();
  const probeReasons = [];
  const inputSignals = [];
  const documentHandlers = new Map();

  function recordInputSignal(kind, payload) {
    const signal = {
      kind,
      ...payload
    };
    inputSignals.push(signal);
    return signal;
  }

  const cursorNavigationController = createCursorNavigationController({
    app,
    liveDebug,
    recordInputSignal,
    normalizeLogString(value) {
      return String(value ?? '');
    },
    scheduleCursorVisibilityProbe(_view, reason) {
      probeReasons.push(reason);
    },
    readCursorVisibilityForLog() {
      return { hasCursorElement: true };
    },
    readDomSelectionForLog() {
      return {
        anchorNode: {
          className: 'cm-content'
        }
      };
    },
    isCursorVisibilitySuspect() {
      return false;
    },
    liveSourceMapIndexForView() {
      return [
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
      ];
    },
    requestAnimationFrameFn(callback) {
      callback();
      return 1;
    },
    createCursorSelection(position, assoc) {
      return {
        anchor: position,
        head: position,
        assoc
      };
    }
  });

  const diagnosticsController = createLiveDiagnosticsController({
    app,
    liveDebug,
    liveDebugDiagnostics: {
      longTaskObserver: null,
      lastDomSelectionChangeLoggedAt: 0
    },
    liveDebugKeylogKeys: new Set(['ArrowDown']),
    liveDebugDomSelectionThrottleMs: 120,
    normalizeLogString(value) {
      return String(value ?? '');
    },
    normalizePointerTarget(target) {
      return target ?? null;
    },
    readPointerCoordinates() {
      return null;
    },
    describeElementForLog(element) {
      if (!element) {
        return null;
      }
      return {
        tagName: element.tagName ?? null,
        className: typeof element.className === 'string' ? element.className : null,
        sourceFrom: null
      };
    },
    recordInputSignal,
    moveLiveCursorVertically(view, direction, trigger) {
      return cursorNavigationController.moveLiveCursorVertically(view, direction, trigger);
    },
    scheduleCursorVisibilityProbe(_view, reason) {
      probeReasons.push(reason);
    },
    readDomSelectionForLog() {
      return null;
    },
    windowObject: {
      addEventListener() {},
      getSelection() {
        return null;
      }
    },
    documentObject: {
      activeElement: null,
      addEventListener(type, handler) {
        documentHandlers.set(type, handler);
      }
    },
    performanceObserverClass: null,
    elementConstructor: null,
    nodeConstructor: null
  });

  const { view, dispatched, domHandlers, readFocusCount } = createView({
    text: 'abcd\nxy',
    head: 2
  });

  diagnosticsController.installEditorInputDiagnostics(view);
  assert.equal(typeof domHandlers.get('keydown'), 'function');
  assert.equal(typeof documentHandlers.get('selectionchange'), 'function');

  let prevented = false;
  let stopped = false;
  domHandlers.get('keydown')({
    key: 'ArrowDown',
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    defaultPrevented: false,
    eventPhase: 2,
    isTrusted: true,
    target: view.dom,
    preventDefault() {
      prevented = true;
    },
    stopPropagation() {
      stopped = true;
    }
  });

  const traceEvents = liveDebug.calls.trace.map((entry) => entry.event);
  const warnEvents = liveDebug.calls.warn.map((entry) => entry.event);
  assert.equal(prevented, true);
  assert.equal(stopped, true);
  assert.ok(dispatched.length >= 1);
  assert.equal(view.state.selection.main.head, 6);
  assert.ok(readFocusCount() >= 1);
  assert.ok(probeReasons.includes('moveLiveCursorVertically'));
  assert.ok(probeReasons.includes('vertical-intercept-applied'));
  assert.ok(traceEvents.includes('input.keydown.vertical-intercept.applied'));
  assert.ok(warnEvents.includes('cursor.move.vertical.source-map-clamped'));
  assert.ok(inputSignals.some((signal) => signal.trigger === 'root-keydown'));
  assert.ok(inputSignals.some((signal) => signal.trigger === 'root-keydown-ArrowDown'));
});
