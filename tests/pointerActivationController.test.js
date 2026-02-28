import test from 'node:test';
import assert from 'node:assert/strict';
import { createPointerActivationController } from '../src/core/selection/ActivationController.js';

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

function createDoc(length = 120) {
  return {
    length,
    lineAt(position) {
      const clamped = Math.max(0, Math.min(length, Number.isFinite(position) ? Math.trunc(position) : 0));
      return {
        from: 0,
        to: length,
        number: 1,
        text: '',
        length: length - clamped
      };
    }
  };
}

function createView({ docLength = 120, mappedPos = 12 } = {}) {
  const dispatched = [];
  let focusCount = 0;
  const view = {
    state: {
      doc: createDoc(docLength),
      selection: {
        main: {
          anchor: 0,
          head: 0,
          empty: true
        }
      }
    },
    dispatch(transaction) {
      dispatched.push(transaction);
    },
    focus() {
      focusCount += 1;
    },
    posAtCoords() {
      return mappedPos;
    },
    posAtDOM() {
      return mappedPos;
    }
  };
  return {
    view,
    dispatched,
    readFocusCount: () => focusCount
  };
}

function createController(overrides = {}) {
  const liveDebug = overrides.liveDebug ?? createLiveDebugSpy();
  return createPointerActivationController({
    app: { viewMode: 'live', ...(overrides.app ?? {}) },
    liveDebug,
    liveBlocksForView: overrides.liveBlocksForView ?? (() => [{ from: 10, to: 15 }]),
    normalizePointerTarget: overrides.normalizePointerTarget ?? ((target) => target ?? null),
    readPointerCoordinates: overrides.readPointerCoordinates ?? ((event) => (
      Number.isFinite(event?.clientX) && Number.isFinite(event?.clientY)
        ? { x: event.clientX, y: event.clientY }
        : null
    )),
    describeElementForLog: overrides.describeElementForLog ?? ((element) => (
      element
        ? {
            tagName: element.tagName ?? null,
            className: typeof element.className === 'string' ? element.className : null,
            sourceFrom: null
          }
        : null
    )),
    recordInputSignal: overrides.recordInputSignal ?? ((_kind, payload) => payload),
    resolvePointerPosition: overrides.resolvePointerPosition ?? ((view, _target, coordinates) => (
      view.posAtCoords(coordinates)
    )),
    readLineInfoForPosition: overrides.readLineInfoForPosition ?? ((doc, position) => (
      Number.isFinite(position)
        ? { lineNumber: 1, from: 0, to: doc.length }
        : null
    )),
    readBlockLineBoundsForLog: overrides.readBlockLineBoundsForLog ?? (() => (
      { startLineNumber: 1, endLineNumber: 1 }
    )),
    resolveActivationBlockBounds: overrides.resolveActivationBlockBounds ?? ((_blocks, sourceFrom) => (
      Number.isFinite(sourceFrom)
        ? { from: sourceFrom, to: sourceFrom + 5 }
        : null
    ))
  });
}

test('handleLivePointerActivation returns false when mode is not live', () => {
  const debugSpy = createLiveDebugSpy();
  const controller = createController({
    liveDebug: debugSpy,
    app: { viewMode: 'preview' }
  });
  const { view, dispatched, readFocusCount } = createView({ docLength: 40, mappedPos: 12 });

  const handled = controller.handleLivePointerActivation(
    view,
    {
      target: {
        tagName: 'DIV',
        className: 'cm-rendered-block'
      },
      clientX: 30,
      clientY: 40,
      preventDefault() {}
    },
    'mousedown'
  );

  assert.equal(handled, false);
  assert.equal(dispatched.length, 0);
  assert.equal(readFocusCount(), 0);
  assert.equal(debugSpy.calls.trace.length, 0);
});

test('handleLivePointerActivation logs miss when pointer target is unavailable', () => {
  const debugSpy = createLiveDebugSpy();
  const controller = createController({
    liveDebug: debugSpy
  });
  const { view, dispatched } = createView({ docLength: 40, mappedPos: 12 });

  const handled = controller.handleLivePointerActivation(
    view,
    {
      target: null,
      clientX: 30,
      clientY: 40,
      preventDefault() {}
    },
    'mousedown'
  );

  assert.equal(handled, false);
  assert.equal(dispatched.length, 0);
  const traceEvents = debugSpy.calls.trace.map((entry) => entry.event);
  assert.ok(traceEvents.includes('input.pointer'));
  assert.ok(traceEvents.includes('block.activate.miss'));
});

test('handleLivePointerActivation dispatches mapped activation in live mode', () => {
  const debugSpy = createLiveDebugSpy();
  const controller = createController({
    liveDebug: debugSpy
  });
  const { view, dispatched, readFocusCount } = createView({ docLength: 40, mappedPos: 12 });
  let defaultPrevented = false;
  const target = {
    tagName: 'DIV',
    className: 'cm-rendered-block'
  };

  const handled = controller.handleLivePointerActivation(
    view,
    {
      target,
      clientX: 30,
      clientY: 40,
      preventDefault() {
        defaultPrevented = true;
      }
    },
    'mousedown'
  );

  assert.equal(handled, true);
  assert.equal(defaultPrevented, true);
  assert.equal(dispatched.length, 1);
  assert.equal(readFocusCount(), 1);
  const traceEvents = debugSpy.calls.trace.map((entry) => entry.event);
  assert.ok(traceEvents.includes('input.pointer'));
  assert.ok(traceEvents.includes('pointer.map.native'));
  assert.ok(traceEvents.includes('block.activate.request'));
  assert.ok(traceEvents.includes('block.activated'));
});

test('handleLivePointerActivation records pointer signal and includes signal payload in trace event', () => {
  const debugSpy = createLiveDebugSpy();
  const recordedSignals = [];
  const controller = createController({
    liveDebug: debugSpy,
    recordInputSignal: (kind, payload) => {
      recordedSignals.push({ kind, payload });
      return {
        ...payload,
        kind,
        signalId: 'sig-1'
      };
    }
  });
  const { view } = createView({ docLength: 40, mappedPos: 12 });

  controller.handleLivePointerActivation(
    view,
    {
      target: {
        tagName: 'DIV',
        className: 'cm-content'
      },
      clientX: 30,
      clientY: 40,
      preventDefault() {}
    },
    'mousedown'
  );

  assert.equal(recordedSignals.length, 1);
  assert.equal(recordedSignals[0].kind, 'pointer');
  const pointerTrace = debugSpy.calls.trace.find((entry) => entry.event === 'input.pointer');
  assert.ok(pointerTrace);
  assert.equal(pointerTrace.data.signalId, 'sig-1');
  assert.equal(pointerTrace.data.kind, 'pointer');
});

test('handleLivePointerActivation emits pointer.map.clamped when mapped position exceeds doc bounds', () => {
  const debugSpy = createLiveDebugSpy();
  const controller = createController({
    liveDebug: debugSpy,
    resolvePointerPosition: () => 999
  });
  const { view } = createView({ docLength: 40, mappedPos: 999 });

  controller.handleLivePointerActivation(
    view,
    {
      target: {
        tagName: 'DIV',
        className: 'cm-content'
      },
      clientX: 30,
      clientY: 40,
      preventDefault() {}
    },
    'mousedown'
  );

  const warnEvent = debugSpy.calls.warn.find((entry) => entry.event === 'pointer.map.clamped');
  assert.ok(warnEvent);
  assert.equal(warnEvent.data.mappedPosition, 40);
  assert.equal(warnEvent.data.rawMappedPosition, 999);
});

test('handleLivePointerActivation toggles rendered task checkbox using source mapping', () => {
  const debugSpy = createLiveDebugSpy();
  const controller = createController({
    liveDebug: debugSpy
  });

  const docText = '- [ ] task one';
  const dispatched = [];
  let focusCount = 0;
  const view = {
    state: {
      doc: {
        length: docText.length,
        sliceString(from, to) {
          return docText.slice(from, to);
        },
        lineAt() {
          return {
            from: 0,
            to: docText.length,
            number: 1
          };
        }
      },
      selection: {
        main: {
          anchor: 0,
          head: 0,
          empty: true
        }
      }
    },
    dispatch(transaction) {
      dispatched.push(transaction);
    },
    focus() {
      focusCount += 1;
    }
  };

  let defaultPrevented = false;
  const handled = controller.handleLivePointerActivation(
    view,
    {
      target: {
        checked: false,
        getAttribute(name) {
          if (name === 'data-task-source-from') {
            return '0';
          }
          return null;
        },
        closest() {
          return null;
        }
      },
      clientX: 30,
      clientY: 40,
      preventDefault() {
        defaultPrevented = true;
      }
    },
    'mousedown'
  );

  assert.equal(handled, true);
  assert.equal(defaultPrevented, true);
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].changes.from, 3);
  assert.equal(dispatched[0].changes.to, 4);
  assert.equal(dispatched[0].changes.insert, 'x');
  assert.equal(focusCount, 1);
  assert.ok(debugSpy.calls.trace.some((entry) => entry.event === 'task.toggle'));
});

test('handleLivePointerActivation opens link on modifier-click', () => {
  const debugSpy = createLiveDebugSpy();
  const controller = createController({
    liveDebug: debugSpy
  });
  let openedUrl = null;
  const { view } = createView({ docLength: 40, mappedPos: 12 });
  view.contentDOM = {
    ownerDocument: {
      defaultView: {
        open(href) {
          openedUrl = href;
        }
      }
    }
  };

  let defaultPrevented = false;
  const anchorTarget = {
    getAttribute(name) {
      if (name === 'href') {
        return 'https://example.com';
      }
      if (name === 'target') {
        return '_blank';
      }
      if (name === 'rel') {
        return 'noopener noreferrer';
      }
      return null;
    },
    closest(selector) {
      if (selector === 'a[href]') {
        return this;
      }
      return null;
    }
  };

  const handled = controller.handleLivePointerActivation(
    view,
    {
      target: anchorTarget,
      clientX: 20,
      clientY: 25,
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      preventDefault() {
        defaultPrevented = true;
      }
    },
    'mousedown'
  );

  assert.equal(handled, true);
  assert.equal(defaultPrevented, true);
  assert.equal(openedUrl, 'https://example.com');
  assert.ok(debugSpy.calls.trace.some((entry) => entry.event === 'link.open.modifier'));
});
