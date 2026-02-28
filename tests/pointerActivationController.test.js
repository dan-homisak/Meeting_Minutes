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

function createRenderedTarget(sourceFromOrConfig = '10') {
  const sourceFrom = typeof sourceFromOrConfig === 'object'
    ? sourceFromOrConfig.sourceFrom ?? '10'
    : sourceFromOrConfig;
  const sourceTo = typeof sourceFromOrConfig === 'object'
    ? sourceFromOrConfig.sourceTo ?? null
    : null;
  const fragmentFrom = typeof sourceFromOrConfig === 'object'
    ? sourceFromOrConfig.fragmentFrom ?? null
    : null;
  const fragmentTo = typeof sourceFromOrConfig === 'object'
    ? sourceFromOrConfig.fragmentTo ?? null
    : null;
  const renderedBlock = {
    getAttribute(name) {
      if (name === 'data-source-from') {
        return sourceFrom;
      }
      if (name === 'data-source-to') {
        return sourceTo;
      }
      if (name === 'data-fragment-from') {
        return fragmentFrom;
      }
      if (name === 'data-fragment-to') {
        return fragmentTo;
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
    liveSourceMapIndexForView: () => [],
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

test('resolveLiveActivationContext returns null without pass-through log for non-rendered target', () => {
  const debugSpy = createLiveDebugSpy();
  const controller = createController({
    liveDebug: debugSpy
  });
  const nonRenderedTarget = {
    tagName: 'P',
    className: 'para',
    closest() {
      return null;
    }
  };

  const activation = controller.resolveLiveActivationContext(
    { state: { doc: createDoc(40) } },
    nonRenderedTarget,
    null,
    'mousedown'
  );

  assert.equal(activation, null);
  const passThroughLog = debugSpy.calls.trace.find(
    (entry) => entry.event === 'block.activate.pass-through-native'
  );
  assert.equal(passThroughLog, undefined);
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
  const missLog = debugSpy.calls.trace.find((entry) => entry.event === 'block.activate.miss');
  assert.ok(missLog);
  assert.equal(missLog.data.reason, 'no-element-target');
});

test('handleLivePointerActivation logs pass-through for non-rendered targets in rendered mode', () => {
  const debugSpy = createLiveDebugSpy();
  const controller = createController({
    liveDebug: debugSpy,
    sourceFirstMode: false
  });
  const { view, dispatched } = createView({ docLength: 40, mappedPos: 12 });
  const nonRenderedTarget = {
    tagName: 'P',
    className: 'para',
    closest() {
      return null;
    }
  };

  const handled = controller.handleLivePointerActivation(
    view,
    {
      target: nonRenderedTarget,
      clientX: 30,
      clientY: 40,
      preventDefault() {}
    },
    'mousedown'
  );

  assert.equal(handled, false);
  assert.equal(dispatched.length, 0);
  const passThroughLog = debugSpy.calls.trace.find(
    (entry) => entry.event === 'block.activate.pass-through-native'
  );
  assert.ok(passThroughLog);
  assert.equal(passThroughLog.data.reason, 'not-rendered-block-target');
  assert.equal(passThroughLog.data.tagName, 'P');
});

test('handleLivePointerActivation records pointer signal and traces input event payload', () => {
  const debugSpy = createLiveDebugSpy();
  const recordedSignals = [];
  const controller = createController({
    liveDebug: debugSpy,
    sourceFirstMode: true,
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
  const { targetElement } = createRenderedTarget('10');

  controller.handleLivePointerActivation(
    view,
    {
      target: targetElement,
      clientX: 30,
      clientY: 40,
      preventDefault() {}
    },
    'mousedown'
  );

  assert.equal(recordedSignals.length, 1);
  assert.equal(recordedSignals[0].kind, 'pointer');
  assert.equal(recordedSignals[0].payload.trigger, 'mousedown');
  assert.equal(recordedSignals[0].payload.x, 30);
  assert.equal(recordedSignals[0].payload.y, 40);
  assert.equal(recordedSignals[0].payload.targetTag, 'DIV');
  const pointerTrace = debugSpy.calls.trace.find((entry) => entry.event === 'input.pointer');
  assert.ok(pointerTrace);
  assert.equal(pointerTrace.data.signalId, 'sig-1');
  assert.equal(pointerTrace.data.kind, 'pointer');
  assert.equal(pointerTrace.data.target.tagName, 'DIV');
});

test('handleLivePointerActivation logs failed activation when block dispatch throws', () => {
  const debugSpy = createLiveDebugSpy();
  const controller = createController({
    liveDebug: debugSpy
  });
  const { view } = createView({ docLength: 40, mappedPos: 12 });
  view.dispatch = () => {
    throw new Error('dispatch exploded');
  };
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
  assert.equal(defaultPrevented, true);
  const dispatchFailed = debugSpy.calls.error.find(
    (entry) => entry.event === 'block.activate.dispatch-failed'
  );
  assert.ok(dispatchFailed);
  assert.equal(dispatchFailed.data.message, 'dispatch exploded');
  const failed = debugSpy.calls.error.find(
    (entry) => entry.event === 'block.activate.failed'
  );
  assert.ok(failed);
  assert.equal(failed.data.message, 'dispatch exploded');
});

test('resolveLiveActivationContext prefers source-map fragment clamping before heuristic fallback', () => {
  const controller = createController({
    liveBlocksForView: () => [],
    liveSourceMapIndexForView: () => [
      {
        id: 'block:10:20',
        kind: 'block',
        sourceFrom: 10,
        sourceTo: 20,
        blockFrom: 10,
        blockTo: 20,
        fragmentFrom: 10,
        fragmentTo: 20
      },
      {
        id: 'fragment:12:16',
        kind: 'rendered-fragment',
        sourceFrom: 12,
        sourceTo: 16,
        blockFrom: 10,
        blockTo: 20,
        fragmentFrom: 12,
        fragmentTo: 16
      }
    ],
    resolveActivationBlockBounds: () => null,
    resolvePointerPosition: () => 18,
    resolvePositionFromRenderedSourceRange: () => null
  });
  const { view } = createView({ docLength: 40, mappedPos: 18 });
  const { targetElement } = createRenderedTarget({
    sourceFrom: '10',
    sourceTo: '20',
    fragmentFrom: '12',
    fragmentTo: '16'
  });

  const activation = controller.resolveLiveActivationContext(
    view,
    targetElement,
    { x: 30, y: 40 },
    'mousedown'
  );

  assert.ok(activation);
  assert.equal(activation.sourcePosOrigin, 'source-map-fragment');
  assert.equal(activation.sourcePos, 15);
  assert.equal(activation.sourceFrom, 10);
  assert.equal(activation.allowCoordinateRemap, false);
  assert.deepEqual(activation.blockBounds, { from: 10, to: 20 });
  assert.deepEqual(activation.match, {
    block: 'block:10:20',
    fragment: 'fragment:12:16'
  });
});
