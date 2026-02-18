import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveDiagnosticsController } from '../src/live/liveDiagnosticsController.js';

function createLiveDebugSpy() {
  const calls = {
    trace: [],
    info: [],
    warn: [],
    error: []
  };
  return {
    calls,
    trace(event, data) {
      calls.trace.push({ event, data });
    },
    info(event, data) {
      calls.info.push({ event, data });
    },
    warn(event, data) {
      calls.warn.push({ event, data });
    },
    error(event, data) {
      calls.error.push({ event, data });
    }
  };
}

function createController(overrides = {}) {
  const liveDebug = overrides.liveDebug ?? createLiveDebugSpy();
  return createLiveDiagnosticsController({
    app: overrides.app ?? { viewMode: 'live' },
    liveDebug,
    liveDebugDiagnostics: overrides.liveDebugDiagnostics ?? {
      longTaskObserver: null,
      lastDomSelectionChangeLoggedAt: 0
    },
    liveDebugKeylogKeys: overrides.liveDebugKeylogKeys ?? new Set(['ArrowDown']),
    liveDebugDomSelectionThrottleMs: 120,
    normalizeLogString: (value) => String(value),
    normalizePointerTarget: (target) => target ?? null,
    readPointerCoordinates: () => null,
    describeElementForLog: () => null,
    recordInputSignal: (_kind, payload) => payload,
    moveLiveCursorVertically: overrides.moveLiveCursorVertically ?? (() => false),
    scheduleCursorVisibilityProbe: overrides.scheduleCursorVisibilityProbe ?? (() => {}),
    readDomSelectionForLog: () => null,
    windowObject: overrides.windowObject ?? {
      addEventListener() {},
      getSelection() {
        return null;
      }
    },
    documentObject: overrides.documentObject ?? {
      activeElement: null,
      addEventListener() {}
    },
    performanceObserverClass: overrides.performanceObserverClass ?? null,
    elementConstructor: null,
    nodeConstructor: null
  });
}

test('installRuntimeDiagnostics registers error and rejection handlers', () => {
  const liveDebug = createLiveDebugSpy();
  const windowListeners = new Map();
  const controller = createController({
    liveDebug,
    app: { viewMode: 'raw' },
    windowObject: {
      addEventListener(type, handler) {
        windowListeners.set(type, handler);
      }
    },
    performanceObserverClass: null
  });

  controller.installRuntimeDiagnostics();

  assert.equal(liveDebug.calls.info[0].event, 'diagnostics.runtime.installed');
  assert.equal(liveDebug.calls.info[0].data.hasPerformanceObserver, false);
  assert.equal(typeof windowListeners.get('error'), 'function');
  assert.equal(typeof windowListeners.get('unhandledrejection'), 'function');

  windowListeners.get('error')({
    message: 'boom',
    filename: 'main.js',
    lineno: 11,
    colno: 7,
    error: null
  });
  windowListeners.get('unhandledrejection')({
    reason: new Error('promise-boom')
  });

  assert.equal(liveDebug.calls.error[0].event, 'window.error');
  assert.equal(liveDebug.calls.error[0].data.message, 'boom');
  assert.equal(liveDebug.calls.error[1].event, 'window.unhandledrejection');
  assert.equal(liveDebug.calls.error[1].data.reason, 'promise-boom');
});

test('installEditorInputDiagnostics intercepts vertical keydown and schedules probe', () => {
  const liveDebug = createLiveDebugSpy();
  const domHandlers = new Map();
  const documentHandlers = new Map();
  const probeReasons = [];
  const moveCalls = [];
  const view = {
    hasFocus: true,
    state: {
      selection: {
        main: {
          head: 3
        }
      }
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
  const controller = createController({
    liveDebug,
    moveLiveCursorVertically: (nextView, direction, trigger) => {
      moveCalls.push({ nextView, direction, trigger });
      nextView.state.selection.main.head = 9;
      return true;
    },
    scheduleCursorVisibilityProbe: (_view, reason) => {
      probeReasons.push(reason);
    },
    documentObject: {
      activeElement: null,
      addEventListener(type, handler) {
        documentHandlers.set(type, handler);
      }
    }
  });

  controller.installEditorInputDiagnostics(view);

  assert.equal(typeof domHandlers.get('mousedown'), 'function');
  assert.equal(typeof domHandlers.get('touchstart'), 'function');
  assert.equal(typeof domHandlers.get('keydown'), 'function');
  assert.equal(typeof documentHandlers.get('selectionchange'), 'function');
  assert.equal(liveDebug.calls.info.at(-1).event, 'diagnostics.editor-input.installed');

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
    target: null,
    preventDefault() {
      prevented = true;
    },
    stopPropagation() {
      stopped = true;
    }
  });

  assert.equal(moveCalls.length, 1);
  assert.equal(moveCalls[0].nextView, view);
  assert.equal(moveCalls[0].direction, 1);
  assert.equal(moveCalls[0].trigger, 'root-keydown-ArrowDown');
  assert.equal(prevented, true);
  assert.equal(stopped, true);
  assert.deepEqual(probeReasons, ['vertical-intercept-applied']);
});
