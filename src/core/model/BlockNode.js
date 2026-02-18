function normalizeRange(range, maxLength = Number.POSITIVE_INFINITY) {
  if (!range || !Number.isFinite(range.from) || !Number.isFinite(range.to)) {
    return null;
  }

  const clampedMax = Number.isFinite(maxLength) ? Math.max(0, Math.trunc(maxLength)) : Number.POSITIVE_INFINITY;
  const from = Math.max(0, Math.trunc(range.from));
  const to = Math.min(clampedMax, Math.max(from, Math.trunc(range.to)));
  if (to <= from) {
    return null;
  }

  return { from, to };
}

export function createBlockNode(range, index, previousId = null, nextId = null) {
  const normalizedRange = normalizeRange(range);
  if (!normalizedRange) {
    return null;
  }

  const nodeIndex = Number.isFinite(index) ? Math.max(0, Math.trunc(index)) : 0;
  const id = `${normalizedRange.from}:${normalizedRange.to}`;
  return {
    id,
    index: nodeIndex,
    from: normalizedRange.from,
    to: normalizedRange.to,
    previousId,
    nextId
  };
}

export function createBlockGraphFromRanges(blockRanges, maxLength = Number.POSITIVE_INFINITY) {
  if (!Array.isArray(blockRanges) || blockRanges.length === 0) {
    return [];
  }

  const normalized = [];
  for (const range of blockRanges) {
    const nextRange = normalizeRange(range, maxLength);
    if (!nextRange) {
      continue;
    }
    normalized.push(nextRange);
  }

  normalized.sort((left, right) => left.from - right.from || left.to - right.to);

  const graph = [];
  for (let index = 0; index < normalized.length; index += 1) {
    const previous = graph[graph.length - 1] ?? null;
    const node = createBlockNode(
      normalized[index],
      index,
      previous?.id ?? null,
      null
    );
    if (!node) {
      continue;
    }

    if (previous) {
      previous.nextId = node.id;
    }

    graph.push(node);
  }

  return graph;
}
