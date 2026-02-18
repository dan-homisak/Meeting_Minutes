import test from 'node:test';
import assert from 'node:assert/strict';
import { createPointerActivationController } from '../src/live/pointerActivationController.js';

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
      const clamped = Math.max(0, Math.min(length, Number.isFinite(position) ? position : 0));
      return {
        from: 0,
        to: length,
        number: 1,
        text: '',
        length: length - clamped
      };
    },
    line(number) {
      return {
        from: 0,
        to: length,
        number: Number.isFinite(number) ? number : 1,
        text: ''
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
      if (transaction?.selection?.anchor != null) {
        this.state.selection.main.anchor = transaction.selection.anchor;
        this.state.selection.main.head = transaction.selection.anchor;
      }
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
  return { view, dispatched, readFocusCount: () => focusCount };
}

function createRenderedTarget(sourceFrom = '10') {
  const renderedBlock = {
    getAttribute(name) {
      if (name === 'data-source-from') {
        return sourceFrom;
      }
      return null;
    }
  };
  const targetElement = {
    tagName: 'DIV',
    className: 'cm-rendered-block',
    closest(selector) {
      if (selector === '.cm-rendered-block') {
        return renderedBlock;
      }
      return null;
    }
  };
  return { targetElement, renderedBlock };
}

function createController(overrides = {}) {
  const liveDebug = overrides.liveDebug ?? createLiveDebugSpy();
  return createPointerActivationController({
    app: { viewMode: 'live', ...(overrides.app ?? {}) },
    liveDebug,
    sourceFirstMode: false,
    requestAnimationFrameFn: (callback) => {
      callback();
      return 1;
    },
    liveBlocksForView: () => [{ from: 10, to: 15 }],
    normalizePointerTarget: (target) => target ?? null,
    readPointerCoordinates: (event) => (
      Number.isFinite(event?.clientX) && Number.isFinite(event?.clientY)
        ? { x: event.clientX, y: event.clientY }
        : null
    ),
    describeElementForLog: (element) => (
      element
        ? {
            tagName: element.tagName ?? null,
            className: element.className ?? null,
            sourceFrom: null
          }
        : null
    ),
    recordInputSignal: (_kind, payload) => payload,
    resolvePointerPosition: () => 12,
    readLineInfoForPosition: (doc, position) => (
      Number.isFinite(position)
        ? { lineNumber: 1, from: 0, to: doc.length }
        : null
    ),
    readBlockLineBoundsForLog: () => ({ startLineNumber: 1, endLineNumber: 1 }),
    resolveActivationBlockBounds: (_blocks, sourceFrom) => (
      Number.isFinite(sourceFrom)
        ? { from: sourceFrom, to: sourceFrom + 5 }
        : null
    ),
    resolveLiveBlockSelection: (_docLength, sourceFrom, preferred, blockBounds = null) => {
      const candidate = Number.isFinite(preferred) ? Math.trunc(preferred) : sourceFrom;
      if (!blockBounds) {
        return candidate;
      }
      const max = Math.max(blockBounds.from, blockBounds.to - 1);
      return Math.max(blockBounds.from, Math.min(max, candidate));
    },
    findBlockContainingPosition: () => ({ from: 10, to: 15 }),
    findNearestBlockForPosition: () => ({ from: 10, to: 15 }),
    isFencedCodeBlock: () => false,
    parseSourceFromAttribute: (value) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    },
    findRenderedSourceRangeTarget: () => null,
    resolvePositionFromRenderedSourceRange: () => null,
    distanceToBlockBounds: (position, blockBounds) => {
      if (!Number.isFinite(position) || !blockBounds) {
        return null;
      }
      if (position < blockBounds.from) {
        return blockBounds.from - position;
      }
      if (position >= blockBounds.to) {
        return position - (blockBounds.to - 1);
      }
      return 0;
    },
    shouldPreferRenderedDomAnchorPosition: () => false,
    shouldPreferSourceFromForRenderedFencedClick: () => false,
    shouldPreferSourceFromForRenderedBoundaryClick: () => false,
    buildRenderedPointerProbe: () => ({
      pointer: {
        pointerDistanceToBlockBottom: 3,
        pointerRatioY: 0.5
      },
      verticalScanCoordSamples: [],
      edgeCoordSamples: []
    }),
    summarizeLineNumbersForCoordSamples: () => [],
    normalizeLogString: (value) => String(value),
    ...overrides
  });
}

test('resolveLiveActivationContext returns null for invalid rendered block source', () => {
  const debugSpy = createLiveDebugSpy();
  const controller = createController({
    liveDebug: debugSpy,
    parseSourceFromAttribute: () => null
  });
  const { targetElement } = createRenderedTarget('invalid');

  const activation = controller.resolveLiveActivationContext({ state: { doc: createDoc(40) } }, targetElement, null, 'mousedown');
  assert.equal(activation, null);
  assert.equal(debugSpy.calls.warn.length, 1);
  assert.equal(debugSpy.calls.warn[0].event, 'block.activate.skipped');
});

test('activateLiveBlock dispatches and skips coordinate remap when disabled', () => {
  const rafCalls = [];
  const controller = createController({
    requestAnimationFrameFn: (callback) => {
      rafCalls.push(callback);
      return 1;
    }
  });
  const { view, dispatched, readFocusCount } = createView({ docLength: 40, mappedPos: 14 });

  controller.activateLiveBlock(
    view,
    10,
    { x: 5, y: 9 },
    'mousedown',
    { from: 10, to: 15 },
    12,
    false,
    'rendered-block'
  );

  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].selection.anchor, 12);
  assert.equal(dispatched[0].scrollIntoView, true);
  assert.equal(readFocusCount(), 1);
  assert.equal(rafCalls.length, 0);
});

test('handleLivePointerActivation prevents default and activates rendered block', () => {
  const controller = createController();
  const { view, dispatched } = createView({ docLength: 40, mappedPos: 12 });
  const { targetElement } = createRenderedTarget('10');
  let defaultPrevented = false;

  const handled = controller.handleLivePointerActivation(
    view,
    {
      target: targetElement,
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
  assert.equal(dispatched[0].selection.anchor, 12);
});

test('handleLivePointerActivation in source-first mode passes through native handling', () => {
  const controller = createController({
    sourceFirstMode: true
  });
  const { view, dispatched } = createView({ docLength: 40, mappedPos: 12 });
  const { targetElement } = createRenderedTarget('10');
  let defaultPrevented = false;

  const handled = controller.handleLivePointerActivation(
    view,
    {
      target: targetElement,
      clientX: 30,
      clientY: 40,
      preventDefault() {
        defaultPrevented = true;
      }
    },
    'mousedown'
  );

  assert.equal(handled, false);
  assert.equal(defaultPrevented, false);
  assert.equal(dispatched.length, 0);
});
