import { Decoration, WidgetType } from '@codemirror/view';
import { buildSourceMapIndex } from '../mapping/SourceMapIndex.js';
import { buildLiveFragmentGraph } from './LiveFragmentGraph.js';
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

function normalizeViewportWindow(viewportWindow, docLength, selectionHead, windowRadiusChars = 3200) {
  const max = Math.max(0, Math.trunc(docLength));
  if (
    viewportWindow &&
    Number.isFinite(viewportWindow.from) &&
    Number.isFinite(viewportWindow.to) &&
    viewportWindow.to > viewportWindow.from
  ) {
    const from = Math.max(0, Math.min(max, Math.trunc(viewportWindow.from)));
    const to = Math.max(from, Math.min(max, Math.trunc(viewportWindow.to)));
    return {
      from,
      to
    };
  }

  const center = Number.isFinite(selectionHead) ? Math.max(0, Math.min(max, Math.trunc(selectionHead))) : 0;
  const from = Math.max(0, center - Math.max(400, Math.trunc(windowRadiusChars)));
  const to = Math.min(max, center + Math.max(400, Math.trunc(windowRadiusChars)));
  return {
    from,
    to
  };
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

class RenderedFragmentWidget extends WidgetType {
  constructor({
    html,
    fragmentId,
    blockId,
    sourceFrom,
    sourceTo,
    lineNumber = null,
    fragmentKind = 'line-fragment'
  }) {
    super();
    this.html = typeof html === 'string' ? html : '';
    this.fragmentId = fragmentId;
    this.blockId = blockId;
    this.sourceFrom = sourceFrom;
    this.sourceTo = sourceTo;
    this.lineNumber = Number.isFinite(lineNumber) ? Math.trunc(lineNumber) : null;
    this.fragmentKind = fragmentKind;
  }

  eq(other) {
    return (
      other instanceof RenderedFragmentWidget &&
      this.html === other.html &&
      this.fragmentId === other.fragmentId &&
      this.blockId === other.blockId &&
      this.sourceFrom === other.sourceFrom &&
      this.sourceTo === other.sourceTo &&
      this.lineNumber === other.lineNumber &&
      this.fragmentKind === other.fragmentKind
    );
  }

  toDOM() {
    const wrapper = document.createElement('section');
    wrapper.className = `cm-rendered-fragment-widget cm-rendered-fragment cm-rendered-fragment-${this.fragmentKind}`;
    wrapper.setAttribute('data-fragment-id', this.fragmentId);
    if (typeof this.blockId === 'string' && this.blockId.length > 0) {
      wrapper.setAttribute('data-block-id', this.blockId);
    }
    wrapper.setAttribute('data-src-from', String(this.sourceFrom));
    wrapper.setAttribute('data-src-to', String(this.sourceTo));
    if (Number.isFinite(this.lineNumber)) {
      wrapper.setAttribute('data-line-number', String(this.lineNumber));
    }
    wrapper.innerHTML = this.html;
    return wrapper;
  }

  ignoreEvent() {
    return false;
  }
}

export function createLiveHybridRenderer({
  app,
  liveDebug,
  renderMarkdownHtml = null,
  renderBudgetMaxBlocks = 220,
  virtualizationBufferBefore = 24,
  virtualizationBufferAfter = 24
} = {}) {
  function renderFragmentHtml(source, options = null) {
    if (typeof renderMarkdownHtml === 'function') {
      return renderMarkdownHtml(source, options);
    }

    if (!source.trim()) {
      return '<p></p>';
    }

    return `<p>${escapeHtml(source)}</p>`;
  }

  function buildDecorations(state, blocks, viewportWindow = null, options = {}) {
    if (app.viewMode !== 'live') {
      return {
        activeBlockId: null,
        activeLineRange: null,
        decorations: Decoration.none,
        fragmentMap: [],
        sourceMapIndex: [],
        renderMetrics: {
          viewportFrom: null,
          viewportTo: null,
          virtualizedBlockCount: 0,
          renderedFragmentCount: 0,
          lineFragmentCount: 0,
          blockFragmentCount: 0,
          inlineFragmentCount: 0,
          markerFragmentCount: 0,
          renderBudgetMaxBlocks,
          renderBudgetTruncated: false
        }
      };
    }

    const doc = state.doc;
    const selectionHead = state.selection.main.head;
    const activeLine = doc.lineAt(selectionHead);
    const activeLineRange = {
      from: activeLine.from,
      to: activeLine.to
    };
    const activeBlock = findActiveBlock(blocks, selectionHead);
    const activeBlockId = activeBlock?.id ?? null;
    const normalizedViewportWindow = normalizeViewportWindow(
      viewportWindow,
      doc.length,
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

    const fragmentGraph = buildLiveFragmentGraph({
      doc,
      blocks: candidateBlocks,
      activeLineRange,
      renderMarkdownHtml: renderFragmentHtml,
      inlineSpans: Array.isArray(options.inlineSpans) ? options.inlineSpans : []
    });

    const ranges = [];
    for (const fragment of fragmentGraph.renderedFragments) {
      if (!Number.isFinite(fragment.sourceFrom) || !Number.isFinite(fragment.sourceTo)) {
        continue;
      }
      if (fragment.sourceTo <= fragment.sourceFrom) {
        continue;
      }
      ranges.push(
        Decoration.replace({
          widget: new RenderedFragmentWidget({
            html: fragment.html,
            fragmentId: fragment.fragmentId,
            blockId: fragment.blockId,
            sourceFrom: fragment.sourceFrom,
            sourceTo: fragment.sourceTo,
            lineNumber: fragment.lineNumber,
            fragmentKind: fragment.kind
          }),
          block: true,
          inclusive: false
        }).range(fragment.sourceFrom, fragment.sourceTo)
      );
    }

    const sourceMapIndex = buildSourceMapIndex({
      blocks,
      renderedFragments: fragmentGraph.renderedFragments,
      inlineFragments: fragmentGraph.inlineFragments,
      markerFragments: fragmentGraph.markerFragments,
      activeLine: activeLineRange
    });

    const renderMetrics = {
      viewportFrom: normalizedViewportWindow.from,
      viewportTo: normalizedViewportWindow.to,
      virtualizedBlockCount: virtualized.blocks.length,
      renderedFragmentCount: fragmentGraph.metrics.renderedFragmentCount,
      lineFragmentCount: fragmentGraph.metrics.lineFragmentCount,
      blockFragmentCount: fragmentGraph.metrics.blockFragmentCount,
      inlineFragmentCount: fragmentGraph.metrics.inlineFragmentCount,
      markerFragmentCount: fragmentGraph.metrics.markerFragmentCount,
      renderBudgetMaxBlocks,
      renderBudgetTruncated: budgeted.truncated
    };

    liveDebug.trace('decorations.hybrid-built', {
      blockCount: Array.isArray(blocks) ? blocks.length : 0,
      activeBlockId,
      activeLineFrom: activeLineRange.from,
      activeLineTo: activeLineRange.to,
      virtualizedFromIndex: virtualized.fromIndex,
      virtualizedToIndexExclusive: virtualized.toIndexExclusive,
      ...renderMetrics
    });

    return {
      activeBlockId,
      activeLineRange,
      decorations: ranges.length > 0 ? Decoration.set(ranges, true) : Decoration.none,
      fragmentMap: fragmentGraph.renderedFragments,
      sourceMapIndex,
      renderMetrics
    };
  }

  return {
    buildDecorations
  };
}
