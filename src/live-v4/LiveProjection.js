import { renderBlockHtml } from './render/BlockRenderer.js';
import { collectMarkerEntriesForBlock } from './render/InlineRenderer.js';
import { buildInteractionMap } from './InteractionMap.js';

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function normalizeViewportWindow(viewportWindow, docLength, selectionHead, windowRadiusChars = 2400) {
  const max = Math.max(0, Math.trunc(docLength));
  if (
    viewportWindow &&
    Number.isFinite(viewportWindow.from) &&
    Number.isFinite(viewportWindow.to) &&
    viewportWindow.to > viewportWindow.from
  ) {
    const from = clampNumber(viewportWindow.from, 0, max);
    const to = clampNumber(viewportWindow.to, from, max);
    return { from, to };
  }

  const center = clampNumber(selectionHead, 0, max);
  const radius = Math.max(300, Math.trunc(windowRadiusChars));
  const from = Math.max(0, center - radius);
  const to = Math.min(max, center + radius);
  return { from, to };
}

function findBlockByPosition(blocks, position) {
  if (!Array.isArray(blocks) || blocks.length === 0 || !Number.isFinite(position)) {
    return null;
  }

  const pos = Math.max(0, Math.trunc(position));
  for (const block of blocks) {
    if (!block || !Number.isFinite(block.from) || !Number.isFinite(block.to)) {
      continue;
    }
    if (pos >= block.from && pos <= block.to) {
      return block;
    }
  }

  let nearest = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const block of blocks) {
    if (!block || !Number.isFinite(block.from) || !Number.isFinite(block.to)) {
      continue;
    }

    const distance = Math.min(
      Math.abs(pos - block.from),
      Math.abs(pos - Math.max(block.from, block.to - 1))
    );

    if (distance < nearestDistance) {
      nearest = block;
      nearestDistance = distance;
    }
  }

  return nearest;
}

function virtualizeBlocksAroundViewport({
  blocks,
  activeBlockId,
  viewportWindow,
  bufferBefore = 16,
  bufferAfter = 16
}) {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return {
      blocks: [],
      fromIndex: 0,
      toIndexExclusive: 0,
      activeIndex: -1
    };
  }

  let fromIndexByViewport = -1;
  let toIndexByViewport = -1;

  if (
    viewportWindow &&
    Number.isFinite(viewportWindow.from) &&
    Number.isFinite(viewportWindow.to) &&
    viewportWindow.to > viewportWindow.from
  ) {
    const viewportFrom = Math.max(0, Math.trunc(viewportWindow.from));
    const viewportTo = Math.max(viewportFrom, Math.trunc(viewportWindow.to));

    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index];
      if (!block || !Number.isFinite(block.from) || !Number.isFinite(block.to)) {
        continue;
      }

      const intersects = block.to > viewportFrom && block.from < viewportTo;
      if (!intersects) {
        continue;
      }

      if (fromIndexByViewport < 0) {
        fromIndexByViewport = index;
      }
      toIndexByViewport = index;
    }
  }

  let activeIndex = blocks.findIndex((block) => block?.id === activeBlockId);
  if (activeIndex < 0 && fromIndexByViewport >= 0) {
    activeIndex = fromIndexByViewport;
  }
  if (activeIndex < 0) {
    activeIndex = 0;
  }

  if (fromIndexByViewport >= 0 && toIndexByViewport >= fromIndexByViewport) {
    const fromIndex = Math.max(0, fromIndexByViewport - Math.max(0, Math.trunc(bufferBefore)));
    const toIndexExclusive = Math.min(
      blocks.length,
      toIndexByViewport + 1 + Math.max(0, Math.trunc(bufferAfter))
    );

    return {
      blocks: blocks.slice(fromIndex, toIndexExclusive),
      fromIndex,
      toIndexExclusive,
      activeIndex
    };
  }

  const fromIndex = Math.max(0, activeIndex - Math.max(0, Math.trunc(bufferBefore)));
  const toIndexExclusive = Math.min(blocks.length, activeIndex + 1 + Math.max(0, Math.trunc(bufferAfter)));

  return {
    blocks: blocks.slice(fromIndex, toIndexExclusive),
    fromIndex,
    toIndexExclusive,
    activeIndex
  };
}

function applyRenderBudget(blocks = [], maxBlocks = 180) {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return {
      blocks: [],
      truncated: false,
      maxBlocks: Number.isFinite(maxBlocks) ? Math.max(0, Math.trunc(maxBlocks)) : 180
    };
  }

  const budget = Number.isFinite(maxBlocks) ? Math.max(0, Math.trunc(maxBlocks)) : 180;
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

function resolveInlineBlockId(blocks, inlineFrom) {
  for (const block of blocks) {
    if (inlineFrom >= block.from && inlineFrom < block.to) {
      return block.id;
    }
  }
  return null;
}

const ACTIVE_SLICE_TYPES = new Set(['paragraph', 'blockquote', 'list']);
const SOURCE_TRANSFORM_TYPES = new Set(['heading', 'list', 'task', 'blockquote']);

function canSliceActiveBlock(block) {
  if (!block || typeof block.type !== 'string') {
    return false;
  }
  return ACTIVE_SLICE_TYPES.has(block.type);
}

function shouldUseSourceTransform(block) {
  if (!block || typeof block.type !== 'string') {
    return false;
  }
  if (!SOURCE_TRANSFORM_TYPES.has(block.type)) {
    return false;
  }
  return Number.isFinite(block.lineFrom) && Number.isFinite(block.lineTo) && block.lineFrom === block.lineTo;
}

function sliceActiveBlockIntoInactiveRanges(state, block, selectionHead) {
  if (!state?.doc || !block || !canSliceActiveBlock(block)) {
    return [];
  }

  const line = state.doc.lineAt(selectionHead);
  const activeFrom = Math.max(block.from, line.from);
  const activeTo = Math.min(block.to, line.to);
  if (!Number.isFinite(activeFrom) || !Number.isFinite(activeTo) || activeTo <= activeFrom) {
    return [];
  }

  const ranges = [];
  if (activeFrom > block.from) {
    ranges.push({
      from: block.from,
      to: activeFrom
    });
  }
  if (activeTo < block.to) {
    ranges.push({
      from: activeTo,
      to: block.to
    });
  }

  return ranges.filter((range) => Number.isFinite(range.from) && Number.isFinite(range.to) && range.to > range.from);
}

export function findActiveBlock(blocks, selectionHead) {
  return findBlockByPosition(blocks, selectionHead);
}

export function buildLiveProjection({
  state,
  model,
  renderMarkdownHtml,
  viewportWindow = null,
  renderBudgetMaxBlocks = 180,
  virtualizationBufferBefore = 16,
  virtualizationBufferAfter = 16
} = {}) {
  if (!state || !model || typeof renderMarkdownHtml !== 'function') {
    return {
      activeBlockId: null,
      renderedBlocks: [],
      sourceTransforms: [],
      interactionMap: [],
      metrics: {
        renderedBlockCount: 0,
        virtualizedBlockCount: 0,
        budgetTruncated: false,
        renderMs: 0
      },
      viewportWindow: null
    };
  }

  const startedAt = performance.now();
  const blocks = Array.isArray(model.blocks) ? model.blocks : [];
  const inlines = Array.isArray(model.inlines) ? model.inlines : [];
  const selectionHead = state.selection.main.head;
  const activeBlock = findActiveBlock(blocks, selectionHead);
  const activeBlockId = activeBlock?.id ?? null;

  const normalizedViewportWindow = normalizeViewportWindow(
    viewportWindow,
    state.doc.length,
    selectionHead
  );

  const virtualized = virtualizeBlocksAroundViewport({
    blocks,
    activeBlockId,
    viewportWindow: normalizedViewportWindow,
    bufferBefore: virtualizationBufferBefore,
    bufferAfter: virtualizationBufferAfter
  });

  const budgeted = applyRenderBudget(virtualized.blocks, renderBudgetMaxBlocks);
  const candidateBlocks = budgeted.blocks;

  const renderedBlocks = [];
  const sourceTransforms = [];
  const interactionEntries = [];

  for (const block of blocks) {
    interactionEntries.push({
      kind: 'block',
      blockId: block.id,
      fragmentId: null,
      sourceFrom: block.from,
      sourceTo: block.to,
      priority: block.id === activeBlockId ? 210 : 100
    });
  }

  for (const inline of inlines) {
    interactionEntries.push({
      kind: 'inline',
      blockId: resolveInlineBlockId(blocks, inline.from),
      fragmentId: `inline-${inline.type}-${inline.from}-${inline.to}`,
      sourceFrom: inline.from,
      sourceTo: inline.to,
      priority: 260
    });
  }

  for (const block of candidateBlocks) {
    if (!block) {
      continue;
    }

    if (shouldUseSourceTransform(block)) {
      sourceTransforms.push({
        blockId: block.id,
        type: block.type,
        sourceFrom: block.from,
        sourceTo: block.to,
        attrs: block.attrs ?? {},
        depth: block.depth
      });

      interactionEntries.push(...collectMarkerEntriesForBlock(state.doc, block));
      continue;
    }

    const rangesToRender = [];
    if (block.id === activeBlockId) {
      const activeSlices = sliceActiveBlockIntoInactiveRanges(state, block, selectionHead);
      for (const slice of activeSlices) {
        rangesToRender.push({
          blockId: block.id,
          from: slice.from,
          to: slice.to,
          type: block.type,
          attrs: block.attrs,
          lineFrom: block.lineFrom,
          lineTo: block.lineTo,
          depth: block.depth
        });
      }
    } else {
      rangesToRender.push({
        blockId: block.id,
        from: block.from,
        to: block.to,
        type: block.type,
        attrs: block.attrs,
        lineFrom: block.lineFrom,
        lineTo: block.lineTo,
        depth: block.depth
      });
    }

    if (rangesToRender.length === 0) {
      continue;
    }

    for (const range of rangesToRender) {
      const html = renderBlockHtml({
        text: model.text,
        block: {
          ...block,
          from: range.from,
          to: range.to
        },
        renderMarkdownHtml
      });
      if (typeof html !== 'string' || html.length === 0) {
        continue;
      }

      const fragmentId = `block-${range.blockId}-${range.from}-${range.to}`;
      renderedBlocks.push({
        fragmentId,
        blockId: range.blockId,
        sourceFrom: range.from,
        sourceTo: range.to,
        html
      });

      interactionEntries.push({
        kind: 'block',
        blockId: range.blockId,
        fragmentId,
        sourceFrom: range.from,
        sourceTo: range.to,
        priority: block.id === activeBlockId ? 190 : 180
      });

      interactionEntries.push(...collectMarkerEntriesForBlock(state.doc, {
        ...block,
        from: range.from,
        to: range.to
      }));
    }
  }

  const interactionMap = buildInteractionMap(interactionEntries);

  return {
    activeBlockId,
    renderedBlocks,
    sourceTransforms,
    interactionMap,
    metrics: {
      renderedBlockCount: renderedBlocks.length,
      virtualizedBlockCount: virtualized.blocks.length,
      budgetTruncated: budgeted.truncated,
      renderMs: Number((performance.now() - startedAt).toFixed(2))
    },
    viewportWindow: normalizedViewportWindow
  };
}
