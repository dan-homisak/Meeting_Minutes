import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBlockActivationDispatchLogPayloads,
  buildBlockActivationDispatchEvents,
  resolveBlockActivationDispatch,
  resolveBlockActivationSelectionContext,
  buildMappedPositionLogEvents,
  buildMappedPositionSkippedLogEvents,
  buildMappedPositionLogPayloads,
  buildVerticalCursorMoveLogEvents,
  buildVerticalCursorMoveLogPayloads,
  buildPointerInputSignalPayload,
  buildPointerInputTraceEvent,
  buildPointerActivationEvents,
  buildPointerActivationLogPayloads,
  resolvePointerActivationDispatch,
  buildRenderedActivationLogEvents,
  buildRenderedActivationLogPayloads,
  buildSourceFirstPointerLogEvents,
  buildSourceFirstPointerLogPayloads,
  clampCursorPositionToSourceMapBlock,
  emitLiveDebugEvents,
  findSourceMapBlockAtPosition,
  findSourceMapBlockBoundsForPosition,
  findSourceMapContext,
  readSourceMapIndexForView,
  resolveVerticalCursorAssocCorrection,
  resolveVerticalCursorMoveContext,
  resolveMappedSelectionRemap,
  resolveMappedSelectionRemapPreflight,
  resolveMappedSelectionUpdate,
  resolvePointerActivationPreflight,
  resolvePointerActivationIntent,
  resolvePointerInputSignalEvents,
  resolveRenderedActivationContext,
  resolveRenderedPointerActivation,
  resolveRenderedActivationTarget,
  resolveSourceFirstPointerActivation,
  resolveSourceFirstPointerMapping,
  resolveRenderedBoundaryPolicy,
  resolveRenderedSelectionPreference,
  resolveRenderedSourcePosition
} from '../src/core/selection/SelectionPolicy.js';
import {
  resolveLiveBlockSelection,
  shouldPreferSourceFromForRenderedBoundaryClick,
  shouldPreferSourceFromForRenderedFencedClick,
  shouldPreferRenderedDomAnchorPosition
} from '../src/core/selection/LiveActivationHelpers.js';

function createSourceMapIndex() {
  return [
    {
      id: 'block:10-20',
      kind: 'block',
      sourceFrom: 10,
      sourceTo: 20,
      blockFrom: 10,
      blockTo: 20,
      fragmentFrom: 10,
      fragmentTo: 20
    },
    {
      id: 'fragment:12-18',
      kind: 'rendered-fragment',
      sourceFrom: 12,
      sourceTo: 18,
      blockFrom: 10,
      blockTo: 20,
      fragmentFrom: 12,
      fragmentTo: 18
    }
  ];
}

test('readSourceMapIndexForView returns normalized source-map index arrays', () => {
  const view = { id: 'view-1' };

  assert.deepEqual(readSourceMapIndexForView(null, view), []);
  assert.deepEqual(readSourceMapIndexForView(() => null, view), []);
  assert.deepEqual(readSourceMapIndexForView(() => [{ id: 'entry' }], view), [{ id: 'entry' }]);
});

test('findSourceMapContext resolves block and fragment bounds with fallback fragment lookup', () => {
  const sourceMapIndex = createSourceMapIndex();

  const exact = findSourceMapContext(sourceMapIndex, 10, 20, 12, 18);
  assert.deepEqual(exact.blockBounds, { from: 10, to: 20 });
  assert.deepEqual(exact.fragmentBounds, { from: 12, to: 18 });
  assert.deepEqual(exact.match, {
    block: 'block:10-20',
    fragment: 'fragment:12-18'
  });

  const fallbackFragment = findSourceMapContext(sourceMapIndex, 10, 20, 40, 45);
  assert.deepEqual(fallbackFragment.blockBounds, { from: 10, to: 20 });
  assert.deepEqual(fallbackFragment.fragmentBounds, { from: 12, to: 18 });
  assert.deepEqual(fallbackFragment.match, {
    block: 'block:10-20',
    fragment: 'fragment:12-18'
  });
});

test('findSourceMapBlockBoundsForPosition returns normalized block bounds from matches', () => {
  const sourceMapIndex = createSourceMapIndex();

  assert.deepEqual(findSourceMapBlockBoundsForPosition(sourceMapIndex, 13), { from: 10, to: 20 });
  assert.equal(findSourceMapBlockBoundsForPosition(sourceMapIndex, 3), null);
});

test('findSourceMapBlockAtPosition returns containing and near-adjacent block entries', () => {
  const sourceMapIndex = createSourceMapIndex();

  assert.equal(findSourceMapBlockAtPosition(sourceMapIndex, 13)?.id, 'block:10-20');
  assert.equal(findSourceMapBlockAtPosition(sourceMapIndex, 20)?.id, 'block:10-20');
  assert.equal(findSourceMapBlockAtPosition(sourceMapIndex, 22), null);
});

test('clampCursorPositionToSourceMapBlock clamps to deterministic source-map block bounds', () => {
  const blockEntry = {
    sourceFrom: 10,
    sourceTo: 20
  };

  assert.deepEqual(clampCursorPositionToSourceMapBlock(15, blockEntry), {
    position: 15,
    clamped: false
  });
  assert.deepEqual(clampCursorPositionToSourceMapBlock(24, blockEntry), {
    position: 20,
    clamped: true
  });
  assert.deepEqual(clampCursorPositionToSourceMapBlock(-5, blockEntry), {
    position: 10,
    clamped: true
  });
});

test('resolveVerticalCursorMoveContext resolves boundary and clamped target states', () => {
  const doc = {
    lines: 2,
    lineAt(position) {
      if (position <= 4) {
        return { from: 0, to: 4, number: 1, text: 'abcd' };
      }
      return { from: 5, to: 7, number: 2, text: 'xy' };
    },
    line(number) {
      if (number === 1) {
        return { from: 0, to: 4, number: 1, text: 'abcd' };
      }
      return { from: 5, to: 7, number: 2, text: 'xy' };
    }
  };

  const boundary = resolveVerticalCursorMoveContext({
    doc,
    selection: {
      anchor: 0,
      head: 0,
      empty: true
    },
    direction: -1,
    sourceMapIndex: []
  });
  assert.equal(boundary.status, 'boundary');
  assert.equal(boundary.fromLine, 1);

  const target = resolveVerticalCursorMoveContext({
    doc,
    selection: {
      anchor: 2,
      head: 2,
      empty: true
    },
    direction: 1,
    sourceMapIndex: [
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
  assert.equal(target.status, 'target');
  assert.equal(target.rawTargetPos, 7);
  assert.equal(target.to, 6);
  assert.equal(target.sourceMapClamp.clamped, true);
  assert.equal(target.sourceMapTargetBlock.id, 'block:line-2');
  assert.equal(target.primaryAssoc, -1);
  assert.equal(target.secondaryAssoc, 1);
});

test('buildVerticalCursorMoveLogPayloads serializes cursor move diagnostics payloads', () => {
  const moveContext = {
    status: 'target',
    anchor: 2,
    head: 2,
    direction: 1,
    from: 2,
    to: 6,
    fromLine: 1,
    toLine: 2,
    currentColumn: 2,
    currentLineLength: 4,
    targetLineLength: 2,
    rawTargetPos: 7,
    sourceMapTargetBlock: {
      id: 'block:line-2',
      sourceFrom: 5,
      sourceTo: 6
    },
    sourceMapClamp: {
      clamped: true
    },
    primaryAssoc: -1,
    secondaryAssoc: 1
  };

  const payloads = buildVerticalCursorMoveLogPayloads({
    trigger: 'ArrowDown',
    moveContext,
    reason: 'non-empty-selection',
    targetLineTextPreview: 'xy',
    targetPos: 6,
    lineNumber: 2,
    lineLength: 2,
    previousAssoc: -1,
    nextAssoc: 1,
    cursorState: {
      hasCursorElement: true
    }
  });

  assert.equal(payloads.skipped.reason, 'non-empty-selection');
  assert.equal(payloads.skipped.anchor, 2);
  assert.equal(payloads.boundary.fromLine, 1);
  assert.equal(payloads.moved.to, 6);
  assert.equal(payloads.moved.targetLineTextPreview, 'xy');
  assert.equal(payloads.moved.sourceMapTargetBlockId, 'block:line-2');
  assert.equal(payloads.sourceMapClamped.rawTargetPos, 7);
  assert.equal(payloads.sourceMapClamped.targetPos, 6);
  assert.equal(payloads.correctedAssoc.lineNumber, 2);
  assert.equal(payloads.correctedAssoc.previousAssoc, -1);
  assert.equal(payloads.correctedAssoc.nextAssoc, 1);
  assert.equal(payloads.correctedAssoc.cursorState.hasCursorElement, true);
});

test('buildVerticalCursorMoveLogEvents emits cursor move trace and warning batches', () => {
  const skippedEvents = buildVerticalCursorMoveLogEvents({
    trigger: 'ArrowDown',
    moveContext: {
      status: 'non-empty-selection',
      anchor: 2,
      head: 3
    }
  });
  assert.equal(skippedEvents.length, 1);
  assert.equal(skippedEvents[0].event, 'cursor.move.vertical.skipped');
  assert.equal(skippedEvents[0].payload.reason, 'non-empty-selection');

  const boundaryEvents = buildVerticalCursorMoveLogEvents({
    trigger: 'ArrowUp',
    moveContext: {
      status: 'boundary',
      direction: -1,
      from: 0,
      fromLine: 1
    }
  });
  assert.equal(boundaryEvents.length, 1);
  assert.equal(boundaryEvents[0].event, 'cursor.move.vertical.boundary');
  assert.equal(boundaryEvents[0].payload.direction, -1);

  const targetEvents = buildVerticalCursorMoveLogEvents({
    trigger: 'ArrowDown',
    targetLineTextPreview: 'xy',
    moveContext: {
      status: 'target',
      direction: 1,
      from: 2,
      to: 6,
      fromLine: 1,
      toLine: 2,
      currentColumn: 2,
      currentLineLength: 4,
      targetLineLength: 2,
      rawTargetPos: 7,
      sourceMapTargetBlock: {
        id: 'block:line-2',
        sourceFrom: 5,
        sourceTo: 6
      },
      sourceMapClamp: {
        clamped: true
      },
      primaryAssoc: -1
    }
  });
  assert.equal(targetEvents.length, 2);
  assert.equal(targetEvents[0].event, 'cursor.move.vertical');
  assert.equal(targetEvents[0].payload.targetLineTextPreview, 'xy');
  assert.equal(targetEvents[1].event, 'cursor.move.vertical.source-map-clamped');
  assert.equal(targetEvents[1].payload.targetPos, 6);
});

test('resolveVerticalCursorAssocCorrection returns corrected-assoc warning batch when suspect', () => {
  const correction = resolveVerticalCursorAssocCorrection({
    trigger: 'ArrowDown',
    moveContext: {
      status: 'target',
      to: 6,
      primaryAssoc: -1,
      secondaryAssoc: 1
    },
    cursorState: {
      hasCursorElement: true
    },
    selectedLine: {
      from: 5,
      to: 7,
      number: 2
    },
    domSelectionOnContentContainer: true,
    isCursorVisibilitySuspect: (_cursorState, lineLength, domSelectionOnContentContainer) => (
      lineLength === 2 && domSelectionOnContentContainer === true
    )
  });

  assert.equal(correction.shouldCorrectAssoc, true);
  assert.equal(correction.selectedLineLength, 2);
  assert.equal(correction.logs.length, 1);
  assert.equal(correction.logs[0].event, 'cursor.move.vertical.corrected-assoc');
  assert.equal(correction.logs[0].payload.targetPos, 6);
  assert.equal(correction.logs[0].payload.lineNumber, 2);
  assert.equal(correction.logs[0].payload.previousAssoc, -1);
  assert.equal(correction.logs[0].payload.nextAssoc, 1);

  const noCorrection = resolveVerticalCursorAssocCorrection({
    trigger: 'ArrowDown',
    moveContext: {
      status: 'target',
      to: 6,
      primaryAssoc: -1,
      secondaryAssoc: 1
    },
    cursorState: {
      hasCursorElement: false
    },
    selectedLine: {
      from: 5,
      to: 7,
      number: 2
    },
    isCursorVisibilitySuspect: () => true
  });

  assert.equal(noCorrection.shouldCorrectAssoc, false);
  assert.equal(noCorrection.logs.length, 0);
});

function distanceToBlockBounds(position, blockBounds) {
  if (!Number.isFinite(position) || !blockBounds) {
    return null;
  }

  const from = Math.min(blockBounds.from, blockBounds.to);
  const to = Math.max(blockBounds.from, blockBounds.to);
  const max = to > from ? to - 1 : from;
  if (position < from) {
    return from - position;
  }

  if (position > max) {
    return position - max;
  }

  return 0;
}

test('resolveRenderedSourcePosition prefers source-range position when available', () => {
  const result = resolveRenderedSourcePosition({
    docLength: 100,
    sourceFrom: 10,
    sourcePosByCoordinates: 18,
    sourcePosBySourceRange: 14,
    sourcePosByDomTarget: 11,
    sourcePosByDomBlock: 12,
    sourceMapFragmentBounds: { from: 10, to: 20 },
    blockBoundsBySourceFrom: { from: 10, to: 20 },
    resolveLiveBlockSelection,
    distanceToBlockBounds,
    shouldPreferRenderedDomAnchorPosition
  });

  assert.equal(result.sourcePos, 14);
  assert.equal(result.sourcePosOrigin, 'source-range');
  assert.equal(result.allowHeuristicSticky, false);
  assert.equal(result.sourcePosBySourceMap, null);
});

test('resolveRenderedSourcePosition uses source-map fragment clamping before heuristic fallback', () => {
  const result = resolveRenderedSourcePosition({
    docLength: 100,
    sourceFrom: 10,
    sourcePosByCoordinates: 35,
    sourcePosBySourceRange: null,
    sourcePosByDomTarget: 12,
    sourcePosByDomBlock: 13,
    sourceMapFragmentBounds: { from: 10, to: 20 },
    blockBoundsBySourceFrom: { from: 10, to: 20 },
    resolveLiveBlockSelection,
    distanceToBlockBounds,
    shouldPreferRenderedDomAnchorPosition
  });

  assert.equal(result.sourcePos, 19);
  assert.equal(result.sourcePosOrigin, 'source-map-fragment');
  assert.equal(result.allowHeuristicSticky, false);
  assert.equal(result.sourcePosBySourceMap, 19);
});

test('resolveRenderedSourcePosition applies dom-sticky clamp and dom fallback origins', () => {
  const stickyResult = resolveRenderedSourcePosition({
    docLength: 100,
    sourceFrom: 10,
    sourcePosByCoordinates: 30,
    sourcePosBySourceRange: null,
    sourcePosByDomTarget: 12,
    sourcePosByDomBlock: 13,
    sourceMapFragmentBounds: null,
    blockBoundsBySourceFrom: { from: 10, to: 20 },
    resolveLiveBlockSelection,
    distanceToBlockBounds,
    shouldPreferRenderedDomAnchorPosition
  });
  assert.equal(stickyResult.allowHeuristicSticky, true);
  assert.equal(stickyResult.preferDomAnchorForRenderedClick, true);
  assert.equal(stickyResult.sourcePos, 19);
  assert.equal(stickyResult.sourcePosOrigin, 'dom-sticky-clamped');

  const fallbackResult = resolveRenderedSourcePosition({
    docLength: 100,
    sourceFrom: 10,
    sourcePosByCoordinates: null,
    sourcePosBySourceRange: null,
    sourcePosByDomTarget: 15,
    sourcePosByDomBlock: 16,
    sourceMapFragmentBounds: null,
    blockBoundsBySourceFrom: { from: 10, to: 20 },
    resolveLiveBlockSelection,
    distanceToBlockBounds,
    shouldPreferRenderedDomAnchorPosition
  });
  assert.equal(fallbackResult.sourcePos, 15);
  assert.equal(fallbackResult.sourcePosOrigin, 'dom-target-fallback');
});

test('resolveRenderedBoundaryPolicy applies fenced/boundary sticky and rebound decisions', () => {
  const fencedSticky = resolveRenderedBoundaryPolicy({
    allowHeuristicSticky: true,
    targetTagName: 'CODE',
    sourceFromBlockIsFencedCode: true,
    sourcePosDistanceToSourceFromBlock: 4,
    sourcePosLineDeltaAfterSourceFromBlock: 1,
    sourcePosOutsideSourceFromBlock: true,
    blockBoundsBySourceFrom: { from: 10, to: 20 },
    blockBoundsBySourcePos: { from: 30, to: 40 },
    pointerDistanceToBlockBottom: 2,
    pointerRatioY: 0.9,
    shouldPreferSourceFromForRenderedFencedClick,
    shouldPreferSourceFromForRenderedBoundaryClick
  });
  assert.equal(fencedSticky.preferSourceFromForRenderedFencedClick, true);
  assert.equal(fencedSticky.preferSourceFromForRenderedBoundaryClick, false);
  assert.equal(fencedSticky.shouldReboundToSourcePosBlock, false);
  assert.deepEqual(fencedSticky.blockBounds, { from: 10, to: 20 });

  const boundarySticky = resolveRenderedBoundaryPolicy({
    allowHeuristicSticky: true,
    targetTagName: 'P',
    sourceFromBlockIsFencedCode: false,
    sourcePosDistanceToSourceFromBlock: 5,
    sourcePosLineDeltaAfterSourceFromBlock: 1,
    sourcePosOutsideSourceFromBlock: true,
    blockBoundsBySourceFrom: { from: 10, to: 20 },
    blockBoundsBySourcePos: { from: 30, to: 40 },
    pointerDistanceToBlockBottom: 4,
    pointerRatioY: 0.6,
    shouldPreferSourceFromForRenderedFencedClick,
    shouldPreferSourceFromForRenderedBoundaryClick
  });
  assert.equal(boundarySticky.preferSourceFromForRenderedFencedClick, false);
  assert.equal(boundarySticky.preferSourceFromForRenderedBoundaryClick, true);
  assert.equal(boundarySticky.shouldReboundToSourcePosBlock, false);
  assert.deepEqual(boundarySticky.blockBounds, { from: 10, to: 20 });

  const rebound = resolveRenderedBoundaryPolicy({
    allowHeuristicSticky: true,
    targetTagName: 'P',
    sourceFromBlockIsFencedCode: false,
    sourcePosDistanceToSourceFromBlock: 20,
    sourcePosLineDeltaAfterSourceFromBlock: 8,
    sourcePosOutsideSourceFromBlock: true,
    blockBoundsBySourceFrom: { from: 10, to: 20 },
    blockBoundsBySourcePos: { from: 30, to: 40 },
    pointerDistanceToBlockBottom: 30,
    pointerRatioY: 0.1,
    shouldPreferSourceFromForRenderedFencedClick,
    shouldPreferSourceFromForRenderedBoundaryClick
  });
  assert.equal(rebound.preferSourceFromForRenderedFencedClick, false);
  assert.equal(rebound.preferSourceFromForRenderedBoundaryClick, false);
  assert.equal(rebound.shouldReboundToSourcePosBlock, true);
  assert.deepEqual(rebound.blockBounds, { from: 30, to: 40 });
});

test('resolveRenderedSelectionPreference returns sticky and in-bounds preferences', () => {
  const stickyPreferred = resolveRenderedSelectionPreference({
    docLength: 100,
    sourceAnchorFrom: 10,
    sourcePos: 30,
    blockBounds: { from: 10, to: 20 },
    blockBoundsBySourceFrom: { from: 10, to: 20 },
    preferSourceFromForRenderedFencedClick: true,
    preferSourceFromForRenderedBoundaryClick: false,
    resolveLiveBlockSelection,
    distanceToBlockBounds
  });
  assert.equal(stickyPreferred.stickySelection, 19);
  assert.equal(stickyPreferred.preferredSelection, 19);
  assert.equal(stickyPreferred.allowCoordinateRemap, false);

  const nearPreferred = resolveRenderedSelectionPreference({
    docLength: 100,
    sourceAnchorFrom: 10,
    sourcePos: 20,
    blockBounds: { from: 10, to: 20 },
    blockBoundsBySourceFrom: { from: 10, to: 20 },
    resolveLiveBlockSelection,
    distanceToBlockBounds
  });
  assert.equal(nearPreferred.sourcePosDistanceToFinalBlock, 1);
  assert.equal(nearPreferred.sourcePosNearFinalBlock, true);
  assert.equal(nearPreferred.preferredSelection, 20);
  assert.equal(nearPreferred.allowCoordinateRemap, false);

  const remapRequired = resolveRenderedSelectionPreference({
    docLength: 100,
    sourceAnchorFrom: 10,
    sourcePos: 24,
    blockBounds: { from: 10, to: 20 },
    blockBoundsBySourceFrom: { from: 10, to: 20 },
    resolveLiveBlockSelection,
    distanceToBlockBounds
  });
  assert.equal(remapRequired.sourcePosDistanceToFinalBlock, 5);
  assert.equal(remapRequired.preferredSelection, null);
  assert.equal(remapRequired.allowCoordinateRemap, true);
});

test('resolveRenderedActivationContext composes activation and rendered log batch', () => {
  const renderedBlock = {
    id: 'rendered-block'
  };
  const targetElement = {
    tagName: 'DIV',
    className: 'cm-rendered-block'
  };
  const view = {
    state: {
      doc: {
        length: 40
      }
    }
  };
  const result = resolveRenderedActivationContext({
    view,
    targetElement,
    coordinates: { x: 30, y: 40 },
    trigger: 'mousedown',
    renderedTarget: {
      renderedBlock,
      sourceFrom: 10,
      sourceTo: 20,
      fragmentFrom: 12,
      fragmentTo: 16
    },
    blocks: [],
    sourceMapIndex: [
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
    resolvePointerPosition: (_view, element, coordinates) => {
      if (element === renderedBlock) {
        return coordinates ? 18 : 13;
      }
      if (element === targetElement) {
        return 12;
      }
      return null;
    },
    findRenderedSourceRangeTarget: () => null,
    resolvePositionFromRenderedSourceRange: () => null,
    resolveActivationBlockBounds: () => null,
    resolveLiveBlockSelection,
    distanceToBlockBounds,
    shouldPreferRenderedDomAnchorPosition,
    findBlockContainingPosition: () => null,
    findNearestBlockForPosition: () => null,
    readBlockLineBoundsForLog: (_doc, blockBounds) => (
      blockBounds ? { startLineNumber: 1, endLineNumber: 1 } : null
    ),
    readLineInfoForPosition: (_doc, position) => (
      Number.isFinite(position) ? { lineNumber: 2 } : null
    ),
    isFencedCodeBlock: () => false,
    buildRenderedPointerProbe: () => ({
      pointer: {
        pointerDistanceToBlockBottom: 3,
        pointerRatioY: 0.7
      },
      verticalScanCoordSamples: [],
      edgeCoordSamples: []
    }),
    summarizeLineNumbersForCoordSamples: () => [],
    shouldPreferSourceFromForRenderedFencedClick,
    shouldPreferSourceFromForRenderedBoundaryClick,
    normalizeLogString: (value) => String(value)
  });

  assert.ok(result.activation);
  assert.equal(result.activation.sourceFrom, 10);
  assert.equal(result.activation.sourcePosOrigin, 'source-map-fragment');
  assert.equal(result.activation.sourcePos, 15);
  assert.equal(result.activation.allowCoordinateRemap, false);
  assert.equal(Array.isArray(result.logs), true);
  assert.equal(
    result.logs.some((entry) => entry.event === 'block.activate.rendered-pointer-probe'),
    true
  );
});

test('buildRenderedActivationLogPayloads serializes rendered activation diagnostics payloads', () => {
  const payloads = buildRenderedActivationLogPayloads({
    trigger: 'mousedown',
    sourceFrom: 10,
    sourcePos: Number.NaN,
    sourcePosOrigin: 'source-map-fragment',
    sourcePosByCoordinates: 22,
    sourcePosBySourceRange: 18,
    sourcePosBySourceMap: 19,
    sourcePosByDomTarget: 12,
    sourcePosByDomBlock: 11,
    sourcePosByStickyClamp: 19,
    sourcePosByCoordinatesDistanceToSourceFromBlock: 4,
    sourcePosBySourceRangeDistanceToSourceFromBlock: 1,
    sourcePosByDomTargetDistanceToSourceFromBlock: 0,
    sourcePosByDomBlockDistanceToSourceFromBlock: 0,
    sourceRangeTarget: {
      range: { from: 18, to: 19, source: 'token' },
      element: { tagName: 'SPAN', className: 'token-emphasis' }
    },
    allowHeuristicSticky: true,
    preferDomAnchorForRenderedClick: true,
    preferSourceFromForRenderedFencedClick: false,
    preferSourceFromForRenderedBoundaryClick: true,
    targetTagName: 'P',
    sourceFromBlockLineBounds: { startLineNumber: 2, endLineNumber: 4 },
    sourcePosBlockLineBounds: { startLineNumber: 5, endLineNumber: 6 },
    sourcePosDistanceToSourceFromBlock: 3,
    sourcePosLineDeltaAfterSourceFromBlock: 1,
    boundaryCrossingLineNumbers: [4, 5],
    boundaryEdgeLineNumbers: [4, 6],
    blockBounds: { from: 10, to: 20 },
    blockBoundsBySourceFrom: { from: 10, to: 20 },
    blockBoundsBySourcePos: { from: 20, to: 30 },
    sourcePosInBounds: false,
    sourcePosDistanceToFinalBlock: 2,
    sourcePosNearFinalBlock: false,
    sourceFromBlockIsFencedCode: false,
    stickySelection: 19,
    preferredSelection: null,
    allowCoordinateRemap: true,
    shouldReboundToSourcePosBlock: true,
    sourceMapMatch: { block: 'b-1', fragment: 'f-1' },
    pointerProbe: {
      pointer: {
        pointerOffsetY: 10,
        pointerRatioY: 0.7,
        pointerDistanceToBlockBottom: 5
      }
    },
    normalizeLogString: (value) => `normalized:${value}`
  });

  assert.equal(payloads.renderedBlockUnbounded.sourcePos, null);
  assert.equal(payloads.rebound.reboundFrom, 10);
  assert.equal(payloads.renderedSourceRange.sourceRangeTagName, 'SPAN');
  assert.equal(payloads.renderedSourceRange.sourceRangeClassName, 'normalized:token-emphasis');
  assert.equal(payloads.renderedBoundaryCrossing.pointerOffsetY, 10);
  assert.equal(payloads.renderedSourcePosOutsideBlock.blockTo, 20);
  assert.equal(payloads.renderedPointerProbe.sourcePos, null);
  assert.equal(payloads.renderedPointerProbe.reboundToSourcePosBlock, true);
  assert.deepEqual(payloads.renderedPointerProbe.sourceMapMatch, {
    block: 'b-1',
    fragment: 'f-1'
  });
});

test('buildRenderedActivationLogEvents emits deterministic rendered activation event batches', () => {
  const renderedLogPayloads = {
    renderedBlockUnbounded: { id: 'renderedBlockUnbounded' },
    rebound: { id: 'rebound' },
    renderedReboundSourcePosBlock: { id: 'renderedReboundSourcePosBlock' },
    renderedDomAnchorSticky: { id: 'renderedDomAnchorSticky' },
    renderedSourceRange: { id: 'renderedSourceRange' },
    renderedFencedSourceSticky: { id: 'renderedFencedSourceSticky' },
    renderedBoundarySourceSticky: { id: 'renderedBoundarySourceSticky' },
    renderedBoundaryCrossing: { id: 'renderedBoundaryCrossing' },
    renderedSourcePosOutsideBlock: { id: 'renderedSourcePosOutsideBlock' },
    renderedPointerProbe: { id: 'renderedPointerProbe' }
  };

  const events = buildRenderedActivationLogEvents({
    sourceFrom: 9,
    sourcePos: 30,
    sourcePosBySourceRange: 18,
    blockBounds: { from: 20, to: 28 },
    blockBoundsBySourceFrom: { from: 10, to: 20 },
    sourcePosInBounds: false,
    shouldReboundToSourcePosBlock: true,
    preferDomAnchorForRenderedClick: true,
    preferSourceFromForRenderedFencedClick: true,
    preferSourceFromForRenderedBoundaryClick: true,
    renderedBoundaryCrossingLikely: true,
    renderedLogPayloads
  });

  assert.deepEqual(
    events.map((entry) => `${entry.level}:${entry.event}`),
    [
      'trace:block.activate.rebound',
      'trace:block.activate.rendered-rebound-source-pos-block',
      'trace:block.activate.rendered-dom-anchor-sticky',
      'trace:block.activate.rendered-source-range',
      'trace:block.activate.rendered-fenced-source-sticky',
      'trace:block.activate.rendered-boundary-source-sticky',
      'warn:block.activate.rendered-boundary-crossing',
      'trace:block.activate.rendered-source-pos-outside-block',
      'trace:block.activate.rendered-pointer-probe'
    ]
  );
  assert.equal(events[0].payload.id, 'rebound');
  assert.equal(events[events.length - 1].payload.id, 'renderedPointerProbe');

  const unboundedEvents = buildRenderedActivationLogEvents({
    sourceFrom: 10,
    sourcePos: 12,
    blockBounds: null,
    blockBoundsBySourceFrom: { from: 9, to: 20 },
    renderedLogPayloads
  });

  assert.equal(unboundedEvents[0].event, 'block.activate.rendered-block-unbounded');
  assert.equal(
    unboundedEvents.some((entry) => entry.event === 'block.activate.rebound'),
    false
  );
  assert.equal(
    unboundedEvents[unboundedEvents.length - 1].event,
    'block.activate.rendered-pointer-probe'
  );
});

test('buildMappedPositionLogPayloads serializes mapped-position diagnostics payloads', () => {
  const payloads = buildMappedPositionLogPayloads({
    trigger: 'mousedown',
    sourceFrom: 10,
    mappedPos: 42,
    mappedAccepted: true,
    mappedPosLooksLikeDocEndDrift: false,
    unboundedPos: 42,
    resolvedPos: 40,
    baseSelection: 12,
    baseSelectionLineInfo: { lineNumber: 2 },
    mappedLineInfo: { lineNumber: 5 },
    resolvedLineInfo: { lineNumber: 4 },
    positionDeltaFromBase: 28,
    lineDeltaFromBase: 2,
    largeDeltaDetected: true,
    rejectMappedSelection: true,
    clampedByBlock: true,
    blockBounds: { from: 10, to: 20 },
    strategy: 'rendered-block',
    preferredSelection: 18,
    allowCoordinateRemap: false,
    skipReason: 'disabled-for-strategy',
    coordinates: { x: 150, y: 240 }
  });

  assert.equal(payloads.mappedSkipped.reason, 'disabled-for-strategy');
  assert.equal(payloads.mappedSkipped.blockFrom, 10);
  assert.equal(payloads.mapped.mappedPos, 42);
  assert.equal(payloads.mapped.largeDeltaDetected, true);
  assert.equal(payloads.mapped.blockTo, 20);
  assert.equal(payloads.mapped.x, 150);
  assert.equal(payloads.mappedLargeDelta.strategy, 'rendered-block');
  assert.equal(payloads.mappedLargeDelta.mappedAccepted, true);
  assert.equal(payloads.mappedRejectedLargeDelta.preferredSelection, 18);
});

test('buildMappedPositionLogEvents emits mapped trace/warn event batches', () => {
  const mappedLogPayloads = {
    mapped: { id: 'mapped' },
    mappedLargeDelta: { id: 'mappedLargeDelta' },
    mappedRejectedLargeDelta: { id: 'mappedRejectedLargeDelta' }
  };

  const events = buildMappedPositionLogEvents({
    mappedLogPayloads,
    largeDeltaDetected: true,
    rejectMappedSelection: true
  });
  assert.deepEqual(
    events.map((entry) => `${entry.level}:${entry.event}`),
    [
      'trace:block.position.mapped',
      'warn:block.position.mapped.large-delta',
      'warn:block.position.mapped.rejected-large-delta'
    ]
  );
  assert.equal(events[0].payload.id, 'mapped');
  assert.equal(events[2].payload.id, 'mappedRejectedLargeDelta');

  const traceOnlyEvents = buildMappedPositionLogEvents({
    mappedLogPayloads,
    largeDeltaDetected: false,
    rejectMappedSelection: false
  });
  assert.equal(traceOnlyEvents.length, 1);
  assert.equal(traceOnlyEvents[0].event, 'block.position.mapped');
});

test('buildMappedPositionSkippedLogEvents emits mapped skipped trace event batch', () => {
  const mappedLogPayloads = {
    mappedSkipped: { id: 'mappedSkipped' }
  };

  const events = buildMappedPositionSkippedLogEvents({
    mappedLogPayloads
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].level, 'trace');
  assert.equal(events[0].event, 'block.position.mapped.skipped');
  assert.equal(events[0].payload.id, 'mappedSkipped');

  const noEvents = buildMappedPositionSkippedLogEvents();
  assert.deepEqual(noEvents, []);
});

test('resolveMappedSelectionRemapPreflight returns skip logs when remap is disabled or coordinates are missing', () => {
  const missingCoordinates = resolveMappedSelectionRemapPreflight({
    trigger: 'mousedown',
    sourceFrom: 10,
    baseSelection: 12,
    allowCoordinateRemap: true,
    coordinates: null,
    strategy: 'rendered-block',
    blockBounds: { from: 10, to: 20 }
  });
  assert.equal(missingCoordinates.shouldMap, false);
  assert.equal(missingCoordinates.skipReason, 'missing-coordinates');
  assert.equal(missingCoordinates.logs.length, 1);
  assert.equal(missingCoordinates.logs[0].event, 'block.position.mapped.skipped');
  assert.equal(missingCoordinates.logs[0].payload.reason, 'missing-coordinates');

  const disabled = resolveMappedSelectionRemapPreflight({
    trigger: 'mousedown',
    sourceFrom: 10,
    baseSelection: 12,
    allowCoordinateRemap: false,
    coordinates: { x: 30, y: 40 },
    strategy: 'rendered-block',
    blockBounds: { from: 10, to: 20 }
  });
  assert.equal(disabled.shouldMap, false);
  assert.equal(disabled.skipReason, 'disabled-for-strategy');
  assert.equal(disabled.logs.length, 1);
  assert.equal(disabled.logs[0].event, 'block.position.mapped.skipped');
  assert.equal(disabled.logs[0].payload.reason, 'disabled-for-strategy');

  const enabled = resolveMappedSelectionRemapPreflight({
    trigger: 'mousedown',
    sourceFrom: 10,
    baseSelection: 12,
    allowCoordinateRemap: true,
    coordinates: { x: 30, y: 40 },
    strategy: 'rendered-block',
    blockBounds: { from: 10, to: 20 }
  });
  assert.equal(enabled.shouldMap, true);
  assert.equal(enabled.skipReason, null);
  assert.deepEqual(enabled.logs, []);
});

test('resolveMappedSelectionRemap handles doc-end drift and large-delta rejection policy', () => {
  const doc = { id: 'doc' };
  const readLineInfoForPosition = (_doc, position) => (
    Number.isFinite(position)
      ? { lineNumber: position, from: position, to: position + 1 }
      : null
  );
  const resolveSelection = (_docLength, sourceAnchor, preferred, blockBounds = null) => {
    const candidate = Number.isFinite(preferred) ? Math.trunc(preferred) : Math.trunc(sourceAnchor);
    if (!blockBounds) {
      return candidate;
    }
    const max = Math.max(blockBounds.from, blockBounds.to - 1);
    return Math.max(blockBounds.from, Math.min(max, candidate));
  };

  const docEndDrift = resolveMappedSelectionRemap({
    mappedPos: 100,
    docLength: 100,
    blockBounds: null,
    sourceFrom: 10,
    baseSelection: 12,
    baseSelectionLineInfo: { lineNumber: 12 },
    strategy: 'rendered-block',
    preferredSelection: 18,
    resolveLiveBlockSelection: resolveSelection,
    readLineInfoForPosition,
    doc
  });
  assert.equal(docEndDrift.mappedPosLooksLikeDocEndDrift, true);
  assert.equal(docEndDrift.mappedAccepted, false);
  assert.equal(docEndDrift.unboundedPos, 12);
  assert.equal(docEndDrift.resolvedPos, 12);
  assert.equal(docEndDrift.positionDeltaFromBase, 0);
  assert.equal(docEndDrift.largeDeltaDetected, false);
  assert.equal(docEndDrift.rejectMappedSelection, false);

  const rejectedLargeDelta = resolveMappedSelectionRemap({
    mappedPos: 80,
    docLength: 100,
    blockBounds: { from: 10, to: 20 },
    sourceFrom: 10,
    baseSelection: 12,
    baseSelectionLineInfo: { lineNumber: 12 },
    strategy: 'rendered-block',
    preferredSelection: 18,
    largeDeltaPosThreshold: 5,
    largeDeltaLineThreshold: 1,
    resolveLiveBlockSelection: resolveSelection,
    readLineInfoForPosition,
    doc
  });
  assert.equal(rejectedLargeDelta.mappedPosLooksLikeDocEndDrift, false);
  assert.equal(rejectedLargeDelta.mappedAccepted, true);
  assert.equal(rejectedLargeDelta.unboundedPos, 80);
  assert.equal(rejectedLargeDelta.resolvedPos, 19);
  assert.equal(rejectedLargeDelta.clampedByBlock, true);
  assert.equal(rejectedLargeDelta.positionDeltaFromBase, 7);
  assert.equal(rejectedLargeDelta.lineDeltaFromBase, 7);
  assert.equal(rejectedLargeDelta.largeDeltaDetected, true);
  assert.equal(rejectedLargeDelta.rejectMappedSelection, true);
});

test('resolveMappedSelectionUpdate composes remap decisions, logs, and dispatch gating', () => {
  const doc = { id: 'doc' };
  const resolveSelection = (_docLength, sourceAnchor, preferred, blockBounds = null) => {
    const candidate = Number.isFinite(preferred) ? Math.trunc(preferred) : Math.trunc(sourceAnchor);
    if (!blockBounds) {
      return candidate;
    }
    const max = Math.max(blockBounds.from, blockBounds.to - 1);
    return Math.max(blockBounds.from, Math.min(max, candidate));
  };
  const readLineInfoForPosition = (_doc, position) => (
    Number.isFinite(position)
      ? { lineNumber: position, from: position, to: position + 1 }
      : null
  );

  const dispatchUpdate = resolveMappedSelectionUpdate({
    trigger: 'mousedown',
    sourceFrom: 10,
    mappedPos: 14,
    docLength: 100,
    blockBounds: { from: 10, to: 20 },
    baseSelection: 12,
    baseSelectionLineInfo: { lineNumber: 12 },
    strategy: 'rendered-block',
    preferredSelection: 12,
    coordinates: { x: 150, y: 240 },
    resolveLiveBlockSelection: resolveSelection,
    readLineInfoForPosition,
    doc
  });
  assert.equal(dispatchUpdate.remap.rejectMappedSelection, false);
  assert.equal(dispatchUpdate.remap.resolvedPos, 14);
  assert.equal(dispatchUpdate.shouldDispatchSelection, true);
  assert.equal(dispatchUpdate.logs.length, 1);
  assert.equal(dispatchUpdate.logs[0].event, 'block.position.mapped');

  const rejectedUpdate = resolveMappedSelectionUpdate({
    trigger: 'mousedown',
    sourceFrom: 10,
    mappedPos: 80,
    docLength: 100,
    blockBounds: { from: 10, to: 20 },
    baseSelection: 12,
    baseSelectionLineInfo: { lineNumber: 12 },
    strategy: 'rendered-block',
    preferredSelection: 18,
    coordinates: { x: 150, y: 240 },
    largeDeltaPosThreshold: 5,
    largeDeltaLineThreshold: 1,
    resolveLiveBlockSelection: resolveSelection,
    readLineInfoForPosition,
    doc
  });
  assert.equal(rejectedUpdate.remap.rejectMappedSelection, true);
  assert.equal(rejectedUpdate.shouldDispatchSelection, false);
  assert.equal(rejectedUpdate.logs.length, 3);
  assert.equal(rejectedUpdate.logs[0].event, 'block.position.mapped');
  assert.equal(rejectedUpdate.logs[1].event, 'block.position.mapped.large-delta');
  assert.equal(rejectedUpdate.logs[2].event, 'block.position.mapped.rejected-large-delta');
});

test('buildSourceFirstPointerLogPayloads serializes source-first native pointer payloads', () => {
  const payloads = buildSourceFirstPointerLogPayloads({
    trigger: 'mousedown',
    coordinates: { x: 30, y: 45 },
    rawMappedPosition: 18.7,
    mappedPosition: 18,
    lineInfo: { lineNumber: 3 },
    mappedBlock: { from: 10, to: 20 },
    blockLineBounds: { startLineNumber: 2, endLineNumber: 4 },
    targetTagName: 'DIV',
    targetClassName: 'cm-rendered-block',
    docLength: 120
  });

  assert.equal(payloads.pointerMapNative.trigger, 'mousedown');
  assert.equal(payloads.pointerMapNative.x, 30);
  assert.equal(payloads.pointerMapNative.y, 45);
  assert.equal(payloads.pointerMapNative.rawMappedPosition, 18.7);
  assert.equal(payloads.pointerMapNative.blockFrom, 10);
  assert.equal(payloads.pointerMapNative.blockTo, 20);
  assert.equal(payloads.pointerMapNative.targetTagName, 'DIV');
  assert.equal(payloads.pointerMapClamped.docLength, 120);
  assert.equal(payloads.pointerMapClamped.targetTagName, 'DIV');
});

test('buildSourceFirstPointerLogEvents emits native trace and optional clamped warning events', () => {
  const clampedEvents = buildSourceFirstPointerLogEvents({
    trigger: 'mousedown',
    coordinates: { x: 30, y: 45 },
    rawMappedPosition: 18.7,
    mappedPosition: 18,
    lineInfo: { lineNumber: 3 },
    mappedBlock: { from: 10, to: 20 },
    blockLineBounds: { startLineNumber: 2, endLineNumber: 4 },
    targetTagName: 'DIV',
    targetClassName: 'cm-rendered-block',
    docLength: 120,
    clamped: true
  });

  assert.equal(clampedEvents.length, 2);
  assert.equal(clampedEvents[0].level, 'trace');
  assert.equal(clampedEvents[0].event, 'pointer.map.native');
  assert.equal(clampedEvents[1].level, 'warn');
  assert.equal(clampedEvents[1].event, 'pointer.map.clamped');
  assert.equal(clampedEvents[1].payload.docLength, 120);

  const unclampedEvents = buildSourceFirstPointerLogEvents({
    trigger: 'mousedown',
    mappedPosition: 18,
    clamped: false
  });
  assert.equal(unclampedEvents.length, 1);
  assert.equal(unclampedEvents[0].event, 'pointer.map.native');
});

test('emitLiveDebugEvents routes log events by level and ignores invalid entries', () => {
  const calls = [];
  const liveDebug = {
    trace(event, payload) {
      calls.push({ level: 'trace', event, payload });
    },
    warn(event, payload) {
      calls.push({ level: 'warn', event, payload });
    },
    error(event, payload) {
      calls.push({ level: 'error', event, payload });
    },
    info(event, payload) {
      calls.push({ level: 'info', event, payload });
    }
  };

  const emittedCount = emitLiveDebugEvents(liveDebug, [
    { level: 'trace', event: 'trace.event', payload: { id: 1 } },
    { level: 'warn', event: 'warn.event', payload: { id: 2 } },
    { level: 'error', event: 'error.event', payload: { id: 3 } },
    { level: 'info', event: 'info.event', payload: { id: 4 } },
    { level: 'unknown', event: 'fallback.event', payload: { id: 5 } },
    { level: 'trace', event: '', payload: { ignored: true } },
    null
  ]);

  assert.equal(emittedCount, 5);
  assert.equal(calls.length, 5);
  assert.equal(calls[0].level, 'trace');
  assert.equal(calls[1].level, 'warn');
  assert.equal(calls[2].level, 'error');
  assert.equal(calls[3].level, 'info');
  assert.equal(calls[4].level, 'trace');
  assert.equal(calls[4].event, 'fallback.event');
});

test('buildPointerInputSignalPayload serializes pointer signal payload fields', () => {
  const payload = buildPointerInputSignalPayload({
    trigger: 'mousedown',
    coordinates: { x: 12, y: 24 },
    targetSummary: {
      tagName: 'DIV',
      className: 'cm-rendered-block',
      sourceFrom: 10
    }
  });

  assert.equal(payload.trigger, 'mousedown');
  assert.equal(payload.x, 12);
  assert.equal(payload.y, 24);
  assert.equal(payload.targetTag, 'DIV');
  assert.equal(payload.targetClassName, 'cm-rendered-block');
  assert.equal(payload.sourceFrom, 10);
});

test('buildPointerInputTraceEvent serializes input.pointer event payload', () => {
  const traceEvent = buildPointerInputTraceEvent({
    pointerSignal: {
      trigger: 'mousedown',
      x: 12,
      y: 24,
      kind: 'pointer'
    },
    targetSummary: {
      tagName: 'DIV',
      className: 'cm-rendered-block'
    }
  });

  assert.equal(traceEvent.event, 'input.pointer');
  assert.equal(traceEvent.payload.kind, 'pointer');
  assert.equal(traceEvent.payload.x, 12);
  assert.deepEqual(traceEvent.payload.target, {
    tagName: 'DIV',
    className: 'cm-rendered-block'
  });
});

test('resolvePointerInputSignalEvents records pointer signal and returns input trace log batch', () => {
  const recordedSignals = [];
  const result = resolvePointerInputSignalEvents({
    trigger: 'mousedown',
    coordinates: { x: 12, y: 24 },
    targetSummary: {
      tagName: 'DIV',
      className: 'cm-rendered-block',
      sourceFrom: 10
    },
    recordInputSignal: (kind, payload) => {
      recordedSignals.push({ kind, payload });
      return {
        ...payload,
        kind,
        signalId: 'sig-1'
      };
    }
  });

  assert.equal(recordedSignals.length, 1);
  assert.equal(recordedSignals[0].kind, 'pointer');
  assert.equal(recordedSignals[0].payload.x, 12);
  assert.equal(result.pointerSignal.signalId, 'sig-1');
  assert.equal(result.logs.length, 1);
  assert.equal(result.logs[0].event, 'input.pointer');
  assert.equal(result.logs[0].level, 'trace');
  assert.equal(result.logs[0].payload.signalId, 'sig-1');
  assert.equal(result.logs[0].payload.target.tagName, 'DIV');
});

test('resolvePointerActivationPreflight handles inactive view and missing target gating', () => {
  const inactive = resolvePointerActivationPreflight({
    viewMode: 'preview',
    targetElement: null,
    sourceFirstMode: false,
    trigger: 'mousedown'
  });
  assert.equal(inactive.proceed, false);
  assert.equal(inactive.mode, 'inactive');
  assert.deepEqual(inactive.logs, []);

  const miss = resolvePointerActivationPreflight({
    viewMode: 'live',
    targetElement: null,
    sourceFirstMode: false,
    trigger: 'mousedown'
  });
  assert.equal(miss.proceed, false);
  assert.equal(miss.mode, 'miss');
  assert.equal(miss.logs.length, 1);
  assert.equal(miss.logs[0].event, 'block.activate.miss');
  assert.equal(miss.logs[0].payload.reason, 'no-element-target');
});

test('resolvePointerActivationPreflight handles source-first and non-rendered pass-through gating', () => {
  const target = {
    tagName: 'P',
    className: 'para',
    closest() {
      return null;
    }
  };

  const sourceFirst = resolvePointerActivationPreflight({
    viewMode: 'live',
    targetElement: target,
    sourceFirstMode: true,
    trigger: 'mousedown'
  });
  assert.equal(sourceFirst.proceed, true);
  assert.equal(sourceFirst.mode, 'source-first');

  const passThrough = resolvePointerActivationPreflight({
    viewMode: 'live',
    targetElement: target,
    sourceFirstMode: false,
    trigger: 'mousedown'
  });
  assert.equal(passThrough.proceed, false);
  assert.equal(passThrough.mode, 'pass-through-native');
  assert.equal(passThrough.logs.length, 1);
  assert.equal(passThrough.logs[0].event, 'block.activate.pass-through-native');
  assert.equal(passThrough.logs[0].payload.reason, 'not-rendered-block-target');
});

test('resolvePointerActivationPreflight returns rendered mode when rendered block target exists', () => {
  const rendered = { id: 'rendered' };
  const target = {
    closest(selector) {
      if (selector === '.cm-rendered-block') {
        return rendered;
      }
      return null;
    }
  };

  const result = resolvePointerActivationPreflight({
    viewMode: 'live',
    targetElement: target,
    sourceFirstMode: false,
    trigger: 'mousedown'
  });

  assert.equal(result.proceed, true);
  assert.equal(result.mode, 'rendered');
  assert.equal(result.renderedBlockTarget, rendered);
  assert.deepEqual(result.logs, []);
});

test('resolvePointerActivationIntent composes pointer input, preflight, and source-first activation logs', () => {
  const recordedSignals = [];
  const sourceFirstTarget = {
    tagName: 'DIV',
    className: 'cm-rendered-block',
    closest() {
      return null;
    }
  };
  const intent = resolvePointerActivationIntent({
    viewMode: 'live',
    trigger: 'mousedown',
    targetElement: sourceFirstTarget,
    coordinates: { x: 30, y: 45 },
    targetSummary: {
      tagName: 'DIV',
      className: 'cm-rendered-block',
      sourceFrom: 10
    },
    sourceFirstMode: true,
    recordInputSignal: (kind, payload) => {
      recordedSignals.push({ kind, payload });
      return {
        ...payload,
        kind,
        signalId: 'sig-1'
      };
    },
    resolvePointerPosition: () => 24.8,
    view: {
      state: {
        doc: { length: 20 }
      }
    },
    liveBlocksForView: () => [{ from: 10, to: 15 }],
    readLineInfoForPosition: (_doc, position) => ({ lineNumber: position + 1 }),
    resolveActivationBlockBounds: () => ({ from: 10, to: 15 }),
    readBlockLineBoundsForLog: () => ({ startLineNumber: 2, endLineNumber: 4 })
  });

  assert.equal(intent.proceed, false);
  assert.equal(intent.mode, 'source-first');
  assert.equal(intent.pointerSignal.signalId, 'sig-1');
  assert.ok(intent.sourceFirstActivation);
  assert.equal(intent.sourceFirstActivation.mappedPosition, 20);
  assert.equal(intent.logs[0].event, 'input.pointer');
  assert.equal(intent.logs.some((entry) => entry.event === 'pointer.map.native'), true);
  assert.equal(intent.logs.some((entry) => entry.event === 'pointer.map.clamped'), true);
  assert.equal(recordedSignals.length, 1);
});

test('resolvePointerActivationIntent returns rendered intent and pass-through intent by preflight mode', () => {
  const renderedBlock = {
    id: 'rendered-block'
  };
  const renderedTarget = {
    tagName: 'DIV',
    className: 'cm-rendered-block',
    closest(selector) {
      if (selector === '.cm-rendered-block') {
        return renderedBlock;
      }
      return null;
    }
  };
  const renderedIntent = resolvePointerActivationIntent({
    viewMode: 'live',
    trigger: 'mousedown',
    targetElement: renderedTarget,
    coordinates: { x: 30, y: 45 },
    targetSummary: {
      tagName: 'DIV',
      className: 'cm-rendered-block'
    },
    sourceFirstMode: false
  });
  assert.equal(renderedIntent.proceed, true);
  assert.equal(renderedIntent.mode, 'rendered');
  assert.equal(renderedIntent.renderedBlockTarget, renderedBlock);
  assert.equal(renderedIntent.logs.length, 1);
  assert.equal(renderedIntent.logs[0].event, 'input.pointer');

  const passThroughIntent = resolvePointerActivationIntent({
    viewMode: 'live',
    trigger: 'mousedown',
    targetElement: {
      tagName: 'P',
      className: 'para',
      closest() {
        return null;
      }
    },
    coordinates: { x: 30, y: 45 },
    targetSummary: {
      tagName: 'P',
      className: 'para'
    },
    sourceFirstMode: false
  });
  assert.equal(passThroughIntent.proceed, false);
  assert.equal(passThroughIntent.mode, 'pass-through-native');
  assert.equal(passThroughIntent.logs.length, 2);
  assert.equal(passThroughIntent.logs[0].event, 'input.pointer');
  assert.equal(passThroughIntent.logs[1].event, 'block.activate.pass-through-native');
});

test('resolveRenderedPointerActivation returns null activation and skip log for invalid rendered source marker', () => {
  const renderedBlock = {
    getAttribute() {
      return 'invalid';
    }
  };
  const targetElement = {
    closest(selector) {
      if (selector === '.cm-rendered-block') {
        return renderedBlock;
      }
      return null;
    }
  };

  const result = resolveRenderedPointerActivation({
    view: {
      state: {
        doc: { length: 40 }
      }
    },
    targetElement,
    trigger: 'mousedown',
    renderedBlockTarget: renderedBlock,
    parseSourceFromAttribute: () => null,
    liveBlocksForView: () => [],
    liveSourceMapIndexForView: () => [],
    readSourceMapIndexForViewFn: () => []
  });

  assert.equal(result.activation, null);
  assert.equal(result.renderedTarget.renderedBlock, renderedBlock);
  assert.equal(result.renderedContext, null);
  assert.equal(result.logs.length, 1);
  assert.equal(result.logs[0].event, 'block.activate.skipped');
  assert.equal(result.logs[0].payload.reason, 'invalid-source-from');
});

test('resolveRenderedPointerActivation composes rendered target/context activation and log batches', () => {
  const renderedBlock = {
    getAttribute(name) {
      if (name === 'data-source-from') {
        return '10';
      }
      if (name === 'data-source-to') {
        return '20';
      }
      if (name === 'data-fragment-from') {
        return '12';
      }
      if (name === 'data-fragment-to') {
        return '16';
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
  const view = {
    state: {
      doc: {
        length: 40
      }
    }
  };
  const sourceMapIndex = [
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
  ];

  const result = resolveRenderedPointerActivation({
    view,
    targetElement,
    coordinates: { x: 30, y: 40 },
    trigger: 'mousedown',
    renderedBlockTarget: renderedBlock,
    parseSourceFromAttribute: (value) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    },
    liveBlocksForView: () => [],
    liveSourceMapIndexForView: () => sourceMapIndex,
    resolvePointerPosition: (_view, element, coordinates) => {
      if (element === renderedBlock) {
        return coordinates ? 18 : 13;
      }
      if (element === targetElement) {
        return 12;
      }
      return null;
    },
    findRenderedSourceRangeTarget: () => null,
    resolvePositionFromRenderedSourceRange: () => null,
    resolveActivationBlockBounds: () => null,
    resolveLiveBlockSelection,
    distanceToBlockBounds,
    shouldPreferRenderedDomAnchorPosition,
    findBlockContainingPosition: () => null,
    findNearestBlockForPosition: () => null,
    readBlockLineBoundsForLog: (_doc, blockBounds) => (
      blockBounds ? { startLineNumber: 1, endLineNumber: 1 } : null
    ),
    readLineInfoForPosition: (_doc, position) => (
      Number.isFinite(position) ? { lineNumber: 2 } : null
    ),
    isFencedCodeBlock: () => false,
    buildRenderedPointerProbe: () => ({
      pointer: {
        pointerDistanceToBlockBottom: 3,
        pointerRatioY: 0.7
      },
      verticalScanCoordSamples: [],
      edgeCoordSamples: []
    }),
    summarizeLineNumbersForCoordSamples: () => [],
    shouldPreferSourceFromForRenderedFencedClick,
    shouldPreferSourceFromForRenderedBoundaryClick,
    normalizeLogString: (value) => String(value)
  });

  assert.ok(result.activation);
  assert.equal(result.activation.sourceFrom, 10);
  assert.equal(result.activation.sourcePosOrigin, 'source-map-fragment');
  assert.equal(result.activation.sourcePos, 15);
  assert.equal(result.activation.allowCoordinateRemap, false);
  assert.equal(result.renderedTarget.sourceFrom, 10);
  assert.ok(result.renderedContext);
  assert.equal(
    result.logs.some((entry) => entry.event === 'block.activate.rendered-pointer-probe'),
    true
  );
});

test('resolveRenderedActivationTarget resolves rendered attributes and logs invalid source markers', () => {
  const renderedBlock = {
    getAttribute(name) {
      if (name === 'data-source-from') {
        return '10';
      }
      if (name === 'data-source-to') {
        return '20';
      }
      if (name === 'data-fragment-from') {
        return '12';
      }
      if (name === 'data-fragment-to') {
        return '18';
      }
      return null;
    }
  };
  const targetElement = {
    closest(selector) {
      if (selector === '.cm-rendered-block') {
        return renderedBlock;
      }
      return null;
    }
  };
  const parseSourceFromAttribute = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const resolved = resolveRenderedActivationTarget({
    targetElement,
    parseSourceFromAttribute,
    trigger: 'mousedown'
  });
  assert.equal(resolved.renderedBlock, renderedBlock);
  assert.equal(resolved.sourceFrom, 10);
  assert.equal(resolved.sourceTo, 20);
  assert.equal(resolved.fragmentFrom, 12);
  assert.equal(resolved.fragmentTo, 18);
  assert.deepEqual(resolved.logs, []);

  const invalid = resolveRenderedActivationTarget({
    targetElement: {
      closest() {
        return {
          getAttribute() {
            return 'invalid';
          }
        };
      }
    },
    parseSourceFromAttribute,
    trigger: 'mousedown'
  });
  assert.equal(invalid.sourceFrom, null);
  assert.equal(invalid.logs.length, 1);
  assert.equal(invalid.logs[0].event, 'block.activate.skipped');
  assert.equal(invalid.logs[0].payload.reason, 'invalid-source-from');

  const missing = resolveRenderedActivationTarget({
    targetElement: {
      closest() {
        return null;
      }
    },
    parseSourceFromAttribute,
    trigger: 'mousedown'
  });
  assert.equal(missing.renderedBlock, null);
  assert.deepEqual(missing.logs, []);
});

test('resolveSourceFirstPointerMapping clamps mapped position and resolves line/block context', () => {
  let receivedBlockLookup = null;
  const mapping = resolveSourceFirstPointerMapping({
    docLength: 20,
    rawMappedPosition: 24.8,
    doc: { id: 'doc' },
    blocks: [{ from: 10, to: 15 }],
    readLineInfoForPosition: (_doc, position) => ({ lineNumber: position + 1 }),
    resolveActivationBlockBounds: (_blocks, from, to) => {
      receivedBlockLookup = { from, to };
      return { from: 10, to: 15 };
    }
  });

  assert.equal(mapping.mappedPosition, 20);
  assert.equal(mapping.clamped, true);
  assert.deepEqual(mapping.lineInfo, { lineNumber: 21 });
  assert.deepEqual(mapping.mappedBlock, { from: 10, to: 15 });
  assert.deepEqual(receivedBlockLookup, { from: 20, to: 20 });
});

test('resolveSourceFirstPointerActivation returns mapping context and source-first log events', () => {
  const activation = resolveSourceFirstPointerActivation({
    trigger: 'mousedown',
    coordinates: { x: 30, y: 45 },
    rawMappedPosition: 24.8,
    docLength: 20,
    doc: { id: 'doc' },
    blocks: [{ from: 10, to: 15 }],
    targetTagName: 'DIV',
    targetClassName: 'cm-rendered-block',
    readLineInfoForPosition: (_doc, position) => ({ lineNumber: position + 1 }),
    resolveActivationBlockBounds: () => ({ from: 10, to: 15 }),
    readBlockLineBoundsForLog: () => ({ startLineNumber: 2, endLineNumber: 4 })
  });

  assert.equal(activation.mappedPosition, 20);
  assert.equal(activation.clamped, true);
  assert.deepEqual(activation.lineInfo, { lineNumber: 21 });
  assert.deepEqual(activation.mappedBlock, { from: 10, to: 15 });
  assert.deepEqual(activation.blockLineBounds, { startLineNumber: 2, endLineNumber: 4 });
  assert.equal(activation.logs.length, 2);
  assert.equal(activation.logs[0].event, 'pointer.map.native');
  assert.equal(activation.logs[1].event, 'pointer.map.clamped');
});

test('buildPointerActivationLogPayloads serializes activation miss/pass-through/request/failed payloads', () => {
  const activation = {
    sourceFrom: 10,
    sourcePos: 12,
    rawSourcePos: 11,
    sourcePosOrigin: 'source-map-fragment',
    strategy: 'rendered-block',
    match: { block: 'b-1' },
    allowCoordinateRemap: false,
    blockBounds: { from: 10, to: 20 },
    pointerProbe: { pointer: { pointerRatioY: 0.8 } }
  };

  const payloads = buildPointerActivationLogPayloads({
    trigger: 'mousedown',
    reason: 'not-rendered-block-target',
    targetTagName: 'P',
    targetClassName: 'para',
    activation,
    coordinates: { x: 200, y: 140 },
    message: 'dispatch failed'
  });

  assert.equal(payloads.activationMiss.reason, 'not-rendered-block-target');
  assert.equal(payloads.passThroughNative.tagName, 'P');
  assert.equal(payloads.passThroughNative.className, 'para');
  assert.equal(payloads.activationRequest.sourceFrom, 10);
  assert.equal(payloads.activationRequest.allowCoordinateRemap, false);
  assert.equal(payloads.activationRequest.blockTo, 20);
  assert.equal(payloads.activationRequest.x, 200);
  assert.equal(payloads.activationRequest.y, 140);
  assert.equal(payloads.activationFailed.message, 'dispatch failed');
  assert.equal(payloads.activationFailed.sourcePos, 12);
});

test('buildPointerActivationEvents serializes request and failed event batches', () => {
  const activation = {
    sourceFrom: 10,
    sourcePos: 12,
    rawSourcePos: 11,
    sourcePosOrigin: 'source-map-fragment',
    strategy: 'rendered-block',
    match: { block: 'b-1' },
    allowCoordinateRemap: false,
    blockBounds: { from: 10, to: 20 }
  };

  const events = buildPointerActivationEvents({
    trigger: 'mousedown',
    activation,
    coordinates: { x: 200, y: 140 },
    message: 'dispatch failed'
  });

  assert.equal(events.request.length, 1);
  assert.equal(events.request[0].level, 'trace');
  assert.equal(events.request[0].event, 'block.activate.request');
  assert.equal(events.request[0].payload.sourceFrom, 10);
  assert.equal(events.request[0].payload.x, 200);
  assert.equal(events.failed.length, 1);
  assert.equal(events.failed[0].level, 'error');
  assert.equal(events.failed[0].event, 'block.activate.failed');
  assert.equal(events.failed[0].payload.message, 'dispatch failed');
});

test('resolvePointerActivationDispatch composes request and failed logs with activation execution', () => {
  const activation = {
    sourceFrom: 10,
    sourcePos: 12,
    rawSourcePos: 11,
    sourcePosOrigin: 'source-map-fragment',
    strategy: 'rendered-block',
    match: { block: 'b-1' },
    allowCoordinateRemap: false,
    blockBounds: { from: 10, to: 20 }
  };

  const noActivation = resolvePointerActivationDispatch({
    trigger: 'mousedown',
    activation: null,
    coordinates: { x: 200, y: 140 },
    beforeActivate: () => {
      throw new Error('should not execute');
    },
    activate: () => {
      throw new Error('should not execute');
    }
  });
  assert.equal(noActivation.handled, false);
  assert.equal(noActivation.shouldPreventDefault, false);
  assert.deepEqual(noActivation.logs, []);

  let beforeActivateCount = 0;
  let activateCount = 0;
  const success = resolvePointerActivationDispatch({
    trigger: 'mousedown',
    activation,
    coordinates: { x: 200, y: 140 },
    beforeActivate: () => {
      beforeActivateCount += 1;
    },
    activate: () => {
      activateCount += 1;
    }
  });
  assert.equal(success.handled, true);
  assert.equal(success.shouldPreventDefault, true);
  assert.equal(beforeActivateCount, 1);
  assert.equal(activateCount, 1);
  assert.equal(success.logs.length, 1);
  assert.equal(success.logs[0].event, 'block.activate.request');

  let failedBeforeActivateCount = 0;
  const failed = resolvePointerActivationDispatch({
    trigger: 'mousedown',
    activation,
    coordinates: { x: 200, y: 140 },
    beforeActivate: () => {
      failedBeforeActivateCount += 1;
    },
    activate: () => {
      throw new Error('dispatch failed');
    }
  });
  assert.equal(failed.handled, false);
  assert.equal(failed.shouldPreventDefault, true);
  assert.equal(failedBeforeActivateCount, 1);
  assert.equal(failed.logs.length, 2);
  assert.equal(failed.logs[0].event, 'block.activate.request');
  assert.equal(failed.logs[1].event, 'block.activate.failed');
  assert.equal(failed.logs[1].payload.message, 'dispatch failed');
});

test('resolveBlockActivationSelectionContext resolves base selection and line info deterministically', () => {
  const doc = {
    length: 40
  };
  const context = resolveBlockActivationSelectionContext({
    doc,
    sourceFrom: 10,
    preferredSelection: 12,
    blockBounds: { from: 10, to: 15 },
    resolveLiveBlockSelection: (_docLength, _sourceFrom, preferred, blockBounds = null) => {
      const candidate = Number.isFinite(preferred) ? Math.trunc(preferred) : 10;
      if (!blockBounds) {
        return candidate;
      }
      const max = Math.max(blockBounds.from, blockBounds.to - 1);
      return Math.max(blockBounds.from, Math.min(max, candidate));
    },
    readLineInfoForPosition: (_doc, position) => ({ lineNumber: position + 1 })
  });
  assert.equal(context.docLength, 40);
  assert.equal(context.preferredPos, 12);
  assert.equal(context.baseSelection, 12);
  assert.deepEqual(context.baseSelectionLineInfo, { lineNumber: 13 });

  const fallback = resolveBlockActivationSelectionContext({
    doc,
    sourceFrom: 10,
    preferredSelection: null,
    resolveLiveBlockSelection: null,
    readLineInfoForPosition: null
  });
  assert.equal(fallback.preferredPos, 10);
  assert.equal(fallback.baseSelection, 10);
  assert.equal(fallback.baseSelectionLineInfo, null);
});

test('resolveBlockActivationDispatch composes activated and dispatch-failed event batches', () => {
  let dispatchCalls = 0;
  const success = resolveBlockActivationDispatch({
    trigger: 'mousedown',
    sourceFrom: 10,
    baseSelection: 12,
    preferredSelection: 15,
    baseSelectionLineInfo: { lineNumber: 3 },
    allowCoordinateRemap: false,
    strategy: 'rendered-block',
    blockBounds: { from: 10, to: 20 },
    dispatchActivate: () => {
      dispatchCalls += 1;
    }
  });
  assert.equal(success.handled, true);
  assert.equal(dispatchCalls, 1);
  assert.equal(success.logs.length, 1);
  assert.equal(success.logs[0].event, 'block.activated');
  assert.equal(success.logs[0].payload.selection, 12);
  assert.equal(success.logs[0].payload.preferredSelection, 15);
  assert.equal(success.logs[0].payload.allowCoordinateRemap, false);

  const failed = resolveBlockActivationDispatch({
    trigger: 'mousedown',
    sourceFrom: 10,
    baseSelection: 12,
    dispatchActivate: () => {
      throw new Error('dispatch failed');
    }
  });
  assert.equal(failed.handled, false);
  assert.equal(failed.logs.length, 1);
  assert.equal(failed.logs[0].event, 'block.activate.dispatch-failed');
  assert.equal(failed.logs[0].payload.message, 'dispatch failed');

  const missingDispatch = resolveBlockActivationDispatch({
    trigger: 'mousedown',
    sourceFrom: 10,
    baseSelection: 12
  });
  assert.equal(missingDispatch.handled, false);
  assert.equal(missingDispatch.logs.length, 0);
  assert.ok(missingDispatch.error instanceof TypeError);
});

test('buildBlockActivationDispatchLogPayloads serializes dispatch-failed and activated payloads', () => {
  const payloads = buildBlockActivationDispatchLogPayloads({
    trigger: 'mousedown',
    sourceFrom: 10,
    baseSelection: 12,
    preferredSelection: 15,
    baseSelectionLineInfo: { lineNumber: 3 },
    allowCoordinateRemap: false,
    strategy: 'rendered-block',
    blockBounds: { from: 10, to: 20 },
    message: 'dispatch failed'
  });

  assert.equal(payloads.dispatchFailed.selection, 12);
  assert.equal(payloads.dispatchFailed.message, 'dispatch failed');
  assert.equal(payloads.activated.selection, 12);
  assert.equal(payloads.activated.preferredSelection, 15);
  assert.equal(payloads.activated.allowCoordinateRemap, false);
  assert.equal(payloads.activated.strategy, 'rendered-block');
  assert.equal(payloads.activated.blockFrom, 10);
  assert.equal(payloads.activated.blockTo, 20);
});

test('buildBlockActivationDispatchEvents emits dispatch-failed and activated batches', () => {
  const dispatchLogPayloads = {
    dispatchFailed: { id: 'dispatchFailed' },
    activated: { id: 'activated' }
  };

  const events = buildBlockActivationDispatchEvents({
    dispatchLogPayloads
  });
  assert.equal(events.dispatchFailed.length, 1);
  assert.equal(events.dispatchFailed[0].level, 'error');
  assert.equal(events.dispatchFailed[0].event, 'block.activate.dispatch-failed');
  assert.equal(events.dispatchFailed[0].payload.id, 'dispatchFailed');
  assert.equal(events.activated.length, 1);
  assert.equal(events.activated[0].level, 'trace');
  assert.equal(events.activated[0].event, 'block.activated');
  assert.equal(events.activated[0].payload.id, 'activated');

  const emptyEvents = buildBlockActivationDispatchEvents();
  assert.deepEqual(emptyEvents.dispatchFailed, []);
  assert.deepEqual(emptyEvents.activated, []);
});
