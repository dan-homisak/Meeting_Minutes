function resolveBudgetLimit(limit) {
  if (!Number.isFinite(limit)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(1, Math.trunc(limit));
}

function isBlockRange(block) {
  return (
    block &&
    Number.isFinite(block.from) &&
    Number.isFinite(block.to) &&
    Math.trunc(block.to) > Math.trunc(block.from)
  );
}

function findActiveBlockIndex(blocks, activeLineFrom) {
  if (!Number.isFinite(activeLineFrom)) {
    return -1;
  }

  const targetPosition = Math.trunc(activeLineFrom);
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (!isBlockRange(block)) {
      continue;
    }

    const from = Math.trunc(block.from);
    const to = Math.trunc(block.to);
    if (targetPosition >= from && targetPosition < to) {
      return index;
    }
  }

  return -1;
}

function buildCandidateOrder(blocks, activeBlockIndex) {
  if (activeBlockIndex < 0) {
    return blocks.map((_, index) => index);
  }

  const order = [activeBlockIndex];
  for (let offset = 1; offset < blocks.length; offset += 1) {
    const left = activeBlockIndex - offset;
    const right = activeBlockIndex + offset;
    if (left >= 0) {
      order.push(left);
    }
    if (right < blocks.length) {
      order.push(right);
    }
  }

  return order;
}

export function applyRenderBudget({
  blocks = [],
  maxBlocks = 160,
  maxCharacters = 24000,
  activeLineFrom = Number.NaN
} = {}) {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return {
      blocks: [],
      stats: {
        inputBlockCount: 0,
        outputBlockCount: 0,
        droppedBlockCount: 0,
        consumedCharacters: 0,
        limitHit: null
      }
    };
  }

  const resolvedMaxBlocks = resolveBudgetLimit(maxBlocks);
  const resolvedMaxCharacters = resolveBudgetLimit(maxCharacters);
  const activeBlockIndex = findActiveBlockIndex(blocks, activeLineFrom);
  const candidateOrder = buildCandidateOrder(blocks, activeBlockIndex);
  const selectedIndexes = new Set();
  let consumedCharacters = 0;
  let limitHit = null;

  for (const candidateIndex of candidateOrder) {
    if (selectedIndexes.size >= resolvedMaxBlocks) {
      limitHit = limitHit ?? 'max-blocks';
      break;
    }

    const block = blocks[candidateIndex];
    if (!isBlockRange(block)) {
      continue;
    }

    const blockLength = Math.max(0, Math.trunc(block.to) - Math.trunc(block.from));
    const wouldExceedCharacters = consumedCharacters + blockLength > resolvedMaxCharacters;
    if (selectedIndexes.size > 0 && wouldExceedCharacters) {
      limitHit = limitHit ?? 'max-characters';
      break;
    }

    selectedIndexes.add(candidateIndex);
    consumedCharacters += blockLength;
  }

  if (selectedIndexes.size === 0) {
    selectedIndexes.add(candidateOrder[0]);
    const block = blocks[candidateOrder[0]];
    consumedCharacters = isBlockRange(block)
      ? Math.max(0, Math.trunc(block.to) - Math.trunc(block.from))
      : 0;
  }

  const orderedIndexes = [...selectedIndexes].sort((left, right) => left - right);
  const budgetedBlocks = orderedIndexes.map((index) => blocks[index]);

  return {
    blocks: budgetedBlocks,
    stats: {
      inputBlockCount: blocks.length,
      outputBlockCount: budgetedBlocks.length,
      droppedBlockCount: Math.max(0, blocks.length - budgetedBlocks.length),
      consumedCharacters,
      limitHit
    }
  };
}
