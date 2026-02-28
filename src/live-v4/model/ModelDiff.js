function indexBlocksById(blocks) {
  const map = new Map();
  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (!block || typeof block.id !== 'string' || block.id.length === 0) {
      continue;
    }
    map.set(block.id, block);
  }
  return map;
}

function didBlockChange(left, right) {
  if (!left || !right) {
    return true;
  }
  return (
    left.type !== right.type ||
    left.from !== right.from ||
    left.to !== right.to ||
    left.lineFrom !== right.lineFrom ||
    left.lineTo !== right.lineTo
  );
}

export function diffLiveDocModels(previousModel, nextModel) {
  const previous = previousModel && typeof previousModel === 'object' ? previousModel : null;
  const next = nextModel && typeof nextModel === 'object' ? nextModel : null;

  if (!previous || !next) {
    return {
      textChanged: true,
      blockCountDelta: 0,
      inlineCountDelta: 0,
      changedBlockIds: []
    };
  }

  const previousBlocks = Array.isArray(previous.blocks) ? previous.blocks : [];
  const nextBlocks = Array.isArray(next.blocks) ? next.blocks : [];
  const previousById = indexBlocksById(previousBlocks);

  const changedBlockIds = [];
  for (const block of nextBlocks) {
    if (!block || typeof block.id !== 'string') {
      continue;
    }
    const prior = previousById.get(block.id);
    if (!prior || didBlockChange(prior, block)) {
      changedBlockIds.push(block.id);
    }
  }

  return {
    textChanged: previous.text !== next.text,
    blockCountDelta: nextBlocks.length - previousBlocks.length,
    inlineCountDelta: (Array.isArray(next.inlines) ? next.inlines.length : 0) -
      (Array.isArray(previous.inlines) ? previous.inlines.length : 0),
    changedBlockIds
  };
}
