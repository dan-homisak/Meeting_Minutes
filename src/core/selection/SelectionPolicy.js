import { findSourceMapEntriesAtPosition } from '../mapping/SourceMapIndex.js';

export function readSourceMapIndexForView(liveSourceMapIndexForView, view) {
  if (typeof liveSourceMapIndexForView !== 'function') {
    return [];
  }

  const sourceMapIndex = liveSourceMapIndexForView(view);
  return Array.isArray(sourceMapIndex) ? sourceMapIndex : [];
}

export function normalizeSelectionBounds(from, to) {
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return null;
  }

  const rangeFrom = Math.max(0, Math.trunc(from));
  const rangeTo = Math.max(rangeFrom, Math.trunc(to));
  if (rangeTo <= rangeFrom) {
    return null;
  }

  return {
    from: rangeFrom,
    to: rangeTo
  };
}

export function findSourceMapContext(
  sourceMapIndex,
  sourceFrom,
  sourceTo,
  fragmentFrom,
  fragmentTo
) {
  if (!Array.isArray(sourceMapIndex) || sourceMapIndex.length === 0) {
    return {
      blockBounds: null,
      fragmentBounds: null,
      match: null
    };
  }

  let blockEntry = null;
  if (Number.isFinite(sourceFrom)) {
    blockEntry = sourceMapIndex.find((entry) =>
      entry?.kind === 'block' &&
      entry.sourceFrom === sourceFrom &&
      (!Number.isFinite(sourceTo) || entry.sourceTo === sourceTo)
    ) ?? null;
    if (!blockEntry) {
      blockEntry = sourceMapIndex.find((entry) =>
        entry?.kind === 'block' &&
        Number.isFinite(entry.sourceFrom) &&
        Number.isFinite(entry.sourceTo) &&
        sourceFrom >= entry.sourceFrom &&
        sourceFrom < entry.sourceTo
      ) ?? null;
    }
  }

  let fragmentEntry = null;
  if (Number.isFinite(fragmentFrom) && Number.isFinite(fragmentTo)) {
    fragmentEntry = sourceMapIndex.find((entry) =>
      entry?.kind === 'rendered-fragment' &&
      entry.fragmentFrom === fragmentFrom &&
      entry.fragmentTo === fragmentTo &&
      (
        !blockEntry ||
        (entry.blockFrom === blockEntry.blockFrom && entry.blockTo === blockEntry.blockTo)
      )
    ) ?? null;
  }

  if (!fragmentEntry && blockEntry) {
    fragmentEntry = sourceMapIndex.find((entry) =>
      entry?.kind === 'rendered-fragment' &&
      entry.blockFrom === blockEntry.blockFrom &&
      entry.blockTo === blockEntry.blockTo
    ) ?? null;
  }

  const blockBounds = blockEntry
    ? normalizeSelectionBounds(blockEntry.blockFrom, blockEntry.blockTo)
    : null;
  const fragmentBounds = fragmentEntry
    ? normalizeSelectionBounds(fragmentEntry.fragmentFrom, fragmentEntry.fragmentTo)
    : null;
  const match = blockEntry || fragmentEntry
    ? {
      block: blockEntry?.id ?? null,
      fragment: fragmentEntry?.id ?? null
    }
    : null;

  return {
    blockBounds,
    fragmentBounds,
    match
  };
}

export function findSourceMapBlockBoundsForPosition(sourceMapIndex, position) {
  if (!Array.isArray(sourceMapIndex) || !Number.isFinite(position)) {
    return null;
  }

  const matches = findSourceMapEntriesAtPosition(sourceMapIndex, position);
  const blockMatch = matches.find(
    (entry) =>
      entry?.kind === 'block' &&
      Number.isFinite(entry.blockFrom) &&
      Number.isFinite(entry.blockTo)
  ) ?? null;
  const fallbackMatch = blockMatch ?? matches.find(
    (entry) => Number.isFinite(entry?.blockFrom) && Number.isFinite(entry?.blockTo)
  ) ?? null;
  if (!fallbackMatch) {
    return null;
  }

  return normalizeSelectionBounds(fallbackMatch.blockFrom, fallbackMatch.blockTo);
}

export function findSourceMapBlockAtPosition(sourceMapIndex, position, nearestTolerance = 1) {
  if (!Array.isArray(sourceMapIndex) || !Number.isFinite(position)) {
    return null;
  }

  const lookupPositions = [];
  const truncated = Math.max(0, Math.trunc(position));
  lookupPositions.push(truncated);
  if (truncated > 0) {
    lookupPositions.push(truncated - 1);
  }

  for (const lookupPosition of lookupPositions) {
    const entries = findSourceMapEntriesAtPosition(sourceMapIndex, lookupPosition);
    const blockEntry = entries.find((entry) => entry?.kind === 'block');
    if (blockEntry) {
      return blockEntry;
    }
  }

  let nearest = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const entry of sourceMapIndex) {
    if (
      !entry ||
      entry.kind !== 'block' ||
      !Number.isFinite(entry.sourceFrom) ||
      !Number.isFinite(entry.sourceTo)
    ) {
      continue;
    }

    const distanceToStart = Math.abs(truncated - entry.sourceFrom);
    const distanceToEnd = Math.abs(truncated - entry.sourceTo);
    const distance = Math.min(distanceToStart, distanceToEnd);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = entry;
    }
  }

  const normalizedTolerance = Number.isFinite(nearestTolerance)
    ? Math.max(0, Math.trunc(nearestTolerance))
    : 1;
  if (nearest && nearestDistance <= normalizedTolerance) {
    return nearest;
  }

  return null;
}

export function clampCursorPositionToSourceMapBlock(position, blockEntry) {
  if (
    !Number.isFinite(position) ||
    !blockEntry ||
    !Number.isFinite(blockEntry.sourceFrom) ||
    !Number.isFinite(blockEntry.sourceTo)
  ) {
    return {
      position,
      clamped: false
    };
  }

  const min = Math.max(0, Math.trunc(blockEntry.sourceFrom));
  const max = Math.max(min, Math.trunc(blockEntry.sourceTo));
  const clampedPosition = Math.max(min, Math.min(max, Math.trunc(position)));
  return {
    position: clampedPosition,
    clamped: clampedPosition !== position
  };
}

export function resolveVerticalCursorMoveContext({
  doc = null,
  selection = null,
  direction = 0,
  sourceMapIndex = null,
  findSourceMapBlockAtPositionFn = findSourceMapBlockAtPosition,
  clampCursorPositionToSourceMapBlockFn = clampCursorPositionToSourceMapBlock
} = {}) {
  if (!doc || !selection || !Number.isInteger(direction) || direction === 0) {
    return {
      status: 'invalid'
    };
  }

  if (!selection.empty) {
    return {
      status: 'non-empty-selection',
      anchor: selection.anchor,
      head: selection.head
    };
  }

  if (typeof doc.lineAt !== 'function' || typeof doc.line !== 'function') {
    return {
      status: 'invalid'
    };
  }

  const currentLine = doc.lineAt(selection.head);
  const targetLineNumber = currentLine.number + direction;
  if (targetLineNumber < 1 || targetLineNumber > doc.lines) {
    return {
      status: 'boundary',
      direction,
      from: selection.head,
      fromLine: currentLine.number
    };
  }

  const targetLine = doc.line(targetLineNumber);
  const currentColumn = Math.max(0, selection.head - currentLine.from);
  const rawTargetPos = Math.min(targetLine.to, targetLine.from + currentColumn);
  const sourceMapTargetBlock = typeof findSourceMapBlockAtPositionFn === 'function'
    ? findSourceMapBlockAtPositionFn(
        Array.isArray(sourceMapIndex) ? sourceMapIndex : [],
        rawTargetPos
      )
    : null;
  const sourceMapClamp = typeof clampCursorPositionToSourceMapBlockFn === 'function'
    ? clampCursorPositionToSourceMapBlockFn(rawTargetPos, sourceMapTargetBlock)
    : {
      position: rawTargetPos,
      clamped: false
    };
  const targetPos = Number.isFinite(sourceMapClamp?.position)
    ? sourceMapClamp.position
    : rawTargetPos;
  const currentLineLength = Math.max(0, currentLine.to - currentLine.from);
  const targetLineLength = Math.max(0, targetLine.to - targetLine.from);
  const primaryAssoc = direction > 0 ? -1 : 1;
  const secondaryAssoc = -primaryAssoc;

  return {
    status: 'target',
    direction,
    from: selection.head,
    to: targetPos,
    fromLine: currentLine.number,
    toLine: targetLine.number,
    currentColumn,
    currentLine,
    targetLine,
    currentLineLength,
    targetLineLength,
    rawTargetPos,
    sourceMapTargetBlock,
    sourceMapClamp,
    primaryAssoc,
    secondaryAssoc
  };
}

export function buildVerticalCursorMoveLogPayloads({
  trigger = null,
  moveContext = null,
  reason = null,
  targetLineTextPreview = null,
  targetPos = null,
  lineNumber = null,
  lineLength = null,
  previousAssoc = null,
  nextAssoc = null,
  cursorState = null
} = {}) {
  return {
    skipped: {
      trigger,
      reason,
      anchor: Number.isFinite(moveContext?.anchor) ? moveContext.anchor : null,
      head: Number.isFinite(moveContext?.head) ? moveContext.head : null
    },
    boundary: {
      trigger,
      direction: Number.isFinite(moveContext?.direction) ? moveContext.direction : null,
      from: Number.isFinite(moveContext?.from) ? moveContext.from : null,
      fromLine: Number.isFinite(moveContext?.fromLine) ? moveContext.fromLine : null
    },
    moved: {
      trigger,
      direction: Number.isFinite(moveContext?.direction) ? moveContext.direction : null,
      from: Number.isFinite(moveContext?.from) ? moveContext.from : null,
      to: Number.isFinite(moveContext?.to) ? moveContext.to : null,
      fromLine: Number.isFinite(moveContext?.fromLine) ? moveContext.fromLine : null,
      toLine: Number.isFinite(moveContext?.toLine) ? moveContext.toLine : null,
      column: Number.isFinite(moveContext?.currentColumn) ? moveContext.currentColumn : null,
      currentLineLength: Number.isFinite(moveContext?.currentLineLength)
        ? moveContext.currentLineLength
        : null,
      targetLineLength: Number.isFinite(moveContext?.targetLineLength)
        ? moveContext.targetLineLength
        : null,
      targetLineTextPreview: targetLineTextPreview ?? null,
      rawTargetPos: Number.isFinite(moveContext?.rawTargetPos) ? moveContext.rawTargetPos : null,
      sourceMapTargetBlockId: moveContext?.sourceMapTargetBlock?.id ?? null,
      sourceMapTargetFrom: Number.isFinite(moveContext?.sourceMapTargetBlock?.sourceFrom)
        ? moveContext.sourceMapTargetBlock.sourceFrom
        : null,
      sourceMapTargetTo: Number.isFinite(moveContext?.sourceMapTargetBlock?.sourceTo)
        ? moveContext.sourceMapTargetBlock.sourceTo
        : null,
      sourceMapClamped: Boolean(moveContext?.sourceMapClamp?.clamped),
      assoc: Number.isFinite(moveContext?.primaryAssoc) ? moveContext.primaryAssoc : null
    },
    sourceMapClamped: {
      trigger,
      direction: Number.isFinite(moveContext?.direction) ? moveContext.direction : null,
      from: Number.isFinite(moveContext?.from) ? moveContext.from : null,
      rawTargetPos: Number.isFinite(moveContext?.rawTargetPos) ? moveContext.rawTargetPos : null,
      targetPos: Number.isFinite(targetPos) ? targetPos : null,
      sourceMapTargetBlockId: moveContext?.sourceMapTargetBlock?.id ?? null,
      sourceMapTargetFrom: Number.isFinite(moveContext?.sourceMapTargetBlock?.sourceFrom)
        ? moveContext.sourceMapTargetBlock.sourceFrom
        : null,
      sourceMapTargetTo: Number.isFinite(moveContext?.sourceMapTargetBlock?.sourceTo)
        ? moveContext.sourceMapTargetBlock.sourceTo
        : null
    },
    correctedAssoc: {
      trigger,
      targetPos: Number.isFinite(targetPos) ? targetPos : null,
      lineNumber: Number.isFinite(lineNumber) ? lineNumber : null,
      lineLength: Number.isFinite(lineLength) ? lineLength : null,
      previousAssoc: Number.isFinite(previousAssoc) ? previousAssoc : null,
      nextAssoc: Number.isFinite(nextAssoc) ? nextAssoc : null,
      cursorState: cursorState ?? null
    }
  };
}

export function buildVerticalCursorMoveLogEvents({
  trigger = null,
  moveContext = null,
  targetLineTextPreview = null
} = {}) {
  if (!moveContext || typeof moveContext !== 'object') {
    return [];
  }

  const payloads = buildVerticalCursorMoveLogPayloads({
    trigger,
    moveContext,
    reason: moveContext?.status === 'non-empty-selection' ? 'non-empty-selection' : null,
    targetLineTextPreview,
    targetPos: moveContext?.to
  });
  if (moveContext.status === 'non-empty-selection') {
    return [
      {
        level: 'trace',
        event: 'cursor.move.vertical.skipped',
        payload: payloads.skipped
      }
    ];
  }

  if (moveContext.status === 'boundary') {
    return [
      {
        level: 'trace',
        event: 'cursor.move.vertical.boundary',
        payload: payloads.boundary
      }
    ];
  }

  if (moveContext.status !== 'target') {
    return [];
  }

  const events = [
    {
      level: 'trace',
      event: 'cursor.move.vertical',
      payload: payloads.moved
    }
  ];
  if (moveContext?.sourceMapClamp?.clamped) {
    events.push({
      level: 'warn',
      event: 'cursor.move.vertical.source-map-clamped',
      payload: payloads.sourceMapClamped
    });
  }

  return events;
}

export function resolveVerticalCursorAssocCorrection({
  trigger = null,
  moveContext = null,
  cursorState = null,
  selectedLine = null,
  domSelectionOnContentContainer = false,
  isCursorVisibilitySuspect = null
} = {}) {
  const selectedLineLength = (
    Number.isFinite(selectedLine?.from) &&
    Number.isFinite(selectedLine?.to)
  )
    ? Math.max(0, selectedLine.to - selectedLine.from)
    : 0;
  const shouldCorrectAssoc = Boolean(
    moveContext?.status === 'target' &&
    cursorState?.hasCursorElement &&
    typeof isCursorVisibilitySuspect === 'function' &&
    isCursorVisibilitySuspect(
      cursorState,
      selectedLineLength,
      Boolean(domSelectionOnContentContainer)
    )
  );
  const payloads = buildVerticalCursorMoveLogPayloads({
    trigger,
    moveContext,
    targetPos: moveContext?.to,
    lineNumber: selectedLine?.number,
    lineLength: selectedLineLength,
    previousAssoc: moveContext?.primaryAssoc,
    nextAssoc: moveContext?.secondaryAssoc,
    cursorState
  });

  return {
    shouldCorrectAssoc,
    selectedLineLength,
    payload: payloads.correctedAssoc,
    logs: shouldCorrectAssoc
      ? [
        {
          level: 'warn',
          event: 'cursor.move.vertical.corrected-assoc',
          payload: payloads.correctedAssoc
        }
      ]
      : []
  };
}

export function resolveRenderedSourcePosition({
  docLength,
  sourceFrom,
  sourcePosByCoordinates = null,
  sourcePosBySourceRange = null,
  sourcePosByDomTarget = null,
  sourcePosByDomBlock = null,
  sourceMapFragmentBounds = null,
  blockBoundsBySourceFrom = null,
  maxDomAnchorDistance = 40,
  resolveLiveBlockSelection = null,
  distanceToBlockBounds = null,
  shouldPreferRenderedDomAnchorPosition = null
} = {}) {
  const canResolveSelection = typeof resolveLiveBlockSelection === 'function';
  const canMeasureDistance = typeof distanceToBlockBounds === 'function';
  const sourcePosBySourceMap = (
    !Number.isFinite(sourcePosBySourceRange) &&
    sourceMapFragmentBounds &&
    (
      Number.isFinite(sourcePosByCoordinates) ||
      Number.isFinite(sourceMapFragmentBounds?.from)
    ) &&
    canResolveSelection
  )
    ? resolveLiveBlockSelection(
        docLength,
        sourceMapFragmentBounds.from,
        Number.isFinite(sourcePosByCoordinates)
          ? sourcePosByCoordinates
          : sourceMapFragmentBounds.from,
        sourceMapFragmentBounds
      )
    : null;
  const sourcePosByCoordinatesDistanceToSourceFromBlock =
    Number.isFinite(sourcePosByCoordinates) && blockBoundsBySourceFrom && canMeasureDistance
      ? distanceToBlockBounds(sourcePosByCoordinates, blockBoundsBySourceFrom)
      : null;
  const sourcePosBySourceRangeDistanceToSourceFromBlock =
    Number.isFinite(sourcePosBySourceRange) && blockBoundsBySourceFrom && canMeasureDistance
      ? distanceToBlockBounds(sourcePosBySourceRange, blockBoundsBySourceFrom)
      : null;
  const sourcePosByDomTargetDistanceToSourceFromBlock =
    Number.isFinite(sourcePosByDomTarget) && blockBoundsBySourceFrom && canMeasureDistance
      ? distanceToBlockBounds(sourcePosByDomTarget, blockBoundsBySourceFrom)
      : null;
  const sourcePosByDomBlockDistanceToSourceFromBlock =
    Number.isFinite(sourcePosByDomBlock) && blockBoundsBySourceFrom && canMeasureDistance
      ? distanceToBlockBounds(sourcePosByDomBlock, blockBoundsBySourceFrom)
      : null;
  const allowHeuristicSticky =
    !Number.isFinite(sourcePosBySourceRange) && !Number.isFinite(sourcePosBySourceMap);
  const preferDomAnchorForRenderedClick = Boolean(
    allowHeuristicSticky &&
    typeof shouldPreferRenderedDomAnchorPosition === 'function' &&
    shouldPreferRenderedDomAnchorPosition({
      sourcePosDistanceToSourceFromBlock: sourcePosByCoordinatesDistanceToSourceFromBlock,
      domTargetDistanceToSourceFromBlock: sourcePosByDomTargetDistanceToSourceFromBlock,
      domBlockDistanceToSourceFromBlock: sourcePosByDomBlockDistanceToSourceFromBlock,
      maxSourcePosDistance: maxDomAnchorDistance
    })
  );
  const sourcePosByStickyClamp =
    preferDomAnchorForRenderedClick &&
    Number.isFinite(sourcePosByCoordinates) &&
    blockBoundsBySourceFrom &&
    canResolveSelection
      ? resolveLiveBlockSelection(
          docLength,
          sourceFrom,
          sourcePosByCoordinates,
          blockBoundsBySourceFrom
        )
      : null;
  let sourcePos = sourcePosByCoordinates;
  let sourcePosOrigin = 'coordinates';
  if (Number.isFinite(sourcePosBySourceRange)) {
    sourcePos = sourcePosBySourceRange;
    sourcePosOrigin = 'source-range';
  } else if (Number.isFinite(sourcePosBySourceMap)) {
    sourcePos = sourcePosBySourceMap;
    sourcePosOrigin = 'source-map-fragment';
  } else if (preferDomAnchorForRenderedClick) {
    if (Number.isFinite(sourcePosByStickyClamp)) {
      sourcePos = sourcePosByStickyClamp;
      sourcePosOrigin = 'dom-sticky-clamped';
    } else if (sourcePosByDomTargetDistanceToSourceFromBlock === 0) {
      sourcePos = sourcePosByDomTarget;
      sourcePosOrigin = 'dom-target-sticky';
    } else if (sourcePosByDomBlockDistanceToSourceFromBlock === 0) {
      sourcePos = sourcePosByDomBlock;
      sourcePosOrigin = 'dom-block-sticky';
    }
  }

  if (!Number.isFinite(sourcePos)) {
    if (Number.isFinite(sourcePosByDomTarget)) {
      sourcePos = sourcePosByDomTarget;
      sourcePosOrigin = 'dom-target-fallback';
    } else if (Number.isFinite(sourcePosByDomBlock)) {
      sourcePos = sourcePosByDomBlock;
      sourcePosOrigin = 'dom-block-fallback';
    }
  }

  return {
    sourcePos,
    sourcePosOrigin,
    sourcePosBySourceMap,
    sourcePosByStickyClamp,
    allowHeuristicSticky,
    preferDomAnchorForRenderedClick,
    sourcePosByCoordinatesDistanceToSourceFromBlock,
    sourcePosBySourceRangeDistanceToSourceFromBlock,
    sourcePosByDomTargetDistanceToSourceFromBlock,
    sourcePosByDomBlockDistanceToSourceFromBlock
  };
}

export function resolveRenderedBoundaryPolicy({
  allowHeuristicSticky = false,
  targetTagName = null,
  sourceFromBlockIsFencedCode = false,
  sourcePosDistanceToSourceFromBlock = null,
  sourcePosLineDeltaAfterSourceFromBlock = null,
  sourcePosOutsideSourceFromBlock = false,
  blockBoundsBySourceFrom = null,
  blockBoundsBySourcePos = null,
  pointerDistanceToBlockBottom = null,
  pointerRatioY = null,
  livePreviewRenderedFencedStickyMaxPosDelta = 12,
  livePreviewRenderedFencedStickyMaxLineDelta = 2,
  livePreviewRenderedBoundaryStickyMaxPosDelta = 30,
  livePreviewRenderedBoundaryStickyMaxLineDelta = 3,
  livePreviewRenderedBoundaryStickyMaxDistanceFromBottomPx = 14,
  livePreviewRenderedBoundaryStickyMinRatioY = 0.3,
  shouldPreferSourceFromForRenderedFencedClick = null,
  shouldPreferSourceFromForRenderedBoundaryClick = null
} = {}) {
  const preferSourceFromForRenderedFencedClick = Boolean(
    allowHeuristicSticky &&
    typeof shouldPreferSourceFromForRenderedFencedClick === 'function' &&
    shouldPreferSourceFromForRenderedFencedClick({
      targetTagName,
      sourceFromBlockIsFencedCode,
      sourcePosDistanceToSourceFromBlock,
      sourcePosLineDeltaAfterSourceFromBlock,
      maxDistance: livePreviewRenderedFencedStickyMaxPosDelta,
      maxLineDelta: livePreviewRenderedFencedStickyMaxLineDelta
    })
  );

  const shouldReboundToSourcePosBlockCandidate = Boolean(
    sourcePosOutsideSourceFromBlock &&
    blockBoundsBySourcePos &&
    blockBoundsBySourcePos !== blockBoundsBySourceFrom
  );

  const preferSourceFromForRenderedBoundaryClick = Boolean(
    allowHeuristicSticky &&
    typeof shouldPreferSourceFromForRenderedBoundaryClick === 'function' &&
    shouldPreferSourceFromForRenderedBoundaryClick({
      targetTagName,
      sourceFromBlockIsFencedCode,
      sourcePosDistanceToSourceFromBlock,
      sourcePosLineDeltaAfterSourceFromBlock,
      pointerDistanceToBlockBottom,
      pointerRatioY,
      maxSourcePosDistance: livePreviewRenderedBoundaryStickyMaxPosDelta,
      maxLineDelta: livePreviewRenderedBoundaryStickyMaxLineDelta,
      maxDistanceFromBottomPx: livePreviewRenderedBoundaryStickyMaxDistanceFromBottomPx,
      minPointerRatioY: livePreviewRenderedBoundaryStickyMinRatioY
    })
  );

  const shouldReboundToSourcePosBlock =
    allowHeuristicSticky &&
    shouldReboundToSourcePosBlockCandidate &&
    !preferSourceFromForRenderedFencedClick &&
    !preferSourceFromForRenderedBoundaryClick;
  const blockBounds = shouldReboundToSourcePosBlock
    ? blockBoundsBySourcePos
    : blockBoundsBySourceFrom;

  return {
    preferSourceFromForRenderedFencedClick,
    preferSourceFromForRenderedBoundaryClick,
    shouldReboundToSourcePosBlockCandidate,
    shouldReboundToSourcePosBlock,
    blockBounds
  };
}

export function resolveRenderedSelectionPreference({
  docLength,
  sourceAnchorFrom,
  sourcePos,
  blockBounds = null,
  blockBoundsBySourceFrom = null,
  preferSourceFromForRenderedFencedClick = false,
  preferSourceFromForRenderedBoundaryClick = false,
  resolveLiveBlockSelection = null,
  distanceToBlockBounds = null
} = {}) {
  const canMeasureDistance = typeof distanceToBlockBounds === 'function';
  const sourcePosDistanceToFinalBlock =
    Number.isFinite(sourcePos) && canMeasureDistance
      ? distanceToBlockBounds(sourcePos, blockBounds)
      : null;
  const sourcePosInBounds =
    Number.isFinite(sourcePosDistanceToFinalBlock) && sourcePosDistanceToFinalBlock === 0;
  const sourcePosNearFinalBlock =
    Number.isFinite(sourcePosDistanceToFinalBlock) && sourcePosDistanceToFinalBlock <= 1;

  const stickySelection = (
    (preferSourceFromForRenderedFencedClick || preferSourceFromForRenderedBoundaryClick) &&
    typeof resolveLiveBlockSelection === 'function'
  )
    ? resolveLiveBlockSelection(
        docLength,
        sourceAnchorFrom,
        sourcePos,
        blockBoundsBySourceFrom
      )
    : null;
  const preferredSelection = Number.isFinite(stickySelection)
    ? stickySelection
    : Number.isFinite(sourcePos) && (sourcePosInBounds || sourcePosNearFinalBlock)
      ? sourcePos
      : null;

  return {
    sourcePosDistanceToFinalBlock,
    sourcePosInBounds,
    sourcePosNearFinalBlock,
    stickySelection,
    preferredSelection,
    allowCoordinateRemap: !Number.isFinite(preferredSelection)
  };
}

export function buildRenderedActivationLogPayloads({
  trigger,
  sourceFrom,
  sourcePos,
  sourcePosOrigin,
  sourcePosByCoordinates,
  sourcePosBySourceRange,
  sourcePosBySourceMap,
  sourcePosByDomTarget,
  sourcePosByDomBlock,
  sourcePosByStickyClamp,
  sourcePosByCoordinatesDistanceToSourceFromBlock,
  sourcePosBySourceRangeDistanceToSourceFromBlock,
  sourcePosByDomTargetDistanceToSourceFromBlock,
  sourcePosByDomBlockDistanceToSourceFromBlock,
  sourceRangeTarget = null,
  allowHeuristicSticky = false,
  preferDomAnchorForRenderedClick = false,
  preferSourceFromForRenderedFencedClick = false,
  preferSourceFromForRenderedBoundaryClick = false,
  targetTagName = null,
  sourceFromBlockLineBounds = null,
  sourcePosBlockLineBounds = null,
  sourcePosDistanceToSourceFromBlock = null,
  sourcePosLineDeltaAfterSourceFromBlock = null,
  boundaryCrossingLineNumbers = null,
  boundaryEdgeLineNumbers = null,
  blockBounds = null,
  blockBoundsBySourceFrom = null,
  blockBoundsBySourcePos = null,
  sourcePosInBounds = false,
  sourcePosDistanceToFinalBlock = null,
  sourcePosNearFinalBlock = false,
  sourceFromBlockIsFencedCode = false,
  stickySelection = null,
  preferredSelection = null,
  allowCoordinateRemap = true,
  shouldReboundToSourcePosBlock = false,
  sourceMapMatch = null,
  pointerProbe = null,
  normalizeLogString = null
} = {}) {
  const sourceRangeFrom = sourceRangeTarget?.range?.from ?? null;
  const sourceRangeTo = sourceRangeTarget?.range?.to ?? null;
  const sourceRangeSource = sourceRangeTarget?.range?.source ?? null;
  const sourceRangeTagName = sourceRangeTarget?.element?.tagName ?? null;
  const sourceRangeClassName =
    typeof sourceRangeTarget?.element?.className === 'string'
      ? (
          typeof normalizeLogString === 'function'
            ? normalizeLogString(sourceRangeTarget.element.className, 120)
            : sourceRangeTarget.element.className
        )
      : null;

  return {
    renderedBlockUnbounded: {
      trigger,
      sourceFrom,
      sourcePos: Number.isFinite(sourcePos) ? sourcePos : null
    },
    rebound: {
      trigger,
      sourceFrom,
      reboundFrom: blockBoundsBySourceFrom?.from ?? null,
      reboundTo: blockBoundsBySourceFrom?.to ?? null,
      sourcePos: Number.isFinite(sourcePos) ? sourcePos : null
    },
    renderedReboundSourcePosBlock: {
      trigger,
      sourceFrom,
      sourcePos,
      sourcePosOrigin,
      reboundFrom: blockBoundsBySourcePos?.from ?? null,
      reboundTo: blockBoundsBySourcePos?.to ?? null,
      sourceFromBlockFrom: blockBoundsBySourceFrom?.from ?? null,
      sourceFromBlockTo: blockBoundsBySourceFrom?.to ?? null
    },
    renderedDomAnchorSticky: {
      trigger,
      sourceFrom,
      sourcePos,
      sourcePosOrigin,
      sourcePosByCoordinates,
      sourcePosByDomTarget,
      sourcePosByDomBlock,
      sourcePosByStickyClamp,
      sourcePosByCoordinatesDistanceToSourceFromBlock,
      sourcePosByDomTargetDistanceToSourceFromBlock,
      sourcePosByDomBlockDistanceToSourceFromBlock,
      sourceFromBlockFrom: blockBoundsBySourceFrom?.from ?? null,
      sourceFromBlockTo: blockBoundsBySourceFrom?.to ?? null
    },
    renderedSourceRange: {
      trigger,
      sourceFrom,
      sourcePos,
      sourcePosOrigin,
      sourcePosBySourceRange,
      sourcePosByCoordinates,
      sourceRangeFrom,
      sourceRangeTo,
      sourceRangeSource,
      sourceRangeTagName,
      sourceRangeClassName
    },
    renderedFencedSourceSticky: {
      trigger,
      sourceFrom,
      sourcePos,
      targetTagName,
      sourcePosDistanceToSourceFromBlock,
      sourcePosLineDeltaAfterSourceFromBlock,
      stickySelection,
      sourceFromBlockFrom: blockBoundsBySourceFrom?.from ?? null,
      sourceFromBlockTo: blockBoundsBySourceFrom?.to ?? null
    },
    renderedBoundarySourceSticky: {
      trigger,
      sourceFrom,
      sourcePos,
      targetTagName,
      sourcePosDistanceToSourceFromBlock,
      sourcePosLineDeltaAfterSourceFromBlock,
      pointerDistanceToBlockBottom: pointerProbe?.pointer?.pointerDistanceToBlockBottom ?? null,
      pointerRatioY: pointerProbe?.pointer?.pointerRatioY ?? null,
      stickySelection,
      sourceFromBlockFrom: blockBoundsBySourceFrom?.from ?? null,
      sourceFromBlockTo: blockBoundsBySourceFrom?.to ?? null
    },
    renderedBoundaryCrossing: {
      trigger,
      sourceFrom,
      sourcePos,
      targetTagName,
      sourcePosDistanceToSourceFromBlock,
      sourcePosLineDeltaAfterSourceFromBlock,
      sourceFromBlockFrom: blockBoundsBySourceFrom?.from ?? null,
      sourceFromBlockTo: blockBoundsBySourceFrom?.to ?? null,
      sourcePosBlockFrom: blockBoundsBySourcePos?.from ?? null,
      sourcePosBlockTo: blockBoundsBySourcePos?.to ?? null,
      finalBlockFrom: blockBounds?.from ?? null,
      finalBlockTo: blockBounds?.to ?? null,
      sourceFromBlockLineBounds,
      sourcePosBlockLineBounds,
      boundaryCrossingLineNumbers,
      boundaryEdgeLineNumbers,
      pointerOffsetY: pointerProbe?.pointer?.pointerOffsetY ?? null,
      pointerRatioY: pointerProbe?.pointer?.pointerRatioY ?? null,
      pointerDistanceToBlockBottom: pointerProbe?.pointer?.pointerDistanceToBlockBottom ?? null
    },
    renderedSourcePosOutsideBlock: {
      trigger,
      sourceFrom,
      sourcePos,
      sourcePosOrigin,
      sourcePosByCoordinates,
      sourcePosBySourceRange,
      sourcePosByDomTarget,
      sourcePosByDomBlock,
      sourcePosByStickyClamp,
      sourcePosByCoordinatesDistanceToSourceFromBlock,
      sourcePosBySourceRangeDistanceToSourceFromBlock,
      sourcePosByDomTargetDistanceToSourceFromBlock,
      sourcePosByDomBlockDistanceToSourceFromBlock,
      sourceRangeFrom,
      sourceRangeTo,
      sourceRangeSource,
      allowHeuristicSticky,
      preferDomAnchorForRenderedClick,
      preferSourceFromForRenderedFencedClick,
      preferSourceFromForRenderedBoundaryClick,
      targetTagName,
      sourceFromBlockLineBounds,
      sourcePosBlockLineBounds,
      sourcePosDistanceToSourceFromBlock,
      sourcePosLineDeltaAfterSourceFromBlock,
      boundaryCrossingLineNumbers,
      boundaryEdgeLineNumbers,
      blockFrom: blockBounds?.from ?? null,
      blockTo: blockBounds?.to ?? null
    },
    renderedPointerProbe: {
      trigger,
      sourceFrom,
      sourcePos: Number.isFinite(sourcePos) ? sourcePos : null,
      blockFrom: blockBounds?.from ?? null,
      blockTo: blockBounds?.to ?? null,
      sourcePosInBounds,
      sourcePosDistanceToFinalBlock,
      sourcePosNearFinalBlock,
      sourcePosOrigin,
      sourcePosByCoordinates,
      sourcePosBySourceRange,
      sourcePosBySourceMap,
      sourcePosByDomTarget,
      sourcePosByDomBlock,
      sourcePosByStickyClamp,
      sourcePosByCoordinatesDistanceToSourceFromBlock,
      sourcePosBySourceRangeDistanceToSourceFromBlock,
      sourcePosByDomTargetDistanceToSourceFromBlock,
      sourcePosByDomBlockDistanceToSourceFromBlock,
      sourceRangeFrom,
      sourceRangeTo,
      sourceRangeSource,
      allowHeuristicSticky,
      preferDomAnchorForRenderedClick,
      sourcePosDistanceToSourceFromBlock,
      sourcePosLineDeltaAfterSourceFromBlock,
      sourceFromBlockIsFencedCode,
      preferSourceFromForRenderedFencedClick,
      preferSourceFromForRenderedBoundaryClick,
      stickySelection,
      preferredSelection,
      allowCoordinateRemap,
      reboundToSourcePosBlock: shouldReboundToSourcePosBlock,
      sourceMapMatch,
      pointerProbe
    }
  };
}

export function buildRenderedActivationLogEvents({
  sourceFrom = null,
  sourcePos = null,
  sourcePosBySourceRange = null,
  blockBounds = null,
  blockBoundsBySourceFrom = null,
  sourcePosInBounds = false,
  shouldReboundToSourcePosBlock = false,
  preferDomAnchorForRenderedClick = false,
  preferSourceFromForRenderedFencedClick = false,
  preferSourceFromForRenderedBoundaryClick = false,
  renderedBoundaryCrossingLikely = false,
  renderedLogPayloads = null
} = {}) {
  if (!renderedLogPayloads) {
    return [];
  }

  const events = [];

  if (!blockBounds) {
    events.push({
      level: 'trace',
      event: 'block.activate.rendered-block-unbounded',
      payload: renderedLogPayloads.renderedBlockUnbounded
    });
  } else if (blockBoundsBySourceFrom && blockBoundsBySourceFrom.from !== sourceFrom) {
    events.push({
      level: 'trace',
      event: 'block.activate.rebound',
      payload: renderedLogPayloads.rebound
    });
  }

  if (shouldReboundToSourcePosBlock) {
    events.push({
      level: 'trace',
      event: 'block.activate.rendered-rebound-source-pos-block',
      payload: renderedLogPayloads.renderedReboundSourcePosBlock
    });
  }

  if (preferDomAnchorForRenderedClick) {
    events.push({
      level: 'trace',
      event: 'block.activate.rendered-dom-anchor-sticky',
      payload: renderedLogPayloads.renderedDomAnchorSticky
    });
  }

  if (Number.isFinite(sourcePosBySourceRange)) {
    events.push({
      level: 'trace',
      event: 'block.activate.rendered-source-range',
      payload: renderedLogPayloads.renderedSourceRange
    });
  }

  if (preferSourceFromForRenderedFencedClick) {
    events.push({
      level: 'trace',
      event: 'block.activate.rendered-fenced-source-sticky',
      payload: renderedLogPayloads.renderedFencedSourceSticky
    });
  }

  if (preferSourceFromForRenderedBoundaryClick) {
    events.push({
      level: 'trace',
      event: 'block.activate.rendered-boundary-source-sticky',
      payload: renderedLogPayloads.renderedBoundarySourceSticky
    });
  }

  if (renderedBoundaryCrossingLikely) {
    events.push({
      level: 'warn',
      event: 'block.activate.rendered-boundary-crossing',
      payload: renderedLogPayloads.renderedBoundaryCrossing
    });
  }

  if (
    blockBounds &&
    Number.isFinite(sourcePos) &&
    !sourcePosInBounds
  ) {
    events.push({
      level: 'trace',
      event: 'block.activate.rendered-source-pos-outside-block',
      payload: renderedLogPayloads.renderedSourcePosOutsideBlock
    });
  }

  events.push({
    level: 'trace',
    event: 'block.activate.rendered-pointer-probe',
    payload: renderedLogPayloads.renderedPointerProbe
  });

  return events;
}

export function resolveRenderedActivationContext({
  view = null,
  targetElement = null,
  coordinates = null,
  trigger = null,
  renderedTarget = null,
  blocks = null,
  sourceMapIndex = null,
  resolvePointerPosition = null,
  findRenderedSourceRangeTarget = null,
  resolvePositionFromRenderedSourceRange = null,
  resolveActivationBlockBounds = null,
  resolveLiveBlockSelection = null,
  distanceToBlockBounds = null,
  shouldPreferRenderedDomAnchorPosition = null,
  findBlockContainingPosition = null,
  findNearestBlockForPosition = null,
  readBlockLineBoundsForLog = null,
  readLineInfoForPosition = null,
  isFencedCodeBlock = null,
  buildRenderedPointerProbe = null,
  summarizeLineNumbersForCoordSamples = null,
  shouldPreferSourceFromForRenderedFencedClick = null,
  shouldPreferSourceFromForRenderedBoundaryClick = null,
  normalizeLogString = null,
  livePreviewRenderedDomAnchorStickyMaxPosDelta = 40,
  livePreviewRenderedFencedStickyMaxPosDelta = 12,
  livePreviewRenderedFencedStickyMaxLineDelta = 2,
  livePreviewRenderedBoundaryStickyMaxPosDelta = 30,
  livePreviewRenderedBoundaryStickyMaxLineDelta = 3,
  livePreviewRenderedBoundaryStickyMaxDistanceFromBottomPx = 14,
  livePreviewRenderedBoundaryStickyMinRatioY = 0.3
} = {}) {
  if (
    !view ||
    !renderedTarget?.renderedBlock ||
    !Number.isFinite(renderedTarget?.sourceFrom)
  ) {
    return {
      activation: null,
      logs: []
    };
  }

  const doc = view.state?.doc;
  const docLength = Number.isFinite(doc?.length) ? doc.length : 0;
  const renderedBlock = renderedTarget.renderedBlock;
  const sourceFrom = renderedTarget.sourceFrom;
  const sourceTo = renderedTarget.sourceTo;
  const fragmentFrom = renderedTarget.fragmentFrom;
  const fragmentTo = renderedTarget.fragmentTo;
  const normalizedBlocks = Array.isArray(blocks) ? blocks : [];
  const normalizedSourceMapIndex = Array.isArray(sourceMapIndex) ? sourceMapIndex : [];

  const sourceMapContext = findSourceMapContext(
    normalizedSourceMapIndex,
    sourceFrom,
    sourceTo,
    fragmentFrom,
    fragmentTo
  );
  const sourceAnchorFrom = sourceMapContext.blockBounds?.from ?? sourceFrom;

  const sourceRangeTarget = typeof findRenderedSourceRangeTarget === 'function'
    ? findRenderedSourceRangeTarget(targetElement, renderedBlock)
    : null;
  const sourcePosByCoordinates = typeof resolvePointerPosition === 'function'
    ? resolvePointerPosition(view, renderedBlock, coordinates)
    : null;
  const sourcePosBySourceRange =
    typeof resolvePositionFromRenderedSourceRange === 'function' && doc
      ? resolvePositionFromRenderedSourceRange(
          doc,
          sourceRangeTarget?.range ?? null,
          sourceRangeTarget?.element ?? null,
          coordinates,
          sourcePosByCoordinates
        )
      : null;
  const sourcePosByDomTarget = typeof resolvePointerPosition === 'function'
    ? resolvePointerPosition(view, targetElement, null)
    : null;
  const sourcePosByDomBlock = typeof resolvePointerPosition === 'function'
    ? resolvePointerPosition(view, renderedBlock, null)
    : null;
  const blockBoundsBySourceFrom = sourceMapContext.blockBounds ?? (
    typeof resolveActivationBlockBounds === 'function'
      ? resolveActivationBlockBounds(
          normalizedBlocks,
          sourceAnchorFrom,
          Number.isFinite(sourcePosBySourceRange)
            ? sourcePosBySourceRange
            : sourcePosByCoordinates
        )
      : null
  );
  const {
    sourcePos,
    sourcePosOrigin,
    sourcePosBySourceMap,
    sourcePosByStickyClamp,
    allowHeuristicSticky,
    preferDomAnchorForRenderedClick,
    sourcePosByCoordinatesDistanceToSourceFromBlock,
    sourcePosBySourceRangeDistanceToSourceFromBlock,
    sourcePosByDomTargetDistanceToSourceFromBlock,
    sourcePosByDomBlockDistanceToSourceFromBlock
  } = resolveRenderedSourcePosition({
    docLength,
    sourceFrom,
    sourcePosByCoordinates,
    sourcePosBySourceRange,
    sourcePosByDomTarget,
    sourcePosByDomBlock,
    sourceMapFragmentBounds: sourceMapContext.fragmentBounds,
    blockBoundsBySourceFrom,
    maxDomAnchorDistance: livePreviewRenderedDomAnchorStickyMaxPosDelta,
    resolveLiveBlockSelection,
    distanceToBlockBounds,
    shouldPreferRenderedDomAnchorPosition
  });

  const blockBoundsBySourcePos = Number.isFinite(sourcePos)
    ? (
        findSourceMapBlockBoundsForPosition(normalizedSourceMapIndex, sourcePos) ??
        (
          typeof findBlockContainingPosition === 'function'
            ? findBlockContainingPosition(normalizedBlocks, sourcePos)
            : null
        ) ??
        (
          typeof findNearestBlockForPosition === 'function'
            ? findNearestBlockForPosition(normalizedBlocks, sourcePos, 1)
            : null
        )
      )
    : null;
  const sourcePosDistanceToSourceFromBlock =
    Number.isFinite(sourcePos) &&
    blockBoundsBySourceFrom &&
    typeof distanceToBlockBounds === 'function'
      ? distanceToBlockBounds(sourcePos, blockBoundsBySourceFrom)
      : null;
  const sourcePosOutsideSourceFromBlock =
    Number.isFinite(sourcePos) &&
    blockBoundsBySourceFrom &&
    sourcePosDistanceToSourceFromBlock !== 0;
  const sourceFromBlockLineBounds =
    typeof readBlockLineBoundsForLog === 'function' && doc
      ? readBlockLineBoundsForLog(doc, blockBoundsBySourceFrom)
      : null;
  const sourcePosBlockLineBounds =
    typeof readBlockLineBoundsForLog === 'function' && doc
      ? readBlockLineBoundsForLog(doc, blockBoundsBySourcePos)
      : null;
  const sourcePosLineInfo =
    typeof readLineInfoForPosition === 'function' && doc
      ? readLineInfoForPosition(doc, sourcePos)
      : null;
  const sourcePosLineDeltaAfterSourceFromBlock =
    Number.isFinite(sourcePosLineInfo?.lineNumber) &&
    Number.isFinite(sourceFromBlockLineBounds?.endLineNumber)
      ? sourcePosLineInfo.lineNumber - sourceFromBlockLineBounds.endLineNumber
      : null;
  const sourceFromBlockIsFencedCode = Boolean(
    blockBoundsBySourceFrom &&
    typeof isFencedCodeBlock === 'function' &&
    doc &&
    isFencedCodeBlock(doc, blockBoundsBySourceFrom)
  );
  const shouldReboundToSourcePosBlockCandidate =
    sourcePosOutsideSourceFromBlock &&
    blockBoundsBySourcePos &&
    blockBoundsBySourcePos !== blockBoundsBySourceFrom;
  const provisionalBlockBounds = shouldReboundToSourcePosBlockCandidate
    ? blockBoundsBySourcePos
    : blockBoundsBySourceFrom;
  const pointerProbeForDecision = typeof buildRenderedPointerProbe === 'function'
    ? buildRenderedPointerProbe(
        view,
        renderedBlock,
        targetElement,
        coordinates,
        provisionalBlockBounds,
        sourcePos,
        blockBoundsBySourceFrom,
        blockBoundsBySourcePos
      )
    : null;
  const {
    preferSourceFromForRenderedFencedClick,
    preferSourceFromForRenderedBoundaryClick,
    shouldReboundToSourcePosBlock,
    blockBounds
  } = resolveRenderedBoundaryPolicy({
    allowHeuristicSticky,
    targetTagName: targetElement?.tagName ?? null,
    sourceFromBlockIsFencedCode,
    sourcePosDistanceToSourceFromBlock,
    sourcePosLineDeltaAfterSourceFromBlock,
    sourcePosOutsideSourceFromBlock,
    blockBoundsBySourceFrom,
    blockBoundsBySourcePos,
    pointerDistanceToBlockBottom: pointerProbeForDecision?.pointer?.pointerDistanceToBlockBottom ?? null,
    pointerRatioY: pointerProbeForDecision?.pointer?.pointerRatioY ?? null,
    livePreviewRenderedFencedStickyMaxPosDelta,
    livePreviewRenderedFencedStickyMaxLineDelta,
    livePreviewRenderedBoundaryStickyMaxPosDelta,
    livePreviewRenderedBoundaryStickyMaxLineDelta,
    livePreviewRenderedBoundaryStickyMaxDistanceFromBottomPx,
    livePreviewRenderedBoundaryStickyMinRatioY,
    shouldPreferSourceFromForRenderedFencedClick,
    shouldPreferSourceFromForRenderedBoundaryClick
  });
  const pointerProbe =
    provisionalBlockBounds === blockBounds
      ? pointerProbeForDecision
      : (
        typeof buildRenderedPointerProbe === 'function'
          ? buildRenderedPointerProbe(
              view,
              renderedBlock,
              targetElement,
              coordinates,
              blockBounds,
              sourcePos,
              blockBoundsBySourceFrom,
              blockBoundsBySourcePos
            )
          : null
      );
  const boundaryCrossingLineNumbers =
    typeof summarizeLineNumbersForCoordSamples === 'function'
      ? summarizeLineNumbersForCoordSamples(pointerProbe?.verticalScanCoordSamples)
      : null;
  const boundaryEdgeLineNumbers =
    typeof summarizeLineNumbersForCoordSamples === 'function'
      ? summarizeLineNumbersForCoordSamples(pointerProbe?.edgeCoordSamples)
      : null;
  const renderedBoundaryCrossingLikely =
    sourcePosOutsideSourceFromBlock &&
    blockBoundsBySourceFrom &&
    blockBoundsBySourcePos &&
    blockBoundsBySourcePos !== blockBoundsBySourceFrom &&
    Number.isFinite(sourcePosLineDeltaAfterSourceFromBlock) &&
    Math.abs(sourcePosLineDeltaAfterSourceFromBlock) >= 2;
  const {
    sourcePosDistanceToFinalBlock,
    sourcePosInBounds,
    sourcePosNearFinalBlock,
    stickySelection,
    preferredSelection,
    allowCoordinateRemap
  } = resolveRenderedSelectionPreference({
    docLength,
    sourceAnchorFrom,
    sourcePos,
    blockBounds,
    blockBoundsBySourceFrom,
    preferSourceFromForRenderedFencedClick,
    preferSourceFromForRenderedBoundaryClick,
    resolveLiveBlockSelection,
    distanceToBlockBounds
  });
  const renderedLogPayloads = buildRenderedActivationLogPayloads({
    trigger,
    sourceFrom,
    sourcePos,
    sourcePosOrigin,
    sourcePosByCoordinates,
    sourcePosBySourceRange,
    sourcePosBySourceMap,
    sourcePosByDomTarget,
    sourcePosByDomBlock,
    sourcePosByStickyClamp,
    sourcePosByCoordinatesDistanceToSourceFromBlock,
    sourcePosBySourceRangeDistanceToSourceFromBlock,
    sourcePosByDomTargetDistanceToSourceFromBlock,
    sourcePosByDomBlockDistanceToSourceFromBlock,
    sourceRangeTarget,
    allowHeuristicSticky,
    preferDomAnchorForRenderedClick,
    preferSourceFromForRenderedFencedClick,
    preferSourceFromForRenderedBoundaryClick,
    targetTagName: targetElement?.tagName ?? null,
    sourceFromBlockLineBounds,
    sourcePosBlockLineBounds,
    sourcePosDistanceToSourceFromBlock,
    sourcePosLineDeltaAfterSourceFromBlock,
    boundaryCrossingLineNumbers,
    boundaryEdgeLineNumbers,
    blockBounds,
    blockBoundsBySourceFrom,
    blockBoundsBySourcePos,
    sourcePosInBounds,
    sourcePosDistanceToFinalBlock,
    sourcePosNearFinalBlock,
    sourceFromBlockIsFencedCode,
    stickySelection,
    preferredSelection,
    allowCoordinateRemap,
    shouldReboundToSourcePosBlock,
    sourceMapMatch: sourceMapContext.match,
    pointerProbe,
    normalizeLogString
  });
  const renderedLogEvents = buildRenderedActivationLogEvents({
    sourceFrom,
    sourcePos,
    sourcePosBySourceRange,
    blockBounds,
    blockBoundsBySourceFrom,
    sourcePosInBounds,
    shouldReboundToSourcePosBlock,
    preferDomAnchorForRenderedClick,
    preferSourceFromForRenderedFencedClick,
    preferSourceFromForRenderedBoundaryClick,
    renderedBoundaryCrossingLikely,
    renderedLogPayloads
  });

  return {
    activation: {
      sourceFrom: blockBounds?.from ?? sourceAnchorFrom,
      sourcePos: preferredSelection,
      rawSourcePos: Number.isFinite(sourcePosByCoordinates) ? sourcePosByCoordinates : null,
      sourcePosOrigin,
      blockBounds,
      strategy: 'rendered-block',
      match: sourceMapContext.match,
      allowCoordinateRemap,
      pointerProbe
    },
    logs: renderedLogEvents
  };
}

export function buildMappedPositionLogPayloads({
  trigger,
  sourceFrom,
  mappedPos = null,
  mappedAccepted = false,
  mappedPosLooksLikeDocEndDrift = false,
  unboundedPos = null,
  resolvedPos = null,
  baseSelection = null,
  baseSelectionLineInfo = null,
  mappedLineInfo = null,
  resolvedLineInfo = null,
  positionDeltaFromBase = null,
  lineDeltaFromBase = null,
  largeDeltaDetected = false,
  rejectMappedSelection = false,
  clampedByBlock = false,
  blockBounds = null,
  strategy = null,
  preferredSelection = null,
  allowCoordinateRemap = true,
  skipReason = null,
  coordinates = null
} = {}) {
  const x = Number.isFinite(coordinates?.x) ? coordinates.x : null;
  const y = Number.isFinite(coordinates?.y) ? coordinates.y : null;
  const blockFrom = blockBounds?.from ?? null;
  const blockTo = blockBounds?.to ?? null;

  return {
    mappedSkipped: {
      trigger,
      sourceFrom,
      selection: baseSelection,
      allowCoordinateRemap,
      reason: skipReason,
      strategy,
      blockFrom,
      blockTo
    },
    mapped: {
      trigger,
      sourceFrom,
      mappedPos,
      mappedAccepted,
      mappedPosLooksLikeDocEndDrift,
      unboundedPos,
      resolvedPos,
      baseSelection,
      baseSelectionLineInfo,
      mappedLineInfo,
      resolvedLineInfo,
      positionDeltaFromBase,
      lineDeltaFromBase,
      largeDeltaDetected,
      rejectMappedSelection,
      clampedByBlock,
      blockFrom,
      blockTo,
      x,
      y
    },
    mappedLargeDelta: {
      trigger,
      sourceFrom,
      baseSelection,
      resolvedPos,
      positionDeltaFromBase,
      lineDeltaFromBase,
      mappedPos,
      mappedAccepted,
      blockFrom,
      blockTo,
      strategy,
      x,
      y
    },
    mappedRejectedLargeDelta: {
      trigger,
      sourceFrom,
      strategy,
      baseSelection,
      resolvedPos,
      mappedPos,
      positionDeltaFromBase,
      lineDeltaFromBase,
      preferredSelection,
      blockFrom,
      blockTo,
      x,
      y
    }
  };
}

export function buildMappedPositionLogEvents({
  mappedLogPayloads = null,
  largeDeltaDetected = false,
  rejectMappedSelection = false
} = {}) {
  if (!mappedLogPayloads) {
    return [];
  }

  const events = [
    {
      level: 'trace',
      event: 'block.position.mapped',
      payload: mappedLogPayloads.mapped
    }
  ];

  if (largeDeltaDetected) {
    events.push({
      level: 'warn',
      event: 'block.position.mapped.large-delta',
      payload: mappedLogPayloads.mappedLargeDelta
    });
  }

  if (rejectMappedSelection) {
    events.push({
      level: 'warn',
      event: 'block.position.mapped.rejected-large-delta',
      payload: mappedLogPayloads.mappedRejectedLargeDelta
    });
  }

  return events;
}

export function buildMappedPositionSkippedLogEvents({
  mappedLogPayloads = null
} = {}) {
  if (!mappedLogPayloads) {
    return [];
  }

  return [
    {
      level: 'trace',
      event: 'block.position.mapped.skipped',
      payload: mappedLogPayloads.mappedSkipped
    }
  ];
}

export function resolveMappedSelectionRemapPreflight({
  trigger = null,
  sourceFrom = null,
  baseSelection = null,
  allowCoordinateRemap = true,
  coordinates = null,
  strategy = null,
  blockBounds = null
} = {}) {
  const shouldMap = Boolean(coordinates && allowCoordinateRemap);
  if (shouldMap) {
    return {
      shouldMap,
      skipReason: null,
      logs: []
    };
  }

  const skipReason = !coordinates ? 'missing-coordinates' : 'disabled-for-strategy';
  const mappedLogPayloads = buildMappedPositionLogPayloads({
    trigger,
    sourceFrom,
    baseSelection,
    allowCoordinateRemap,
    skipReason,
    strategy,
    blockBounds
  });
  const logs = buildMappedPositionSkippedLogEvents({
    mappedLogPayloads
  });

  return {
    shouldMap,
    skipReason,
    logs
  };
}

export function resolveMappedSelectionUpdate({
  trigger = null,
  sourceFrom = null,
  mappedPos = null,
  docLength = null,
  blockBounds = null,
  baseSelection = null,
  baseSelectionLineInfo = null,
  strategy = null,
  preferredSelection = null,
  coordinates = null,
  largeDeltaPosThreshold = 20,
  largeDeltaLineThreshold = 2,
  resolveLiveBlockSelection = null,
  readLineInfoForPosition = null,
  doc = null
} = {}) {
  const remap = resolveMappedSelectionRemap({
    mappedPos,
    docLength,
    blockBounds,
    sourceFrom,
    baseSelection,
    baseSelectionLineInfo,
    strategy,
    preferredSelection,
    largeDeltaPosThreshold,
    largeDeltaLineThreshold,
    resolveLiveBlockSelection,
    readLineInfoForPosition,
    doc
  });
  const mappedLogPayloads = buildMappedPositionLogPayloads({
    trigger,
    sourceFrom,
    mappedPos,
    mappedAccepted: remap.mappedAccepted,
    mappedPosLooksLikeDocEndDrift: remap.mappedPosLooksLikeDocEndDrift,
    unboundedPos: remap.unboundedPos,
    resolvedPos: remap.resolvedPos,
    baseSelection,
    baseSelectionLineInfo,
    mappedLineInfo: remap.mappedLineInfo,
    resolvedLineInfo: remap.resolvedLineInfo,
    positionDeltaFromBase: remap.positionDeltaFromBase,
    lineDeltaFromBase: remap.lineDeltaFromBase,
    largeDeltaDetected: remap.largeDeltaDetected,
    rejectMappedSelection: remap.rejectMappedSelection,
    clampedByBlock: remap.clampedByBlock,
    blockBounds,
    strategy,
    preferredSelection,
    coordinates
  });
  const logs = buildMappedPositionLogEvents({
    mappedLogPayloads,
    largeDeltaDetected: remap.largeDeltaDetected,
    rejectMappedSelection: remap.rejectMappedSelection
  });
  const shouldDispatchSelection =
    !remap.rejectMappedSelection &&
    Number.isFinite(remap.resolvedPos) &&
    remap.resolvedPos !== baseSelection;

  return {
    remap,
    logs,
    shouldDispatchSelection
  };
}

export function resolveMappedSelectionRemap({
  mappedPos = null,
  docLength = null,
  blockBounds = null,
  sourceFrom = null,
  baseSelection = null,
  baseSelectionLineInfo = null,
  strategy = null,
  preferredSelection = null,
  largeDeltaPosThreshold = 20,
  largeDeltaLineThreshold = 2,
  resolveLiveBlockSelection = null,
  readLineInfoForPosition = null,
  doc = null
} = {}) {
  const canResolveSelection = typeof resolveLiveBlockSelection === 'function';
  const canReadLineInfo = typeof readLineInfoForPosition === 'function';
  const mappedPosLooksLikeDocEndDrift =
    !blockBounds &&
    Number.isFinite(mappedPos) &&
    Number.isFinite(docLength) &&
    mappedPos === docLength &&
    Number.isFinite(sourceFrom) &&
    sourceFrom < docLength;
  const mappedAccepted = Number.isFinite(mappedPos) && !mappedPosLooksLikeDocEndDrift;
  const fallbackSelection = mappedAccepted ? sourceFrom : baseSelection;
  const nextMappedPos = mappedAccepted ? mappedPos : Number.NaN;
  const unboundedPos = canResolveSelection
    ? resolveLiveBlockSelection(
        docLength,
        fallbackSelection,
        nextMappedPos
      )
    : fallbackSelection;
  const resolvedPos = canResolveSelection
    ? resolveLiveBlockSelection(
        docLength,
        fallbackSelection,
        nextMappedPos,
        blockBounds
      )
    : unboundedPos;
  const clampedByBlock = resolvedPos !== unboundedPos;
  const mappedLineInfo = canReadLineInfo && doc
    ? readLineInfoForPosition(doc, mappedPos)
    : null;
  const resolvedLineInfo = canReadLineInfo && doc
    ? readLineInfoForPosition(doc, resolvedPos)
    : null;
  const positionDeltaFromBase =
    Number.isFinite(resolvedPos) && Number.isFinite(baseSelection)
      ? Math.abs(resolvedPos - baseSelection)
      : null;
  const lineDeltaFromBase =
    Number.isFinite(resolvedLineInfo?.lineNumber) && Number.isFinite(baseSelectionLineInfo?.lineNumber)
      ? Math.abs(resolvedLineInfo.lineNumber - baseSelectionLineInfo.lineNumber)
      : null;
  const normalizedLargeDeltaPosThreshold = Number.isFinite(largeDeltaPosThreshold)
    ? Math.max(0, Math.trunc(largeDeltaPosThreshold))
    : 20;
  const normalizedLargeDeltaLineThreshold = Number.isFinite(largeDeltaLineThreshold)
    ? Math.max(0, Math.trunc(largeDeltaLineThreshold))
    : 2;
  const largeDeltaDetected =
    Number.isFinite(positionDeltaFromBase) &&
    positionDeltaFromBase >= normalizedLargeDeltaPosThreshold &&
    Number.isFinite(lineDeltaFromBase) &&
    lineDeltaFromBase >= normalizedLargeDeltaLineThreshold;
  const rejectMappedSelection =
    largeDeltaDetected &&
    strategy === 'rendered-block' &&
    Number.isFinite(preferredSelection);

  return {
    mappedAccepted,
    mappedPosLooksLikeDocEndDrift,
    unboundedPos,
    resolvedPos,
    clampedByBlock,
    mappedLineInfo,
    resolvedLineInfo,
    positionDeltaFromBase,
    lineDeltaFromBase,
    largeDeltaDetected,
    rejectMappedSelection
  };
}

export function buildSourceFirstPointerLogPayloads({
  trigger,
  coordinates = null,
  rawMappedPosition = null,
  mappedPosition = null,
  lineInfo = null,
  mappedBlock = null,
  blockLineBounds = null,
  targetTagName = null,
  targetClassName = null,
  docLength = null
} = {}) {
  return {
    pointerMapNative: {
      trigger,
      x: Number.isFinite(coordinates?.x) ? coordinates.x : null,
      y: Number.isFinite(coordinates?.y) ? coordinates.y : null,
      rawMappedPosition: Number.isFinite(rawMappedPosition) ? rawMappedPosition : null,
      mappedPosition,
      lineInfo,
      blockFrom: mappedBlock?.from ?? null,
      blockTo: mappedBlock?.to ?? null,
      blockLineBounds,
      targetTagName,
      targetClassName
    },
    pointerMapClamped: {
      trigger,
      rawMappedPosition,
      mappedPosition,
      docLength: Number.isFinite(docLength) ? docLength : null,
      targetTagName
    }
  };
}

export function buildSourceFirstPointerLogEvents({
  trigger,
  coordinates = null,
  rawMappedPosition = null,
  mappedPosition = null,
  lineInfo = null,
  mappedBlock = null,
  blockLineBounds = null,
  targetTagName = null,
  targetClassName = null,
  docLength = null,
  clamped = false
} = {}) {
  const payloads = buildSourceFirstPointerLogPayloads({
    trigger,
    coordinates,
    rawMappedPosition,
    mappedPosition,
    lineInfo,
    mappedBlock,
    blockLineBounds,
    targetTagName,
    targetClassName,
    docLength
  });
  const events = [
    {
      level: 'trace',
      event: 'pointer.map.native',
      payload: payloads.pointerMapNative
    }
  ];

  if (clamped) {
    events.push({
      level: 'warn',
      event: 'pointer.map.clamped',
      payload: payloads.pointerMapClamped
    });
  }

  return events;
}

export function emitLiveDebugEvents(liveDebug, logEvents = []) {
  if (!liveDebug || !Array.isArray(logEvents) || logEvents.length === 0) {
    return 0;
  }

  let emittedCount = 0;
  for (const logEvent of logEvents) {
    if (!logEvent || typeof logEvent.event !== 'string' || logEvent.event.length === 0) {
      continue;
    }

    const level = logEvent.level;
    const emit =
      level === 'warn'
        ? liveDebug.warn
        : level === 'error'
          ? liveDebug.error
          : level === 'info'
            ? liveDebug.info
            : liveDebug.trace;
    if (typeof emit !== 'function') {
      continue;
    }

    emit.call(liveDebug, logEvent.event, logEvent.payload);
    emittedCount += 1;
  }

  return emittedCount;
}

export function buildPointerInputSignalPayload({
  trigger,
  coordinates = null,
  targetSummary = null
} = {}) {
  return {
    trigger,
    x: coordinates?.x ?? null,
    y: coordinates?.y ?? null,
    targetTag: targetSummary?.tagName ?? null,
    targetClassName: targetSummary?.className ?? null,
    sourceFrom: targetSummary?.sourceFrom ?? null
  };
}

export function buildPointerInputTraceEvent({
  pointerSignal = null,
  targetSummary = null
} = {}) {
  return {
    event: 'input.pointer',
    payload: {
      ...(pointerSignal == null ? {} : pointerSignal),
      target: targetSummary
    }
  };
}

export function resolvePointerInputSignalEvents({
  trigger,
  coordinates = null,
  targetSummary = null,
  recordInputSignal = null
} = {}) {
  const pointerSignalPayload = buildPointerInputSignalPayload({
    trigger,
    coordinates,
    targetSummary
  });
  const pointerSignal = typeof recordInputSignal === 'function'
    ? recordInputSignal('pointer', pointerSignalPayload)
    : pointerSignalPayload;
  const pointerTraceEvent = buildPointerInputTraceEvent({
    pointerSignal,
    targetSummary
  });

  return {
    pointerSignal,
    logs: [
      {
        level: 'trace',
        event: pointerTraceEvent.event,
        payload: pointerTraceEvent.payload
      }
    ]
  };
}

export function resolvePointerActivationPreflight({
  viewMode = null,
  targetElement = null,
  sourceFirstMode = true,
  trigger = null
} = {}) {
  if (viewMode !== 'live') {
    return {
      proceed: false,
      mode: 'inactive',
      renderedBlockTarget: null,
      logs: []
    };
  }

  if (!targetElement) {
    const activationLogPayloads = buildPointerActivationLogPayloads({
      trigger,
      reason: 'no-element-target'
    });
    return {
      proceed: false,
      mode: 'miss',
      renderedBlockTarget: null,
      logs: [
        {
          level: 'trace',
          event: 'block.activate.miss',
          payload: activationLogPayloads.activationMiss
        }
      ]
    };
  }

  if (sourceFirstMode) {
    return {
      proceed: true,
      mode: 'source-first',
      renderedBlockTarget: null,
      logs: []
    };
  }

  const renderedBlockTarget = typeof targetElement.closest === 'function'
    ? targetElement.closest('.cm-rendered-block')
    : null;
  if (!renderedBlockTarget) {
    const activationLogPayloads = buildPointerActivationLogPayloads({
      trigger,
      reason: 'not-rendered-block-target',
      targetTagName: targetElement.tagName,
      targetClassName: typeof targetElement.className === 'string' ? targetElement.className : ''
    });
    return {
      proceed: false,
      mode: 'pass-through-native',
      renderedBlockTarget: null,
      logs: [
        {
          level: 'trace',
          event: 'block.activate.pass-through-native',
          payload: activationLogPayloads.passThroughNative
        }
      ]
    };
  }

  return {
    proceed: true,
    mode: 'rendered',
    renderedBlockTarget,
    logs: []
  };
}

export function resolvePointerActivationIntent({
  viewMode = null,
  trigger = null,
  targetElement = null,
  coordinates = null,
  targetSummary = null,
  sourceFirstMode = true,
  recordInputSignal = null,
  resolvePointerPosition = null,
  view = null,
  liveBlocksForView = null,
  readLineInfoForPosition = null,
  resolveActivationBlockBounds = null,
  readBlockLineBoundsForLog = null
} = {}) {
  const logs = [];
  let pointerSignal = null;

  if (viewMode === 'live') {
    const pointerInput = resolvePointerInputSignalEvents({
      trigger,
      coordinates,
      targetSummary,
      recordInputSignal
    });
    pointerSignal = pointerInput.pointerSignal;
    logs.push(...pointerInput.logs);
  }

  const preflight = resolvePointerActivationPreflight({
    viewMode,
    targetElement,
    sourceFirstMode,
    trigger
  });
  logs.push(...preflight.logs);
  if (!preflight.proceed) {
    return {
      proceed: false,
      mode: preflight.mode,
      renderedBlockTarget: preflight.renderedBlockTarget ?? null,
      pointerSignal,
      sourceFirstActivation: null,
      logs
    };
  }

  if (preflight.mode === 'source-first') {
    const rawMappedPosition = typeof resolvePointerPosition === 'function'
      ? resolvePointerPosition(view, targetElement, coordinates)
      : null;
    const sourceFirstActivation = resolveSourceFirstPointerActivation({
      trigger,
      coordinates,
      rawMappedPosition,
      docLength: view?.state?.doc?.length ?? null,
      doc: view?.state?.doc ?? null,
      blocks: typeof liveBlocksForView === 'function' ? liveBlocksForView(view) : [],
      targetTagName: targetElement?.tagName ?? null,
      targetClassName: typeof targetElement?.className === 'string' ? targetElement.className : '',
      readLineInfoForPosition,
      resolveActivationBlockBounds,
      readBlockLineBoundsForLog
    });
    logs.push(...sourceFirstActivation.logs);
    return {
      proceed: false,
      mode: preflight.mode,
      renderedBlockTarget: null,
      pointerSignal,
      sourceFirstActivation,
      logs
    };
  }

  return {
    proceed: true,
    mode: preflight.mode,
    renderedBlockTarget: preflight.renderedBlockTarget ?? null,
    pointerSignal,
    sourceFirstActivation: null,
    logs
  };
}

export function resolveRenderedPointerActivation({
  view = null,
  targetElement = null,
  coordinates = null,
  trigger = null,
  renderedBlockTarget = null,
  liveBlocksForView = null,
  liveSourceMapIndexForView = null,
  readSourceMapIndexForViewFn = readSourceMapIndexForView,
  parseSourceFromAttribute = null,
  resolvePointerPosition = null,
  findRenderedSourceRangeTarget = null,
  resolvePositionFromRenderedSourceRange = null,
  resolveActivationBlockBounds = null,
  resolveLiveBlockSelection = null,
  distanceToBlockBounds = null,
  shouldPreferRenderedDomAnchorPosition = null,
  findBlockContainingPosition = null,
  findNearestBlockForPosition = null,
  readBlockLineBoundsForLog = null,
  readLineInfoForPosition = null,
  isFencedCodeBlock = null,
  buildRenderedPointerProbe = null,
  summarizeLineNumbersForCoordSamples = null,
  shouldPreferSourceFromForRenderedFencedClick = null,
  shouldPreferSourceFromForRenderedBoundaryClick = null,
  normalizeLogString = null,
  livePreviewRenderedDomAnchorStickyMaxPosDelta = 40,
  livePreviewRenderedFencedStickyMaxPosDelta = 12,
  livePreviewRenderedFencedStickyMaxLineDelta = 2,
  livePreviewRenderedBoundaryStickyMaxPosDelta = 30,
  livePreviewRenderedBoundaryStickyMaxLineDelta = 3,
  livePreviewRenderedBoundaryStickyMaxDistanceFromBottomPx = 14,
  livePreviewRenderedBoundaryStickyMinRatioY = 0.3
} = {}) {
  const blocks = typeof liveBlocksForView === 'function'
    ? liveBlocksForView(view)
    : [];
  const sourceMapIndex = typeof readSourceMapIndexForViewFn === 'function'
    ? readSourceMapIndexForViewFn(liveSourceMapIndexForView, view)
    : [];
  const renderedTarget = resolveRenderedActivationTarget({
    targetElement,
    renderedBlockTarget,
    parseSourceFromAttribute,
    trigger
  });
  if (!renderedTarget.renderedBlock || renderedTarget.sourceFrom === null) {
    return {
      activation: null,
      renderedTarget,
      renderedContext: null,
      logs: renderedTarget.logs
    };
  }

  const renderedContext = resolveRenderedActivationContext({
    view,
    targetElement,
    coordinates,
    trigger,
    renderedTarget,
    blocks,
    sourceMapIndex,
    resolvePointerPosition,
    findRenderedSourceRangeTarget,
    resolvePositionFromRenderedSourceRange,
    resolveActivationBlockBounds,
    resolveLiveBlockSelection,
    distanceToBlockBounds,
    shouldPreferRenderedDomAnchorPosition,
    findBlockContainingPosition,
    findNearestBlockForPosition,
    readBlockLineBoundsForLog,
    readLineInfoForPosition,
    isFencedCodeBlock,
    buildRenderedPointerProbe,
    summarizeLineNumbersForCoordSamples,
    shouldPreferSourceFromForRenderedFencedClick,
    shouldPreferSourceFromForRenderedBoundaryClick,
    normalizeLogString,
    livePreviewRenderedDomAnchorStickyMaxPosDelta,
    livePreviewRenderedFencedStickyMaxPosDelta,
    livePreviewRenderedFencedStickyMaxLineDelta,
    livePreviewRenderedBoundaryStickyMaxPosDelta,
    livePreviewRenderedBoundaryStickyMaxLineDelta,
    livePreviewRenderedBoundaryStickyMaxDistanceFromBottomPx,
    livePreviewRenderedBoundaryStickyMinRatioY
  });

  return {
    activation: renderedContext.activation,
    renderedTarget,
    renderedContext,
    logs: [
      ...renderedTarget.logs,
      ...renderedContext.logs
    ]
  };
}

export function resolveRenderedActivationTarget({
  targetElement = null,
  renderedBlockTarget = null,
  parseSourceFromAttribute = null,
  trigger = null
} = {}) {
  const renderedBlock = renderedBlockTarget ?? (
    typeof targetElement?.closest === 'function'
      ? targetElement.closest('.cm-rendered-block')
      : null
  );
  if (!renderedBlock) {
    return {
      renderedBlock: null,
      sourceFrom: null,
      sourceTo: null,
      fragmentFrom: null,
      fragmentTo: null,
      logs: []
    };
  }

  const parseAttribute = typeof parseSourceFromAttribute === 'function'
    ? parseSourceFromAttribute
    : (value) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };
  const sourceFrom = parseAttribute(renderedBlock.getAttribute('data-source-from'));
  if (sourceFrom === null) {
    return {
      renderedBlock,
      sourceFrom: null,
      sourceTo: null,
      fragmentFrom: null,
      fragmentTo: null,
      logs: [
        {
          level: 'warn',
          event: 'block.activate.skipped',
          payload: {
            trigger,
            reason: 'invalid-source-from'
          }
        }
      ]
    };
  }

  return {
    renderedBlock,
    sourceFrom,
    sourceTo: parseAttribute(renderedBlock.getAttribute('data-source-to')),
    fragmentFrom: parseAttribute(renderedBlock.getAttribute('data-fragment-from')),
    fragmentTo: parseAttribute(renderedBlock.getAttribute('data-fragment-to')),
    logs: []
  };
}

export function resolveSourceFirstPointerMapping({
  docLength = null,
  rawMappedPosition = null,
  doc = null,
  blocks = null,
  readLineInfoForPosition = null,
  resolveActivationBlockBounds = null
} = {}) {
  const truncatedMappedPosition = Number.isFinite(rawMappedPosition)
    ? Math.trunc(rawMappedPosition)
    : null;
  const maxDocPosition = Number.isFinite(docLength)
    ? Math.max(0, Math.trunc(docLength))
    : null;
  const mappedPosition = (
    Number.isFinite(truncatedMappedPosition) &&
    Number.isFinite(maxDocPosition)
  )
    ? Math.max(0, Math.min(maxDocPosition, truncatedMappedPosition))
    : null;
  const clamped = (
    Number.isFinite(rawMappedPosition) &&
    Number.isFinite(mappedPosition) &&
    mappedPosition !== rawMappedPosition
  );
  const lineInfo = (
    typeof readLineInfoForPosition === 'function' &&
    doc &&
    Number.isFinite(mappedPosition)
  )
    ? readLineInfoForPosition(doc, mappedPosition)
    : null;
  const mappedBlock = (
    typeof resolveActivationBlockBounds === 'function' &&
    Number.isFinite(mappedPosition)
  )
    ? resolveActivationBlockBounds(
        Array.isArray(blocks) ? blocks : [],
        mappedPosition,
        mappedPosition
      )
    : null;

  return {
    mappedPosition,
    clamped,
    lineInfo,
    mappedBlock
  };
}

export function resolveSourceFirstPointerActivation({
  trigger,
  coordinates = null,
  rawMappedPosition = null,
  docLength = null,
  doc = null,
  blocks = null,
  targetTagName = null,
  targetClassName = null,
  readLineInfoForPosition = null,
  resolveActivationBlockBounds = null,
  readBlockLineBoundsForLog = null
} = {}) {
  const mapping = resolveSourceFirstPointerMapping({
    docLength,
    rawMappedPosition,
    doc,
    blocks,
    readLineInfoForPosition,
    resolveActivationBlockBounds
  });
  const blockLineBounds = (
    typeof readBlockLineBoundsForLog === 'function' &&
    doc
  )
    ? readBlockLineBoundsForLog(doc, mapping.mappedBlock)
    : null;
  const logs = buildSourceFirstPointerLogEvents({
    trigger,
    coordinates,
    rawMappedPosition,
    mappedPosition: mapping.mappedPosition,
    lineInfo: mapping.lineInfo,
    mappedBlock: mapping.mappedBlock,
    blockLineBounds,
    targetTagName,
    targetClassName,
    docLength,
    clamped: mapping.clamped
  });

  return {
    ...mapping,
    blockLineBounds,
    logs
  };
}

export function buildPointerActivationLogPayloads({
  trigger,
  reason = null,
  targetTagName = null,
  targetClassName = null,
  activation = null,
  coordinates = null,
  message = null
} = {}) {
  return {
    activationMiss: {
      trigger,
      reason: reason ?? 'no-element-target'
    },
    passThroughNative: {
      trigger,
      reason: reason ?? 'not-rendered-block-target',
      tagName: targetTagName,
      className: targetClassName
    },
    activationRequest: {
      trigger,
      sourceFrom: activation?.sourceFrom ?? null,
      sourcePos: activation?.sourcePos ?? null,
      rawSourcePos: activation?.rawSourcePos ?? null,
      sourcePosOrigin: activation?.sourcePosOrigin ?? null,
      strategy: activation?.strategy ?? null,
      match: activation?.match ?? null,
      allowCoordinateRemap: activation?.allowCoordinateRemap !== false,
      blockFrom: activation?.blockBounds?.from ?? null,
      blockTo: activation?.blockBounds?.to ?? null,
      pointerProbe: activation?.pointerProbe ?? null,
      x: Number.isFinite(coordinates?.x) ? coordinates.x : null,
      y: Number.isFinite(coordinates?.y) ? coordinates.y : null
    },
    activationFailed: {
      trigger,
      message,
      sourceFrom: activation?.sourceFrom ?? null,
      sourcePos: activation?.sourcePos ?? null
    }
  };
}

export function buildPointerActivationEvents({
  trigger,
  activation = null,
  coordinates = null,
  message = null
} = {}) {
  const payloads = buildPointerActivationLogPayloads({
    trigger,
    activation,
    coordinates,
    message
  });

  return {
    request: [
      {
        level: 'trace',
        event: 'block.activate.request',
        payload: payloads.activationRequest
      }
    ],
    failed: [
      {
        level: 'error',
        event: 'block.activate.failed',
        payload: payloads.activationFailed
      }
    ]
  };
}

export function resolvePointerActivationDispatch({
  trigger = null,
  activation = null,
  coordinates = null,
  beforeActivate = null,
  activate = null
} = {}) {
  if (!activation) {
    return {
      handled: false,
      shouldPreventDefault: false,
      logs: []
    };
  }

  const requestLogs = buildPointerActivationEvents({
    trigger,
    activation,
    coordinates
  }).request;

  if (typeof beforeActivate === 'function') {
    beforeActivate();
  }

  if (typeof activate !== 'function') {
    return {
      handled: true,
      shouldPreventDefault: true,
      logs: requestLogs
    };
  }

  try {
    activate();
    return {
      handled: true,
      shouldPreventDefault: true,
      logs: requestLogs
    };
  } catch (error) {
    const failedLogs = buildPointerActivationEvents({
      trigger,
      activation,
      message: error instanceof Error ? error.message : String(error)
    }).failed;
    return {
      handled: false,
      shouldPreventDefault: true,
      logs: [
        ...requestLogs,
        ...failedLogs
      ],
      error
    };
  }
}

export function buildBlockActivationDispatchLogPayloads({
  trigger,
  sourceFrom,
  baseSelection,
  preferredSelection = null,
  baseSelectionLineInfo = null,
  allowCoordinateRemap = true,
  strategy = null,
  blockBounds = null,
  message = null
} = {}) {
  return {
    dispatchFailed: {
      trigger,
      sourceFrom,
      selection: baseSelection,
      message
    },
    activated: {
      trigger,
      sourceFrom,
      selection: baseSelection,
      preferredSelection: Number.isFinite(preferredSelection) ? preferredSelection : null,
      baseSelectionLineInfo,
      allowCoordinateRemap,
      strategy,
      blockFrom: blockBounds?.from ?? null,
      blockTo: blockBounds?.to ?? null
    }
  };
}

export function buildBlockActivationDispatchEvents({
  dispatchLogPayloads = null
} = {}) {
  if (!dispatchLogPayloads) {
    return {
      dispatchFailed: [],
      activated: []
    };
  }

  return {
    dispatchFailed: [
      {
        level: 'error',
        event: 'block.activate.dispatch-failed',
        payload: dispatchLogPayloads.dispatchFailed
      }
    ],
    activated: [
      {
        level: 'trace',
        event: 'block.activated',
        payload: dispatchLogPayloads.activated
      }
    ]
  };
}

export function resolveBlockActivationSelectionContext({
  doc = null,
  docLength = null,
  sourceFrom = null,
  preferredSelection = null,
  blockBounds = null,
  resolveLiveBlockSelection = null,
  readLineInfoForPosition = null
} = {}) {
  const resolvedDocLength = Number.isFinite(docLength)
    ? docLength
    : (Number.isFinite(doc?.length) ? doc.length : null);
  const preferredPos = Number.isFinite(preferredSelection)
    ? preferredSelection
    : sourceFrom;
  const baseSelection = typeof resolveLiveBlockSelection === 'function'
    ? resolveLiveBlockSelection(resolvedDocLength, sourceFrom, preferredPos, blockBounds)
    : preferredPos;
  const baseSelectionLineInfo = (
    typeof readLineInfoForPosition === 'function' &&
    doc &&
    Number.isFinite(baseSelection)
  )
    ? readLineInfoForPosition(doc, baseSelection)
    : null;

  return {
    docLength: resolvedDocLength,
    preferredPos,
    baseSelection,
    baseSelectionLineInfo
  };
}

export function resolveBlockActivationDispatch({
  trigger = null,
  sourceFrom = null,
  baseSelection = null,
  preferredSelection = null,
  baseSelectionLineInfo = null,
  allowCoordinateRemap = true,
  strategy = null,
  blockBounds = null,
  dispatchActivate = null
} = {}) {
  if (typeof dispatchActivate !== 'function') {
    return {
      handled: false,
      logs: [],
      error: new TypeError('dispatchActivate must be a function')
    };
  }

  try {
    dispatchActivate();
  } catch (error) {
    const dispatchLogPayloads = buildBlockActivationDispatchLogPayloads({
      trigger,
      sourceFrom,
      baseSelection,
      message: error instanceof Error ? error.message : String(error)
    });
    const dispatchLogEvents = buildBlockActivationDispatchEvents({
      dispatchLogPayloads
    });
    return {
      handled: false,
      logs: dispatchLogEvents.dispatchFailed,
      error
    };
  }

  const dispatchLogPayloads = buildBlockActivationDispatchLogPayloads({
    trigger,
    sourceFrom,
    baseSelection,
    preferredSelection,
    baseSelectionLineInfo,
    allowCoordinateRemap,
    strategy,
    blockBounds
  });
  const dispatchLogEvents = buildBlockActivationDispatchEvents({
    dispatchLogPayloads
  });

  return {
    handled: true,
    logs: dispatchLogEvents.activated
  };
}
