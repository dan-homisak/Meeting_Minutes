export function applyRenderBudget(blocks = [], maxBlocks = 120) {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return {
      blocks: [],
      truncated: false,
      maxBlocks: Number.isFinite(maxBlocks) ? Math.max(0, Math.trunc(maxBlocks)) : 120
    };
  }

  const budget = Number.isFinite(maxBlocks) ? Math.max(0, Math.trunc(maxBlocks)) : 120;
  if (blocks.length <= budget) {
    return {
      blocks,
      truncated: false,
      maxBlocks: budget
    };
  }

  return {
    blocks: blocks.slice(0, budget),
    truncated: true,
    maxBlocks: budget
  };
}
