function clampRange(from, to, maxLength) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(maxLength)) {
    return null;
  }
  const max = Math.max(0, Math.trunc(maxLength));
  const rangeFrom = Math.max(0, Math.min(max, Math.trunc(from)));
  const rangeTo = Math.max(rangeFrom, Math.min(max, Math.trunc(to)));
  if (rangeTo <= rangeFrom) {
    return null;
  }
  return {
    from: rangeFrom,
    to: rangeTo
  };
}

const MARKER_PATTERNS = [
  { markerType: 'heading-marker', regex: /^\s{0,3}#{1,6}\s+/ },
  { markerType: 'list-marker', regex: /^\s*(?:[-+*]|\d+\.)(?:\s+|$)/ },
  { markerType: 'task-marker', regex: /^\s*(?:[-+*]|\d+\.)\s+\[(?: |x|X)\](?:\s+|$)/ },
  { markerType: 'quote-marker', regex: /^\s*>\s?/ },
  { markerType: 'fence-marker', regex: /^\s*[`~]{3,}/ }
];

export function collectMarkerEntriesForBlock(doc, block) {
  if (!doc || !block || !Number.isFinite(block.from) || !Number.isFinite(block.to)) {
    return [];
  }

  const blockFrom = Math.max(0, Math.trunc(block.from));
  const blockTo = Math.max(blockFrom, Math.trunc(block.to));
  if (blockTo <= blockFrom) {
    return [];
  }

  const entries = [];
  let cursor = blockFrom;

  while (cursor < blockTo) {
    const line = doc.lineAt(cursor);
    const lineFrom = Math.max(blockFrom, line.from);
    const lineTo = Math.min(blockTo, line.to);
    const lineText = doc.sliceString(lineFrom, lineTo);

    for (const pattern of MARKER_PATTERNS) {
      const match = lineText.match(pattern.regex);
      if (!match || typeof match[0] !== 'string' || match[0].length === 0) {
        continue;
      }

      const markerRange = clampRange(lineFrom, lineFrom + match[0].length, doc.length);
      if (!markerRange) {
        continue;
      }

      entries.push({
        kind: 'marker',
        markerType: pattern.markerType,
        blockId: block.id,
        fragmentId: `marker-${pattern.markerType}-${markerRange.from}-${markerRange.to}`,
        sourceFrom: markerRange.from,
        sourceTo: markerRange.to,
        priority: 260
      });
    }

    if (line.to >= blockTo) {
      break;
    }

    cursor = line.to + 1;
  }

  return entries;
}
