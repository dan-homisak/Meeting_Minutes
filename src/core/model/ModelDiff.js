function toRangeKey(range) {
  if (!range || !Number.isFinite(range.from) || !Number.isFinite(range.to)) {
    return null;
  }

  const from = Math.max(0, Math.trunc(range.from));
  const to = Math.max(from, Math.trunc(range.to));
  if (to <= from) {
    return null;
  }

  return `${from}:${to}`;
}

function collectRangeBounds(ranges) {
  if (!Array.isArray(ranges) || ranges.length === 0) {
    return null;
  }

  let minFrom = Number.POSITIVE_INFINITY;
  let maxTo = Number.NEGATIVE_INFINITY;

  for (const range of ranges) {
    if (!range || !Number.isFinite(range.from) || !Number.isFinite(range.to)) {
      continue;
    }

    minFrom = Math.min(minFrom, Math.trunc(range.from));
    maxTo = Math.max(maxTo, Math.trunc(range.to));
  }

  if (!Number.isFinite(minFrom) || !Number.isFinite(maxTo) || maxTo <= minFrom) {
    return null;
  }

  return {
    from: minFrom,
    to: maxTo
  };
}

export function diffDocModels(previousModel, nextModel) {
  const previous = previousModel && typeof previousModel === 'object' ? previousModel : null;
  const next = nextModel && typeof nextModel === 'object' ? nextModel : null;

  const previousBlocks = Array.isArray(previous?.blocks) ? previous.blocks : [];
  const nextBlocks = Array.isArray(next?.blocks) ? next.blocks : [];
  const previousInlineSpans = Array.isArray(previous?.inlineSpans) ? previous.inlineSpans : [];
  const nextInlineSpans = Array.isArray(next?.inlineSpans) ? next.inlineSpans : [];

  const previousKeys = new Set();
  for (const block of previousBlocks) {
    const key = toRangeKey(block);
    if (key) {
      previousKeys.add(key);
    }
  }

  const nextKeys = new Set();
  for (const block of nextBlocks) {
    const key = toRangeKey(block);
    if (key) {
      nextKeys.add(key);
    }
  }

  const addedRanges = [];
  const removedRanges = [];

  for (const block of nextBlocks) {
    const key = toRangeKey(block);
    if (key && !previousKeys.has(key)) {
      addedRanges.push(block);
    }
  }

  for (const block of previousBlocks) {
    const key = toRangeKey(block);
    if (key && !nextKeys.has(key)) {
      removedRanges.push(block);
    }
  }

  const changeRanges = [...addedRanges, ...removedRanges];
  const changedRange = collectRangeBounds(changeRanges);
  const textChanged = (previous?.text ?? '') !== (next?.text ?? '');
  const inlineSpanDelta = nextInlineSpans.length - previousInlineSpans.length;
  const blockDelta = nextBlocks.length - previousBlocks.length;

  return {
    textChanged,
    blockChanged: addedRanges.length > 0 || removedRanges.length > 0,
    blockAddedCount: addedRanges.length,
    blockRemovedCount: removedRanges.length,
    blockDelta,
    inlineSpanDelta,
    previousBlockCount: previousBlocks.length,
    nextBlockCount: nextBlocks.length,
    changedRange
  };
}
