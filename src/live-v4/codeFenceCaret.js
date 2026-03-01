export function isCodeFenceLineText(lineText) {
  return /^\s*[`~]{3,}/.test(String(lineText ?? ''));
}

function clampToDoc(doc, value) {
  if (!doc || !Number.isFinite(value)) {
    return null;
  }
  const max = Math.max(0, Math.trunc(doc.length));
  return Math.max(0, Math.min(max, Math.trunc(value)));
}

export function resolveCodeFenceCaretPosition(doc, lineFrom, lineTo) {
  const fallback = clampToDoc(doc, lineTo);
  if (!doc || !Number.isFinite(lineFrom) || !Number.isFinite(lineTo)) {
    return fallback;
  }

  const clampedFrom = clampToDoc(doc, lineFrom);
  if (!Number.isFinite(clampedFrom) || typeof doc.lineAt !== 'function') {
    return fallback;
  }

  const line = doc.lineAt(clampedFrom);
  if (!line || !Number.isFinite(line.from) || !Number.isFinite(line.to)) {
    return fallback;
  }

  const lineText = doc.sliceString(line.from, line.to);
  if (!isCodeFenceLineText(lineText)) {
    return fallback;
  }

  const visibleFenceText = lineText.replace(/\s+$/, '');
  const visibleLength = visibleFenceText.length;
  const candidate = line.from + visibleLength;
  const boundedToLine = Math.max(line.from, Math.min(line.to, candidate));
  return clampToDoc(doc, boundedToLine);
}
