function parseFenceMarker(lineText) {
  if (typeof lineText !== 'string') {
    return null;
  }

  const match = lineText.match(/^\s*([`~]{3,})/);
  if (!match) {
    return null;
  }

  const marker = match[1];
  return {
    marker,
    markerChar: marker[0],
    markerLength: marker.length
  };
}

export function buildRenderedFragment(doc, from, to, renderMarkdownHtml) {
  if (to <= from) {
    return null;
  }

  const source = doc.sliceString(from, to);
  if (!source.trim()) {
    return null;
  }

  return {
    from,
    to,
    html: renderMarkdownHtml(source, from, to)
  };
}

export function blockContainsLine(block, line) {
  return line.from < block.to && line.to >= block.from;
}

export function splitBlockAroundActiveLine(doc, block, activeLine, renderMarkdownHtml) {
  if (!blockContainsLine(block, activeLine)) {
    const whole = buildRenderedFragment(doc, block.from, block.to, renderMarkdownHtml);
    return whole ? [whole] : [];
  }

  const fragments = [];
  const before = buildRenderedFragment(
    doc,
    block.from,
    Math.min(block.to, activeLine.from),
    renderMarkdownHtml
  );
  if (before) {
    fragments.push(before);
  }

  let afterStart = Math.max(block.from, activeLine.to);
  if (afterStart < block.to && doc.sliceString(afterStart, afterStart + 1) === '\n') {
    afterStart += 1;
  }

  const after = buildRenderedFragment(doc, afterStart, block.to, renderMarkdownHtml);
  if (after) {
    fragments.push(after);
  }

  return fragments;
}

export function isFencedCodeBlock(doc, block) {
  if (
    !doc ||
    !block ||
    !Number.isFinite(block.from) ||
    !Number.isFinite(block.to)
  ) {
    return false;
  }

  const from = Math.max(0, Math.min(block.from, block.to));
  const to = Math.min(doc.length, Math.max(block.from, block.to));
  if (to <= from) {
    return false;
  }

  const firstLine = doc.lineAt(from);
  const lastLine = doc.lineAt(Math.max(from, to - 1));
  const firstLineText = doc.sliceString(firstLine.from, firstLine.to);
  const lastLineText = doc.sliceString(lastLine.from, lastLine.to);
  const startFence = parseFenceMarker(firstLineText);
  const endFence = parseFenceMarker(lastLineText);

  if (!startFence || !endFence) {
    return false;
  }

  return (
    startFence.markerChar === endFence.markerChar &&
    endFence.markerLength >= startFence.markerLength
  );
}

export function shouldSkipEmptyTrailingBoundaryBlock(activeLine, block, _blockIsFencedCode = false) {
  if (
    !activeLine ||
    !block ||
    !Number.isFinite(activeLine.from) ||
    !Number.isFinite(activeLine.to) ||
    !Number.isFinite(block.to)
  ) {
    return false;
  }

  const activeLineLength = Math.max(0, activeLine.to - activeLine.from);
  if (activeLineLength !== 0) {
    return false;
  }

  if (block.to !== activeLine.from) {
    return false;
  }

  // Rendering a block while the caret sits on its trailing empty boundary line
  // can collapse the active line and push the cursor to the far right.
  return true;
}
