import { Decoration } from '@codemirror/view';
import { RenderedBlockWidget } from './render/WidgetFactory.js';
import { buildLiveProjection } from './LiveProjection.js';

export function createLiveRenderer({
  liveDebug,
  renderMarkdownHtml,
  renderBudgetMaxBlocks = 180,
  virtualizationBufferBefore = 18,
  virtualizationBufferAfter = 18
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

    const ranges = projection.renderedBlocks.map((entry) => (
      Decoration.replace({
        widget: new RenderedBlockWidget({
          html: entry.html,
          fragmentId: entry.fragmentId,
          blockId: entry.blockId,
          sourceFrom: entry.sourceFrom,
          sourceTo: entry.sourceTo
        }),
        block: true,
        inclusive: false
      }).range(entry.sourceFrom, entry.sourceTo)
    ));

    liveDebug?.trace?.('live-v3.projection.built', {
      activeBlockId: projection.activeBlockId,
      renderedBlockCount: projection.metrics.renderedBlockCount,
      virtualizedBlockCount: projection.metrics.virtualizedBlockCount,
      budgetTruncated: projection.metrics.budgetTruncated,
      renderMs: projection.metrics.renderMs,
      viewportFrom: projection.viewportWindow?.from ?? null,
      viewportTo: projection.viewportWindow?.to ?? null
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
