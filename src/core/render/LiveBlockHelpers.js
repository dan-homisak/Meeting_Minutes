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

export function blockContainsLine(block, line) {
  return line.from < block.to && line.to >= block.from;
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
