import { findSourceMapEntriesAtPosition } from '../mapping/SourceMapIndex.js';

export function readSourceMapIndexForView(liveSourceMapIndexForView, view) {
  if (typeof liveSourceMapIndexForView !== 'function') {
    return [];
  }

  const sourceMapIndex = liveSourceMapIndexForView(view);
  return Array.isArray(sourceMapIndex) ? sourceMapIndex : [];
}

function findSourceMapBlockAtPosition(sourceMapIndex, position, nearestTolerance = 1) {
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

function clampCursorPositionToSourceMapBlock(position, blockEntry) {
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

function buildVerticalCursorMoveLogPayloads({
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

function buildSourceFirstPointerLogPayloads({
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

function buildSourceFirstPointerLogEvents({
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

function buildPointerInputSignalPayload({
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

function buildPointerInputTraceEvent({
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

function resolvePointerInputSignalEvents({
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

function resolvePointerActivationPreflight({
  viewMode = null,
  targetElement = null,
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
    return {
      proceed: false,
      mode: 'miss',
      renderedBlockTarget: null,
      logs: [
        {
          level: 'trace',
          event: 'block.activate.miss',
          payload: {
            trigger,
            reason: 'no-element-target'
          }
        }
      ]
    };
  }

  return {
    proceed: true,
    mode: 'source-first',
    renderedBlockTarget: null,
    logs: []
  };
}

function resolveSourceFirstPointerMapping({
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

function resolveSourceFirstPointerActivation({
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

export function resolvePointerActivationIntent({
  viewMode = null,
  trigger = null,
  targetElement = null,
  coordinates = null,
  targetSummary = null,
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
