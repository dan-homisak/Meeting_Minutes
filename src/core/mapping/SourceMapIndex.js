function clampRange(from, to) {
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return null;
  }
  const normalizedFrom = Math.max(0, Math.trunc(from));
  const normalizedTo = Math.max(normalizedFrom, Math.trunc(to));
  if (normalizedTo <= normalizedFrom) {
    return null;
  }
  return {
    from: normalizedFrom,
    to: normalizedTo
  };
}

function readLineNumber(entry, fallbackRange) {
  if (Number.isFinite(entry?.lineNumber)) {
    return Math.max(1, Math.trunc(entry.lineNumber));
  }
  if (Number.isFinite(entry?.lineFrom)) {
    return Math.max(1, Math.trunc(entry.lineFrom));
  }
  if (fallbackRange) {
    return null;
  }
  return null;
}

function normalizeBlockEntry(block, index, activeLineRange = null) {
  const range = clampRange(block?.from, block?.to);
  if (!range) {
    return null;
  }
  const active = Boolean(
    activeLineRange &&
      Number.isFinite(activeLineRange.from) &&
      Number.isFinite(activeLineRange.to) &&
      activeLineRange.from < range.to &&
      activeLineRange.to > range.from
  );
  const blockId =
    typeof block?.id === 'string' && block.id.length > 0
      ? block.id
      : `block-${index}-${range.from}-${range.to}`;
  return {
    kind: 'block',
    blockId,
    fragmentId: null,
    sourceFrom: range.from,
    sourceTo: range.to,
    lineNumber: readLineNumber(block, range),
    priority: 0,
    active
  };
}

function normalizeFragmentEntry(fragment, index) {
  const range = clampRange(fragment?.sourceFrom ?? fragment?.from, fragment?.sourceTo ?? fragment?.to);
  if (!range) {
    return null;
  }
  const kind = fragment?.kind === 'inline-fragment' || fragment?.kind === 'line-fragment' || fragment?.kind === 'marker'
    ? fragment.kind
    : 'line-fragment';
  return {
    kind,
    blockId:
      typeof fragment?.blockId === 'string' && fragment.blockId.length > 0
        ? fragment.blockId
        : null,
    fragmentId:
      typeof fragment?.fragmentId === 'string' && fragment.fragmentId.length > 0
        ? fragment.fragmentId
        : `${kind}-${index}-${range.from}-${range.to}`,
    sourceFrom: range.from,
    sourceTo: range.to,
    lineNumber: readLineNumber(fragment, range),
    priority: Number.isFinite(fragment?.priority) ? Math.trunc(fragment.priority) : (
      kind === 'inline-fragment' ? 220 : kind === 'marker' ? 260 : 120
    ),
    active: false
  };
}

function sortSourceMapEntries(left, right) {
  return (
    left.sourceFrom - right.sourceFrom ||
    left.sourceTo - right.sourceTo ||
    right.priority - left.priority ||
    (left.kind ?? '').localeCompare(right.kind ?? '') ||
    (left.fragmentId ?? '').localeCompare(right.fragmentId ?? '') ||
    (left.blockId ?? '').localeCompare(right.blockId ?? '')
  );
}

function buildEntryIdentity(entry) {
  return [
    entry.kind,
    entry.blockId ?? '',
    entry.fragmentId ?? '',
    `${entry.sourceFrom}:${entry.sourceTo}`,
    `${entry.priority}`,
    `${entry.lineNumber ?? ''}`
  ].join('|');
}

export function buildSourceMapIndex({
  blocks = [],
  renderedFragments = [],
  inlineFragments = [],
  markerFragments = [],
  activeLine = null
} = {}) {
  const activeLineRange = clampRange(activeLine?.from, activeLine?.to);
  const entries = [];

  if (Array.isArray(blocks)) {
    for (let index = 0; index < blocks.length; index += 1) {
      const normalized = normalizeBlockEntry(blocks[index], index, activeLineRange);
      if (normalized) {
        entries.push(normalized);
      }
    }
  }

  const fragmentGroups = [renderedFragments, inlineFragments, markerFragments];
  for (const group of fragmentGroups) {
    if (!Array.isArray(group)) {
      continue;
    }
    for (let index = 0; index < group.length; index += 1) {
      const normalized = normalizeFragmentEntry(group[index], index);
      if (normalized) {
        entries.push(normalized);
      }
    }
  }

  entries.sort(sortSourceMapEntries);
  const seen = new Set();
  const deduped = [];
  for (const entry of entries) {
    const identity = buildEntryIdentity(entry);
    if (seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    deduped.push({
      id: identity,
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
  return sourceMapIndex
    .filter((entry) => (
      entry &&
      Number.isFinite(entry.sourceFrom) &&
      Number.isFinite(entry.sourceTo) &&
      pos >= entry.sourceFrom &&
      pos < entry.sourceTo
    ))
    .sort((left, right) => (
      right.priority - left.priority ||
      (left.sourceTo - left.sourceFrom) - (right.sourceTo - right.sourceFrom)
    ));
}
