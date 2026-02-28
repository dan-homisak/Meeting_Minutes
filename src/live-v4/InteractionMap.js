function normalizeEntry(entry) {
  if (!entry || !Number.isFinite(entry.sourceFrom) || !Number.isFinite(entry.sourceTo)) {
    return null;
  }

  const sourceFrom = Math.max(0, Math.trunc(entry.sourceFrom));
  const sourceTo = Math.max(sourceFrom, Math.trunc(entry.sourceTo));
  if (sourceTo <= sourceFrom) {
    return null;
  }

  return {
    kind: entry.kind === 'inline' || entry.kind === 'marker' ? entry.kind : 'block',
    blockId: typeof entry.blockId === 'string' ? entry.blockId : null,
    fragmentId: typeof entry.fragmentId === 'string' ? entry.fragmentId : null,
    sourceFrom,
    sourceTo,
    priority: Number.isFinite(entry.priority) ? Math.trunc(entry.priority) : 0
  };
}

function buildIdentity(entry) {
  return [
    entry.kind,
    entry.blockId ?? '',
    entry.fragmentId ?? '',
    `${entry.sourceFrom}:${entry.sourceTo}`,
    `${entry.priority}`
  ].join('|');
}

export function buildInteractionMap(entries = []) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return [];
  }

  const normalized = entries
    .map((entry) => normalizeEntry(entry))
    .filter(Boolean)
    .sort((left, right) => (
      left.sourceFrom - right.sourceFrom ||
      left.sourceTo - right.sourceTo ||
      right.priority - left.priority
    ));

  const seen = new Set();
  const deduped = [];
  for (const entry of normalized) {
    const identity = buildIdentity(entry);
    if (seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    deduped.push({ id: identity, ...entry });
  }

  return deduped;
}

export function findInteractionEntriesAtPosition(interactionMap, position) {
  if (!Array.isArray(interactionMap) || !Number.isFinite(position)) {
    return [];
  }

  const pos = Math.max(0, Math.trunc(position));
  return interactionMap
    .filter((entry) => pos >= entry.sourceFrom && pos < entry.sourceTo)
    .sort((left, right) => (
      right.priority - left.priority ||
      (left.sourceTo - left.sourceFrom) - (right.sourceTo - right.sourceFrom)
    ));
}

function readFiniteAttributeValue(element, attributeName) {
  if (!element || typeof element.getAttribute !== 'function') {
    return null;
  }
  const rawValue = element.getAttribute(attributeName);
  if (rawValue == null || rawValue === '') {
    return null;
  }
  const value = Number(rawValue);
  return Number.isFinite(value) ? Math.trunc(value) : null;
}

function readAttributeString(element, attributeName) {
  if (!element || typeof element.getAttribute !== 'function') {
    return null;
  }
  const value = element.getAttribute(attributeName);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function resolveSourceRangeFromTarget(targetElement) {
  if (!targetElement) {
    return {
      sourceFrom: null,
      sourceTo: null,
      fragmentId: null
    };
  }

  const scoped = typeof targetElement.closest === 'function'
    ? targetElement.closest('[data-src-from][data-src-to], [data-fragment-id]')
    : null;
  const sourceHost = scoped ?? targetElement;

  const sourceFrom = readFiniteAttributeValue(sourceHost, 'data-src-from');
  const sourceTo = readFiniteAttributeValue(sourceHost, 'data-src-to');
  const fragmentId = readAttributeString(sourceHost, 'data-fragment-id');

  return {
    sourceFrom,
    sourceTo,
    fragmentId
  };
}

export function resolveInteractionSourceFromTarget(targetElement, interactionMap) {
  const targetRange = resolveSourceRangeFromTarget(targetElement);
  if (Number.isFinite(targetRange.sourceFrom)) {
    return targetRange;
  }

  if (!targetRange.fragmentId || !Array.isArray(interactionMap)) {
    return targetRange;
  }

  const byFragment = interactionMap.find((entry) => entry.fragmentId === targetRange.fragmentId);
  if (!byFragment) {
    return targetRange;
  }

  return {
    sourceFrom: byFragment.sourceFrom,
    sourceTo: byFragment.sourceTo,
    fragmentId: byFragment.fragmentId
  };
}
