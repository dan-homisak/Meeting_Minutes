export function createPointerProbeGeometry({
  normalizeLogString,
  readLineInfoForPosition,
  windowObject = window,
  elementConstructor = typeof Element === 'function' ? Element : null
} = {}) {
  const normalizeText =
    typeof normalizeLogString === 'function'
      ? normalizeLogString
      : (value, maxLength = 120) => String(value ?? '').slice(0, maxLength);
  const readLineInfo =
    typeof readLineInfoForPosition === 'function'
      ? readLineInfoForPosition
      : () => null;

  function summarizeRectForLog(rect) {
    if (!rect) {
      return null;
    }

    return {
      left: Number(rect.left.toFixed(2)),
      top: Number(rect.top.toFixed(2)),
      right: Number(rect.right.toFixed(2)),
      bottom: Number(rect.bottom.toFixed(2)),
      width: Number(rect.width.toFixed(2)),
      height: Number(rect.height.toFixed(2))
    };
  }

  function readComputedStyleSnapshotForLog(element) {
    if (!elementConstructor || !(element instanceof elementConstructor)) {
      return null;
    }

    try {
      const style = windowObject.getComputedStyle(element);
      return {
        display: style.display,
        position: style.position,
        whiteSpace: style.whiteSpace,
        lineHeight: style.lineHeight,
        fontSize: style.fontSize,
        marginTop: style.marginTop,
        marginBottom: style.marginBottom,
        paddingTop: style.paddingTop,
        paddingBottom: style.paddingBottom,
        overflowY: style.overflowY
      };
    } catch {
      return null;
    }
  }

  function resolvePosAtCoordsSafe(view, coordinates) {
    if (!coordinates) {
      return null;
    }

    try {
      const mappedPos = view.posAtCoords(coordinates);
      return Number.isFinite(mappedPos) ? mappedPos : null;
    } catch {
      return null;
    }
  }

  function buildCoordSamples(view, samples) {
    const doc = view?.state?.doc;
    if (!doc || !Array.isArray(samples) || samples.length === 0) {
      return [];
    }

    const results = [];
    for (const sample of samples) {
      if (!sample || !Number.isFinite(sample.x) || !Number.isFinite(sample.y)) {
        continue;
      }

      const position = resolvePosAtCoordsSafe(view, sample);
      const lineInfo = readLineInfo(doc, position);
      results.push({
        label: sample.label,
        x: Number(sample.x.toFixed(2)),
        y: Number(sample.y.toFixed(2)),
        position,
        lineNumber: lineInfo?.lineNumber ?? null,
        column: lineInfo?.column ?? null
      });
    }

    return results;
  }

  function summarizeLineNumbersForCoordSamples(samples) {
    if (!Array.isArray(samples) || samples.length === 0) {
      return [];
    }

    const lineNumbers = [];
    for (const sample of samples) {
      const lineNumber = sample?.lineNumber;
      if (!Number.isFinite(lineNumber) || lineNumbers.includes(lineNumber)) {
        continue;
      }
      lineNumbers.push(lineNumber);
    }

    return lineNumbers;
  }

  return {
    summarizeRectForLog,
    readComputedStyleSnapshotForLog,
    resolvePosAtCoordsSafe,
    buildCoordSamples,
    summarizeLineNumbersForCoordSamples,
    normalizeText
  };
}
