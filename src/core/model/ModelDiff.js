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

function toInlineKey(span) {
  if (!span || !Number.isFinite(span.from) || !Number.isFinite(span.to)) {
    return null;
  }

  const from = Math.max(0, Math.trunc(span.from));
  const to = Math.max(from, Math.trunc(span.to));
  if (to <= from) {
    return null;
  }

  const type = typeof span.type === 'string' && span.type.length > 0 ? span.type : 'unknown';
  return `${from}:${to}:${type}`;
}

function normalizeAttrs(attrs) {
  if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) {
    return {};
  }

  const normalized = {};
  const keys = Object.keys(attrs).sort();
  for (const key of keys) {
    normalized[key] = attrs[key];
  }
  return normalized;
}

function areAttrsEqual(left, right) {
  const normalizedLeft = normalizeAttrs(left);
  const normalizedRight = normalizeAttrs(right);
  const leftKeys = Object.keys(normalizedLeft);
  const rightKeys = Object.keys(normalizedRight);

  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  for (let index = 0; index < leftKeys.length; index += 1) {
    const key = leftKeys[index];
    if (key !== rightKeys[index]) {
      return false;
    }
    if (normalizedLeft[key] !== normalizedRight[key]) {
      return false;
    }
  }

  return true;
}

function toBlockIdentity(block, index, prefix) {
  const rangeKey = toRangeKey(block);
  if (!rangeKey) {
    return null;
  }

  const explicitId = typeof block?.id === 'string' && block.id.length > 0 ? block.id : null;
  const id = explicitId ?? `${prefix}:${index}:${rangeKey}`;

  return {
    id,
    from: Math.max(0, Math.trunc(block.from)),
    to: Math.max(Math.trunc(block.from), Math.trunc(block.to)),
    type: typeof block?.type === 'string' && block.type.length > 0 ? block.type : 'unknown',
    attrs: normalizeAttrs(block?.attrs),
    block
  };
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

  const previousIdentities = previousBlocks
    .map((block, index) => toBlockIdentity(block, index, 'prev'))
    .filter(Boolean);
  const nextIdentities = nextBlocks
    .map((block, index) => toBlockIdentity(block, index, 'next'))
    .filter(Boolean);

  const previousById = new Map(previousIdentities.map((identity) => [identity.id, identity]));
  const nextById = new Map(nextIdentities.map((identity) => [identity.id, identity]));

  const previousKeys = new Set(previousIdentities.map((identity) => `${identity.from}:${identity.to}`));
  const nextKeys = new Set(nextIdentities.map((identity) => `${identity.from}:${identity.to}`));

  const addedRanges = [];
  const removedRanges = [];

  for (const identity of nextIdentities) {
    const key = `${identity.from}:${identity.to}`;
    if (!previousKeys.has(key)) {
      addedRanges.push(identity.block);
    }
  }

  for (const identity of previousIdentities) {
    const key = `${identity.from}:${identity.to}`;
    if (!nextKeys.has(key)) {
      removedRanges.push(identity.block);
    }
  }

  const blockAddedIds = [];
  const blockRemovedIds = [];
  const blockUpdatedIds = [];
  const changedBlocks = [];

  for (const identity of nextIdentities) {
    if (!previousById.has(identity.id)) {
      blockAddedIds.push(identity.id);
      changedBlocks.push({
        id: identity.id,
        change: 'added',
        from: identity.from,
        to: identity.to,
        type: identity.type
      });
      continue;
    }

    const previousIdentity = previousById.get(identity.id);
    const updated =
      previousIdentity.from !== identity.from ||
      previousIdentity.to !== identity.to ||
      previousIdentity.type !== identity.type ||
      !areAttrsEqual(previousIdentity.attrs, identity.attrs);
    if (updated) {
      blockUpdatedIds.push(identity.id);
      changedBlocks.push({
        id: identity.id,
        change: 'updated',
        from: identity.from,
        to: identity.to,
        type: identity.type
      });
    }
  }

  for (const identity of previousIdentities) {
    if (nextById.has(identity.id)) {
      continue;
    }
    blockRemovedIds.push(identity.id);
    changedBlocks.push({
      id: identity.id,
      change: 'removed',
      from: identity.from,
      to: identity.to,
      type: identity.type
    });
  }

  const previousInlineByKey = new Map();
  for (const span of previousInlineSpans) {
    const key = toInlineKey(span);
    if (key) {
      previousInlineByKey.set(key, span);
    }
  }

  const nextInlineByKey = new Map();
  for (const span of nextInlineSpans) {
    const key = toInlineKey(span);
    if (key) {
      nextInlineByKey.set(key, span);
    }
  }

  const addedInlineFragments = [];
  const removedInlineFragments = [];

  for (const [key, span] of nextInlineByKey.entries()) {
    if (!previousInlineByKey.has(key)) {
      addedInlineFragments.push(span);
    }
  }

  for (const [key, span] of previousInlineByKey.entries()) {
    if (!nextInlineByKey.has(key)) {
      removedInlineFragments.push(span);
    }
  }

  const changeRanges = [...addedRanges, ...removedRanges];
  const changedRange = collectRangeBounds(changeRanges);
  const textChanged = (previous?.text ?? '') !== (next?.text ?? '');
  const inlineSpanDelta = nextInlineSpans.length - previousInlineSpans.length;
  const blockDelta = nextBlocks.length - previousBlocks.length;
  const changedBlockIds = [...new Set([...blockAddedIds, ...blockRemovedIds, ...blockUpdatedIds])];
  const changedInlineFragments = {
    added: addedInlineFragments,
    removed: removedInlineFragments
  };

  return {
    textChanged,
    blockChanged:
      addedRanges.length > 0 ||
      removedRanges.length > 0 ||
      blockUpdatedIds.length > 0,
    blockAddedCount: addedRanges.length,
    blockRemovedCount: removedRanges.length,
    blockDelta,
    inlineSpanDelta,
    previousBlockCount: previousBlocks.length,
    nextBlockCount: nextBlocks.length,
    changedRange,
    blockAddedIds,
    blockRemovedIds,
    blockUpdatedIds,
    changedBlockIds,
    changedBlocks,
    changedInlineFragments
  };
}
