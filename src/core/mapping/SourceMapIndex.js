function normalizeRange(range, keyFrom = 'from', keyTo = 'to') {
  if (!range || !Number.isFinite(range[keyFrom]) || !Number.isFinite(range[keyTo])) {
    return null;
  }

  const from = Math.max(0, Math.trunc(range[keyFrom]));
  const to = Math.max(from, Math.trunc(range[keyTo]));
  if (to <= from) {
    return null;
  }

  return {
    from,
    to
  };
}

function buildEntryId(entry) {
  return [
    entry.kind,
    `${entry.sourceFrom}:${entry.sourceTo}`,
    `${entry.blockFrom}:${entry.blockTo}`,
    `${entry.fragmentFrom}:${entry.fragmentTo}`
  ].join('|');
}

function normalizeBlockEntry(block, activeLine) {
  const blockRange = normalizeRange(block, 'from', 'to');
  if (!blockRange) {
    return null;
  }

  const activeRange = normalizeRange(activeLine, 'from', 'to');
  const activeIntersectsBlock =
    !!activeRange &&
    activeRange.from < blockRange.to &&
    activeRange.to > blockRange.from;

  return {
    kind: 'block',
    sourceFrom: blockRange.from,
    sourceTo: blockRange.to,
    blockFrom: blockRange.from,
    blockTo: blockRange.to,
    fragmentFrom: blockRange.from,
    fragmentTo: blockRange.to,
    active: activeIntersectsBlock
  };
}

function normalizeFragmentEntry(fragment) {
  if (!fragment) {
    return null;
  }

  const fragmentRange = normalizeRange(fragment, 'from', 'to');
  const blockRange = normalizeRange(
    {
      from: fragment.blockFrom,
      to: fragment.blockTo
    },
    'from',
    'to'
  );
  if (!fragmentRange || !blockRange) {
    return null;
  }

  return {
    kind: 'rendered-fragment',
    sourceFrom: fragmentRange.from,
    sourceTo: fragmentRange.to,
    blockFrom: blockRange.from,
    blockTo: blockRange.to,
    fragmentFrom: fragmentRange.from,
    fragmentTo: fragmentRange.to,
    active: false
  };
}

function sortSourceMapEntries(left, right) {
  return (
    left.sourceFrom - right.sourceFrom ||
    left.sourceTo - right.sourceTo ||
    left.blockFrom - right.blockFrom ||
    left.blockTo - right.blockTo ||
    left.fragmentFrom - right.fragmentFrom ||
    left.fragmentTo - right.fragmentTo ||
    left.kind.localeCompare(right.kind)
  );
}

export function buildSourceMapIndex({
  blocks = [],
  renderedFragments = [],
  activeLine = null
} = {}) {
  const entries = [];

  if (Array.isArray(blocks)) {
    for (const block of blocks) {
      const blockEntry = normalizeBlockEntry(block, activeLine);
      if (blockEntry) {
        entries.push(blockEntry);
      }
    }
  }

  if (Array.isArray(renderedFragments)) {
    for (const fragment of renderedFragments) {
      const fragmentEntry = normalizeFragmentEntry(fragment);
      if (fragmentEntry) {
        entries.push(fragmentEntry);
      }
    }
  }

  entries.sort(sortSourceMapEntries);

  const deduped = [];
  const seen = new Set();
  for (const entry of entries) {
    const id = buildEntryId(entry);
    if (seen.has(id)) {
      continue;
    }

    seen.add(id);
    deduped.push({
      id,
      ...entry
    });
  }

  return deduped;
}

export function findSourceMapEntriesAtPosition(sourceMapIndex, position) {
  if (!Array.isArray(sourceMapIndex) || !Number.isFinite(position)) {
    return [];
  }

  const pos = Math.trunc(position);
  return sourceMapIndex.filter(
    (entry) =>
      entry &&
      Number.isFinite(entry.sourceFrom) &&
      Number.isFinite(entry.sourceTo) &&
      pos >= entry.sourceFrom &&
      pos < entry.sourceTo
  );
}
