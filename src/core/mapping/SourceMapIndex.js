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
    `${entry.fragmentFrom}:${entry.fragmentTo}`,
    `${entry.priority}`
  ].join('|');
}

function normalizeBlockEntry(block, activeLine, index) {
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
    blockId:
      typeof block?.id === 'string' && block.id.length > 0
        ? block.id
        : `block-${index}-${blockRange.from}-${blockRange.to}`,
    fragmentId: null,
    sourceFrom: blockRange.from,
    sourceTo: blockRange.to,
    blockFrom: blockRange.from,
    blockTo: blockRange.to,
    fragmentFrom: blockRange.from,
    fragmentTo: blockRange.to,
    domPathHint: null,
    priority: 0,
    active: activeIntersectsBlock
  };
}

function normalizeFragmentEntry(fragment, index) {
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
    blockId:
      typeof fragment?.blockId === 'string' && fragment.blockId.length > 0
        ? fragment.blockId
        : `fragment-block-${index}-${blockRange.from}-${blockRange.to}`,
    fragmentId:
      typeof fragment?.fragmentId === 'string' && fragment.fragmentId.length > 0
        ? fragment.fragmentId
        : `fragment-${index}-${fragmentRange.from}-${fragmentRange.to}`,
    sourceFrom: fragmentRange.from,
    sourceTo: fragmentRange.to,
    blockFrom: blockRange.from,
    blockTo: blockRange.to,
    fragmentFrom: fragmentRange.from,
    fragmentTo: fragmentRange.to,
    domPathHint:
      typeof fragment?.domPathHint === 'string' && fragment.domPathHint.length > 0
        ? fragment.domPathHint
        : null,
    priority: Number.isFinite(fragment?.priority) ? Math.trunc(fragment.priority) : 100,
    active: false
  };
}

function sortSourceMapEntries(left, right) {
  return (
    left.sourceFrom - right.sourceFrom ||
    left.sourceTo - right.sourceTo ||
    left.priority - right.priority ||
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
    for (let index = 0; index < blocks.length; index += 1) {
      const blockEntry = normalizeBlockEntry(blocks[index], activeLine, index);
      if (blockEntry) {
        entries.push(blockEntry);
      }
    }
  }

  if (Array.isArray(renderedFragments)) {
    for (let index = 0; index < renderedFragments.length; index += 1) {
      const fragmentEntry = normalizeFragmentEntry(renderedFragments[index], index);
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
