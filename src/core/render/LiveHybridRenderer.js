import { Decoration, WidgetType } from '@codemirror/view';
import { buildSourceMapIndex } from '../mapping/SourceMapIndex.js';
import { virtualizeBlocksAroundActive } from '../viewport/BlockVirtualizer.js';
import { applyRenderBudget } from '../viewport/RenderBudget.js';

function escapeHtml(value) {
  const text = typeof value === 'string' ? value : '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function readBlockSource(doc, block) {
  if (!doc || !block || !Number.isFinite(block.from) || !Number.isFinite(block.to)) {
    return '';
  }
  return doc.sliceString(block.from, block.to);
}

function blockContainsPosition(block, position) {
  if (!block || !Number.isFinite(block.from) || !Number.isFinite(block.to) || !Number.isFinite(position)) {
    return false;
  }
  return position >= block.from && position < block.to;
}

function findActiveBlock(blocks, position) {
  if (!Array.isArray(blocks) || blocks.length === 0 || !Number.isFinite(position)) {
    return null;
  }

  const containing = blocks.find((block) => blockContainsPosition(block, position));
  if (containing) {
    return containing;
  }

  let nearest = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const block of blocks) {
    if (!block || !Number.isFinite(block.from) || !Number.isFinite(block.to)) {
      continue;
    }
    const max = block.to > block.from ? block.to - 1 : block.from;
    const distance = position < block.from
      ? block.from - position
      : position > max
        ? position - max
        : 0;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = block;
    }
  }

  return nearest;
}

class RenderedBlockWidget extends WidgetType {
  constructor({ html, fragmentId, blockId, sourceFrom, sourceTo }) {
    super();
    this.html = typeof html === 'string' ? html : '';
    this.fragmentId = fragmentId;
    this.blockId = blockId;
    this.sourceFrom = sourceFrom;
    this.sourceTo = sourceTo;
  }

  eq(other) {
    return (
      other instanceof RenderedBlockWidget &&
      this.html === other.html &&
      this.fragmentId === other.fragmentId &&
      this.blockId === other.blockId &&
      this.sourceFrom === other.sourceFrom &&
      this.sourceTo === other.sourceTo
    );
  }

  toDOM() {
    const wrapper = document.createElement('section');
    wrapper.className = 'cm-rendered-block-widget cm-rendered-block';
    wrapper.setAttribute('data-fragment-id', this.fragmentId);
    wrapper.setAttribute('data-block-id', this.blockId);
    wrapper.setAttribute('data-source-from', String(this.sourceFrom));
    wrapper.setAttribute('data-source-to', String(this.sourceTo));
    wrapper.innerHTML = this.html;
    return wrapper;
  }

  ignoreEvent() {
    // Let pointer events reach editor handlers so we can map rendered clicks.
    return false;
  }
}

export function createLiveHybridRenderer({
  app,
  liveDebug,
  renderMarkdownHtml = null,
  renderBudgetMaxBlocks = 120,
  virtualizationBufferBefore = 40,
  virtualizationBufferAfter = 40
} = {}) {
  function renderBlockHtml(source, block) {
    if (typeof renderMarkdownHtml === 'function') {
      return renderMarkdownHtml(source, {
        sourceFrom: block.from,
        sourceTo: block.to
      });
    }

    if (!source.trim()) {
      return '<p></p>';
    }

    return `<p>${escapeHtml(source)}</p>`;
  }

  function buildDecorations(state, blocks) {
    if (app.viewMode !== 'live') {
      return {
        activeBlockId: null,
        decorations: Decoration.none,
        fragmentMap: [],
        sourceMapIndex: buildSourceMapIndex({
          blocks: [],
          renderedFragments: []
        })
      };
    }

    const doc = state.doc;
    const selectionHead = state.selection.main.head;
    const activeBlock = findActiveBlock(blocks, selectionHead);
    const activeBlockId = activeBlock?.id ?? null;

    const virtualized = virtualizeBlocksAroundActive({
      blocks,
      activeBlockId,
      bufferBefore: virtualizationBufferBefore,
      bufferAfter: virtualizationBufferAfter
    });
    const budgeted = applyRenderBudget(virtualized.blocks, renderBudgetMaxBlocks);
    const candidateBlocks = budgeted.blocks;

    const ranges = [];
    const renderedFragments = [];

    for (let index = 0; index < candidateBlocks.length; index += 1) {
      const block = candidateBlocks[index];
      if (!block || !Number.isFinite(block.from) || !Number.isFinite(block.to)) {
        continue;
      }

      if (activeBlock && block.id === activeBlock.id) {
        continue;
      }

      const source = readBlockSource(doc, block);
      const html = renderBlockHtml(source, block);
      const blockId = typeof block.id === 'string' && block.id.length > 0
        ? block.id
        : `block-${virtualized.fromIndex + index}-${block.from}-${block.to}`;
      const fragmentId = `fragment-${virtualized.fromIndex + index}-${block.from}-${block.to}`;

      ranges.push(
        Decoration.replace({
          widget: new RenderedBlockWidget({
            html,
            fragmentId,
            blockId,
            sourceFrom: block.from,
            sourceTo: block.to
          }),
          block: true,
          inclusive: false
        }).range(block.from, block.to)
      );

      renderedFragments.push({
        fragmentId,
        blockId,
        from: block.from,
        to: block.to,
        blockFrom: block.from,
        blockTo: block.to,
        domPathHint: `[data-fragment-id="${fragmentId}"]`,
        priority: 100
      });
    }

    const sourceMapIndex = buildSourceMapIndex({
      blocks,
      renderedFragments,
      activeLine: doc.lineAt(selectionHead)
    });

    liveDebug.trace('decorations.hybrid-built', {
      blockCount: Array.isArray(blocks) ? blocks.length : 0,
      activeBlockId,
      renderedFragmentCount: renderedFragments.length,
      virtualizedFromIndex: virtualized.fromIndex,
      virtualizedToIndexExclusive: virtualized.toIndexExclusive,
      virtualizedBlockCount: virtualized.blocks.length,
      renderBudgetMaxBlocks,
      renderBudgetTruncated: budgeted.truncated
    });

    return {
      activeBlockId,
      decorations: ranges.length > 0 ? Decoration.set(ranges, true) : Decoration.none,
      fragmentMap: renderedFragments,
      sourceMapIndex
    };
  }

  return {
    buildDecorations
  };
}
