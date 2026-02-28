import { Decoration } from '@codemirror/view';
import { RenderedBlockWidget } from './render/WidgetFactory.js';
import { buildLiveProjection } from './LiveProjection.js';

function clampRangeToDoc(state, from, to) {
  if (!state?.doc || !Number.isFinite(from) || !Number.isFinite(to)) {
    return null;
  }

  const max = Math.max(0, Math.trunc(state.doc.length));
  const rangeFrom = Math.max(0, Math.min(max, Math.trunc(from)));
  const rangeTo = Math.max(rangeFrom, Math.min(max, Math.trunc(to)));
  if (rangeTo <= rangeFrom) {
    return null;
  }

  return {
    from: rangeFrom,
    to: rangeTo
  };
}

function resolveReplacementRange(state, sourceFrom, sourceTo) {
  return clampRangeToDoc(state, sourceFrom, sourceTo);
}

function buildWidgetDecorations(state, renderedBlocks) {
  const decorations = [];
  let previousRangeTo = -1;

  const sortedBlocks = [...(Array.isArray(renderedBlocks) ? renderedBlocks : [])]
    .filter((entry) => (
      entry &&
      Number.isFinite(entry.sourceFrom) &&
      Number.isFinite(entry.sourceTo) &&
      entry.sourceTo > entry.sourceFrom
    ))
    .sort((left, right) => left.sourceFrom - right.sourceFrom || left.sourceTo - right.sourceTo);

  for (const entry of sortedBlocks) {
    const replacement = resolveReplacementRange(state, entry.sourceFrom, entry.sourceTo);
    if (!replacement) {
      continue;
    }

    let rangeFrom = replacement.from;
    const rangeTo = replacement.to;
    if (rangeFrom < previousRangeTo) {
      rangeFrom = previousRangeTo;
    }
    if (rangeTo <= rangeFrom) {
      continue;
    }

    decorations.push(
      Decoration.replace({
        widget: new RenderedBlockWidget({
          html: entry.html,
          fragmentId: entry.fragmentId,
          blockId: entry.blockId,
          sourceFrom: entry.sourceFrom,
          sourceTo: entry.sourceTo
        }),
        block: false,
        inclusive: false
      }).range(rangeFrom, rangeTo)
    );

    previousRangeTo = rangeTo;
  }

  return decorations;
}

export function createLiveRenderer({
  liveDebug,
  renderMarkdownHtml,
  renderBudgetMaxBlocks = 180,
  virtualizationBufferBefore = 16,
  virtualizationBufferAfter = 16
} = {}) {
  function buildRenderProjection(state, model, viewportWindow = null) {
    const projection = buildLiveProjection({
      state,
      model,
      renderMarkdownHtml,
      viewportWindow,
      renderBudgetMaxBlocks,
      virtualizationBufferBefore,
      virtualizationBufferAfter
    });

    const ranges = buildWidgetDecorations(state, projection.renderedBlocks);

    liveDebug?.trace?.('live-v4.projection.built', {
      activeBlockId: projection.activeBlockId,
      renderedBlockCount: projection.metrics.renderedBlockCount,
      virtualizedBlockCount: projection.metrics.virtualizedBlockCount,
      budgetTruncated: projection.metrics.budgetTruncated,
      renderMs: projection.metrics.renderMs,
      viewportFrom: projection.viewportWindow?.from ?? null,
      viewportTo: projection.viewportWindow?.to ?? null
    });
    liveDebug?.trace?.('decorations.hybrid-built', {
      blockCount: Array.isArray(model?.blocks) ? model.blocks.length : 0,
      activeBlockId: projection.activeBlockId,
      renderedFragmentCount: ranges.length,
      virtualizedBlockCount: projection.metrics.virtualizedBlockCount,
      renderBudgetMaxBlocks,
      renderBudgetTruncated: projection.metrics.budgetTruncated
    });

    return {
      ...projection,
      decorations: ranges.length > 0 ? Decoration.set(ranges, true) : Decoration.none
    };
  }

  return {
    buildRenderProjection
  };
}
