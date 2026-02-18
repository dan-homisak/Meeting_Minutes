import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveEditorExtensions } from '../src/bootstrap/createLiveEditorExtensions.js';

test('createLiveEditorExtensions wires pointer handlers and atomic ranges', () => {
  const calls = {
    trace: [],
    activation: [],
    signals: [],
    cursorProbe: []
  };
  let capturedHandlers = null;
  let capturedAtomicProvider = null;
  const app = {
    viewMode: 'raw'
  };
  const liveDebugKeylogKeys = new Set(['Enter', 'ArrowDown']);
  const liveRuntimeHelpers = {
    handleLivePointerActivation(view, event, trigger) {
      calls.activation.push({ view, event, trigger });
      return true;
    },
    recordInputSignal(kind, details) {
      calls.signals.push({ kind, details });
      return {
        at: 10,
        kind,
        ...details
      };
    },
    scheduleCursorVisibilityProbe(view, reason) {
      calls.cursorProbe.push({ view, reason });
    }
  };
  const liveDebug = {
    trace(event, data) {
      calls.trace.push({ event, data });
    }
  };

  const { livePreviewPointerHandlers, livePreviewAtomicRanges } = createLiveEditorExtensions({
    app,
    liveDebug,
    liveDebugKeylogKeys,
    liveRuntimeHelpers,
    factories: {
      createDomEventHandlers(handlers) {
        capturedHandlers = handlers;
        return { handlers };
      },
      createAtomicRanges(provider) {
        capturedAtomicProvider = provider;
        return { provider };
      },
      decorationNone: 'none-decoration'
    }
  });

  assert.equal(livePreviewPointerHandlers.handlers, capturedHandlers);
  assert.equal(livePreviewAtomicRanges.provider, capturedAtomicProvider);
  assert.equal(capturedAtomicProvider(), 'none-decoration');

  const view = {
    state: {
      selection: {
        main: {
          anchor: 2,
          head: 5
        }
      }
    }
  };

  assert.equal(capturedHandlers.mousedown({ type: 'mousedown' }, view), true);
  assert.equal(capturedHandlers.touchstart({ type: 'touchstart' }, view), true);
  assert.equal(calls.activation.length, 2);

  assert.equal(capturedHandlers.keydown({ key: 'x' }, view), false);
  assert.equal(calls.signals.length, 0);
  assert.equal(calls.trace.length, 0);

  assert.equal(
    capturedHandlers.keydown(
      {
        key: 'Enter',
        altKey: true,
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
        repeat: true
      },
      view
    ),
    false
  );
  assert.equal(calls.signals.length, 1);
  assert.equal(calls.trace.length, 1);
  assert.equal(calls.trace[0].event, 'input.keydown');
  assert.equal(calls.trace[0].data.mode, 'raw');
  assert.equal(calls.trace[0].data.selectionHead, 5);

  assert.equal(capturedHandlers.focus({}, view), false);
  assert.equal(capturedHandlers.blur({}, view), false);
  assert.equal(calls.cursorProbe.length, 1);
  assert.equal(calls.cursorProbe[0].reason, 'editor-focus');
  assert.deepEqual(
    calls.trace.map((entry) => entry.event),
    ['input.keydown', 'editor.focus', 'editor.blur']
  );
});

test('createLiveEditorExtensions keydown logs in live mode even for non-keylog keys', () => {
  let capturedHandlers = null;
  const calls = {
    signals: []
  };
  const { livePreviewPointerHandlers } = createLiveEditorExtensions({
    app: { viewMode: 'live' },
    liveDebug: {
      trace() {}
    },
    liveDebugKeylogKeys: new Set(),
    liveRuntimeHelpers: {
      handleLivePointerActivation() {
        return false;
      },
      recordInputSignal(kind, details) {
        calls.signals.push({ kind, details });
        return { kind, ...details };
      },
      scheduleCursorVisibilityProbe() {}
    },
    factories: {
      createDomEventHandlers(handlers) {
        capturedHandlers = handlers;
        return { handlers };
      },
      createAtomicRanges(provider) {
        return { provider };
      },
      decorationNone: 'none-decoration'
    }
  });

  assert.equal(Boolean(livePreviewPointerHandlers), true);
  assert.equal(
    capturedHandlers.keydown(
      {
        key: 'a',
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        repeat: false
      },
      {
        state: {
          selection: {
            main: {
              anchor: 0,
              head: 0
            }
          }
        }
      }
    ),
    false
  );
  assert.equal(calls.signals.length, 1);
});
