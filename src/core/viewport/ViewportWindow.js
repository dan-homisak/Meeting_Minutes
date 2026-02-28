function clampInteger(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }

  const resolved = Math.trunc(value);
  if (resolved < min) {
    return min;
  }
  if (resolved > max) {
    return max;
  }
  return resolved;
}

function normalizeRange(range, docLength) {
  if (!range || !Number.isFinite(range.from) || !Number.isFinite(range.to)) {
    return null;
  }

  const from = clampInteger(range.from, 0, docLength);
  const to = clampInteger(range.to, from, docLength);
  if (to <= from) {
    return null;
  }

  return {
    from,
    to
  };
}

function resolveVisibleRange(docLength, visibleRanges, viewport) {
  const normalizedRanges = [];
  if (Array.isArray(visibleRanges)) {
    for (const range of visibleRanges) {
      const normalized = normalizeRange(range, docLength);
      if (normalized) {
        normalizedRanges.push(normalized);
      }
    }
  }

  if (normalizedRanges.length === 0) {
    const normalizedViewport = normalizeRange(viewport, docLength);
    if (normalizedViewport) {
      normalizedRanges.push(normalizedViewport);
    }
  }

  if (normalizedRanges.length === 0) {
    return {
      rangeCount: 0,
      sourceFrom: 0,
      sourceTo: docLength
    };
  }

  let sourceFrom = normalizedRanges[0].from;
  let sourceTo = normalizedRanges[0].to;
  for (let index = 1; index < normalizedRanges.length; index += 1) {
    const range = normalizedRanges[index];
    sourceFrom = Math.min(sourceFrom, range.from);
    sourceTo = Math.max(sourceTo, range.to);
  }

  return {
    rangeCount: normalizedRanges.length,
    sourceFrom,
    sourceTo
  };
}

export function buildViewportWindow({
  doc,
  viewport = null,
  visibleRanges = [],
  activeLineNumber = Number.NaN,
  lineBuffer = 8,
  minimumLineSpan = 24
} = {}) {
  if (!doc || typeof doc.lineAt !== 'function' || !Number.isFinite(doc.lines)) {
    return {
      enabled: false,
      rangeCount: 0,
      sourceFrom: 0,
      sourceTo: 0,
      viewportSourceFrom: 0,
      viewportSourceTo: 0,
      lineFrom: 1,
      lineTo: 1,
      visibleLineFrom: 1,
      visibleLineTo: 1
    };
  }

  const docLength = Number.isFinite(doc.length) ? Math.max(0, Math.trunc(doc.length)) : 0;
  const clampedLineBuffer = Math.max(0, Math.trunc(lineBuffer));
  const clampedMinimumLineSpan = Math.max(1, Math.trunc(minimumLineSpan));
  const visibleRange = resolveVisibleRange(docLength, visibleRanges, viewport);

  if (docLength === 0) {
    return {
      enabled: true,
      rangeCount: visibleRange.rangeCount,
      sourceFrom: 0,
      sourceTo: 0,
      viewportSourceFrom: 0,
      viewportSourceTo: 0,
      lineFrom: 1,
      lineTo: 1,
      visibleLineFrom: 1,
      visibleLineTo: 1
    };
  }

  const clampedVisibleFrom = clampInteger(visibleRange.sourceFrom, 0, docLength);
  const clampedVisibleTo = clampInteger(visibleRange.sourceTo, clampedVisibleFrom, docLength);
  const visibleLineFrom = doc.lineAt(clampedVisibleFrom).number;
  const visibleLineToPosition = clampInteger(Math.max(clampedVisibleFrom, clampedVisibleTo - 1), 0, docLength);
  const visibleLineTo = doc.lineAt(visibleLineToPosition).number;
  const visibleSpan = Math.max(1, visibleLineTo - visibleLineFrom + 1);
  const missingLinesForMinimum = Math.max(0, clampedMinimumLineSpan - visibleSpan);
  const minimumPadBefore = Math.floor(missingLinesForMinimum / 2);
  const minimumPadAfter = missingLinesForMinimum - minimumPadBefore;

  let lineFrom = visibleLineFrom - clampedLineBuffer - minimumPadBefore;
  let lineTo = visibleLineTo + clampedLineBuffer + minimumPadAfter;
  lineFrom = clampInteger(lineFrom, 1, doc.lines);
  lineTo = clampInteger(lineTo, lineFrom, doc.lines);

  if (Number.isFinite(activeLineNumber)) {
    const clampedActiveLine = clampInteger(activeLineNumber, 1, doc.lines);
    if (clampedActiveLine < lineFrom) {
      lineFrom = clampInteger(clampedActiveLine - clampedLineBuffer, 1, doc.lines);
      lineTo = Math.max(lineTo, clampedActiveLine);
    } else if (clampedActiveLine > lineTo) {
      lineTo = clampInteger(clampedActiveLine + clampedLineBuffer, 1, doc.lines);
      lineFrom = Math.min(lineFrom, clampedActiveLine);
    }
  }

  const sourceFrom = doc.line(lineFrom).from;
  const sourceTo = doc.line(lineTo).to;

  return {
    enabled: true,
    rangeCount: visibleRange.rangeCount,
    sourceFrom,
    sourceTo,
    viewportSourceFrom: clampedVisibleFrom,
    viewportSourceTo: clampedVisibleTo,
    lineFrom,
    lineTo,
    visibleLineFrom,
    visibleLineTo
  };
}
