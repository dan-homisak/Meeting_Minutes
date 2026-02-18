export function createLiveLineMappingHelpers({
  normalizeLogString
} = {}) {
  const normalizeText =
    typeof normalizeLogString === 'function'
      ? normalizeLogString
      : (value, maxLength = 120) => String(value ?? '').slice(0, maxLength);

  function clampNumber(value, min, max) {
    if (!Number.isFinite(value)) {
      return null;
    }

    if (value < min) {
      return min;
    }

    if (value > max) {
      return max;
    }

    return value;
  }

  function readLineInfoForPosition(doc, position) {
    if (!doc || !Number.isFinite(position)) {
      return null;
    }

    const clampedPos = Math.max(0, Math.min(doc.length, Math.trunc(position)));
    const line = doc.lineAt(clampedPos);
    return {
      position: clampedPos,
      lineNumber: line.number,
      lineFrom: line.from,
      lineTo: line.to,
      lineLength: Math.max(0, line.to - line.from),
      column: Math.max(0, clampedPos - line.from),
      lineTextPreview: normalizeText(doc.sliceString(line.from, line.to), 100)
    };
  }

  function readBlockLineBoundsForLog(doc, blockBounds) {
    if (
      !doc ||
      !blockBounds ||
      !Number.isFinite(blockBounds.from) ||
      !Number.isFinite(blockBounds.to)
    ) {
      return null;
    }

    const from = Math.min(blockBounds.from, blockBounds.to);
    const to = Math.max(blockBounds.from, blockBounds.to);
    if (to <= from) {
      return null;
    }

    const startLine = doc.lineAt(from);
    const endLine = doc.lineAt(Math.max(from, to - 1));
    return {
      startLineNumber: startLine.number,
      startLineFrom: startLine.from,
      endLineNumber: endLine.number,
      endLineTo: endLine.to,
      lineCount: Math.max(1, endLine.number - startLine.number + 1)
    };
  }

  return {
    clampNumber,
    readLineInfoForPosition,
    readBlockLineBoundsForLog
  };
}
