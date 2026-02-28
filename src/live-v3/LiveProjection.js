import { virtualizeBlocksAroundActive } from '../core/viewport/BlockVirtualizer.js';
import { applyRenderBudget } from '../core/viewport/RenderBudget.js';
import { renderBlockHtml } from './render/BlockRenderer.js';
import { collectMarkerEntriesForBlock } from './render/InlineRenderer.js';
import { buildInteractionMap } from './InteractionMap.js';

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function normalizeViewportWindow(viewportWindow, docLength, selectionHead, windowRadiusChars = 3200) {
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
  const radius = Math.max(400, Math.trunc(windowRadiusChars));
  const from = Math.max(0, center - radius);
  const to = Math.min(max, center + radius);
  return { from, to };
}

export function findActiveBlock(blocks, selectionHead) {
  if (!Array.isArray(blocks) || blocks.length === 0 || !Number.isFinite(selectionHead)) {
    return null;
  }

  const position = Math.max(0, Math.trunc(selectionHead));
  const containing = blocks.find(
    (block) => position >= block.from && position < block.to
  );
  if (containing) {
    return containing;
  }

  let nearest = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const block of blocks) {
    if (!block || !Number.isFinite(block.from) || !Number.isFinite(block.to)) {
      continue;
    }
    const startDistance = Math.abs(position - block.from);
    const endDistance = Math.abs(position - Math.max(block.from, block.to - 1));
    const distance = Math.min(startDistance, endDistance);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = block;
    }
  }

  return nearest;
}

export function buildLiveProjection({
  state,
  model,
  renderMarkdownHtml,
  viewportWindow = null,
  renderBudgetMaxBlocks = 180,
  virtualizationBufferBefore = 18,
  virtualizationBufferAfter = 18
} = {}) {
  if (!state || !model || typeof renderMarkdownHtml !== 'function') {
    return {
      activeBlockId: null,
      renderedBlocks: [],
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

  const virtualized = virtualizeBlocksAroundActive({
    blocks,
    activeBlockId,
    viewportWindow: normalizedViewportWindow,
    bufferBefore: virtualizationBufferBefore,
    bufferAfter: virtualizationBufferAfter
  });
  const budgeted = applyRenderBudget(virtualized.blocks, renderBudgetMaxBlocks);
  const candidateBlocks = budgeted.blocks;

  const renderedBlocks = [];
  const interactionEntries = [];

  for (const block of blocks) {
    interactionEntries.push({
      kind: 'block',
      blockId: block.id,
      fragmentId: null,
      sourceFrom: block.from,
      sourceTo: block.to,
      priority: block.id === activeBlockId ? 200 : 80
    });
  }

  for (const inline of inlines) {
    interactionEntries.push({
      kind: 'inline',
      blockId: blocks.find((block) => inline.from >= block.from && inline.from < block.to)?.id ?? null,
      fragmentId: `inline-${inline.type}-${inline.from}-${inline.to}`,
      sourceFrom: inline.from,
      sourceTo: inline.to,
      priority: 220
    });
  }

  for (const block of candidateBlocks) {
    if (!block || block.id === activeBlockId) {
      continue;
    }

    const html = renderBlockHtml({
      text: model.text,
      block,
      renderMarkdownHtml
    });
    if (typeof html !== 'string' || html.length === 0) {
      continue;
    }

    const fragmentId = `block-${block.id}-${block.from}-${block.to}`;
    renderedBlocks.push({
      fragmentId,
      blockId: block.id,
      sourceFrom: block.from,
      sourceTo: block.to,
      html
    });

    interactionEntries.push({
      kind: 'block',
      blockId: block.id,
      fragmentId,
      sourceFrom: block.from,
      sourceTo: block.to,
      priority: 140
    });

    interactionEntries.push(...collectMarkerEntriesForBlock(state.doc, block));
  }

  const interactionMap = buildInteractionMap(interactionEntries);

  return {
    activeBlockId,
    renderedBlocks,
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
