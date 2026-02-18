function normalizeSelection(selection) {
  if (!selection || !Number.isFinite(selection.anchor) || !Number.isFinite(selection.head)) {
    return null;
  }

  return {
    anchor: Math.trunc(selection.anchor),
    head: Math.trunc(selection.head)
  };
}

function summarizeChangedBounds(changeSpans, keyFrom, keyTo) {
  if (!Array.isArray(changeSpans) || changeSpans.length === 0) {
    return null;
  }

  let minFrom = Number.POSITIVE_INFINITY;
  let maxTo = Number.NEGATIVE_INFINITY;

  for (const change of changeSpans) {
    if (!change || !Number.isFinite(change[keyFrom]) || !Number.isFinite(change[keyTo])) {
      continue;
    }

    minFrom = Math.min(minFrom, Math.trunc(change[keyFrom]));
    maxTo = Math.max(maxTo, Math.trunc(change[keyTo]));
  }

  if (!Number.isFinite(minFrom) || !Number.isFinite(maxTo)) {
    return null;
  }

  return {
    from: minFrom,
    to: Math.max(minFrom, maxTo)
  };
}

function readChangeSpans(changeSet) {
  if (!changeSet || typeof changeSet.iterChanges !== 'function') {
    return [];
  }

  const spans = [];
  changeSet.iterChanges((fromA, toA, fromB, toB, inserted) => {
    const oldFrom = Math.max(0, Math.trunc(fromA));
    const oldTo = Math.max(oldFrom, Math.trunc(toA));
    const newFrom = Math.max(0, Math.trunc(fromB));
    const newTo = Math.max(newFrom, Math.trunc(toB));
    spans.push({
      oldFrom,
      oldTo,
      newFrom,
      newTo,
      insertedText: inserted && typeof inserted.toString === 'function'
        ? inserted.toString()
        : ''
    });
  });

  return spans;
}

export function classifyEditorTransaction(transaction = null) {
  const changeSpans = readChangeSpans(transaction?.changes);
  const oldChangedBounds = summarizeChangedBounds(changeSpans, 'oldFrom', 'oldTo');
  const newChangedBounds = summarizeChangedBounds(changeSpans, 'newFrom', 'newTo');

  const previousSelection = normalizeSelection(transaction?.startState?.selection?.main);
  const nextSelection = normalizeSelection(transaction?.state?.selection?.main);
  const selectionSet = Boolean(
    previousSelection &&
      nextSelection &&
      (previousSelection.anchor !== nextSelection.anchor || previousSelection.head !== nextSelection.head)
  );
  const docChanged = Boolean(transaction?.docChanged) || changeSpans.length > 0;

  return {
    docChanged,
    selectionSet,
    changeCount: changeSpans.length,
    changeSpans,
    changeRanges: changeSpans.map((change) => ({
      oldFrom: change.oldFrom,
      oldTo: change.oldTo,
      newFrom: change.newFrom,
      newTo: change.newTo
    })),
    oldChangedBounds,
    newChangedBounds,
    previousSelection,
    nextSelection
  };
}

export function applyChangeSpansToText(previousText, changeSpans) {
  const source = typeof previousText === 'string' ? previousText : '';
  if (!Array.isArray(changeSpans) || changeSpans.length === 0) {
    return source;
  }

  const ordered = [...changeSpans].sort((left, right) => left.oldFrom - right.oldFrom);
  let output = '';
  let cursor = 0;

  for (const change of ordered) {
    if (!change || !Number.isFinite(change.oldFrom) || !Number.isFinite(change.oldTo)) {
      continue;
    }

    const from = Math.max(cursor, Math.max(0, Math.trunc(change.oldFrom)));
    const to = Math.max(from, Math.max(0, Math.trunc(change.oldTo)));
    output += source.slice(cursor, from);
    output += typeof change.insertedText === 'string' ? change.insertedText : '';
    cursor = to;
  }

  output += source.slice(cursor);
  return output;
}
