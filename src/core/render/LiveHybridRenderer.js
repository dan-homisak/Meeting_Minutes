import { Decoration } from '@codemirror/view';
import { buildSourceMapIndex } from '../mapping/SourceMapIndex.js';
import { buildSourceFirstDecorationPlan } from './LiveSourceRenderer.js';

export function createLiveHybridRenderer({
  app,
  liveDebug
} = {}) {
  function buildDecorations(state, blocks) {
    if (app.viewMode !== 'live') {
      return {
        decorations: Decoration.none,
        sourceMapIndex: buildSourceMapIndex({
          blocks: [],
          renderedFragments: []
        })
      };
    }

    const doc = state.doc;
    const activeLine = doc.lineAt(state.selection.main.head);
    const activeLineLength = Math.max(0, activeLine.to - activeLine.from);
    const activeLineIsEmpty = activeLineLength === 0;
    const plan = buildSourceFirstDecorationPlan(doc, activeLine.number);
    const ranges = [];
    for (const lineDecoration of plan.lineDecorations) {
      if (!Number.isFinite(lineDecoration?.lineNumber) || typeof lineDecoration?.className !== 'string') {
        continue;
      }
      const line = doc.line(lineDecoration.lineNumber);
      ranges.push(
        Decoration.line({
          attributes: {
            class: lineDecoration.className
          }
        }).range(line.from)
      );
    }

    for (const tokenDecoration of plan.tokenDecorations) {
      if (
        !Number.isFinite(tokenDecoration?.from) ||
        !Number.isFinite(tokenDecoration?.to) ||
        tokenDecoration.to <= tokenDecoration.from ||
        typeof tokenDecoration?.className !== 'string'
      ) {
        continue;
      }
      ranges.push(
        Decoration.mark({
          class: tokenDecoration.className
        }).range(tokenDecoration.from, tokenDecoration.to)
      );
    }

    liveDebug.trace('decorations.source-first-built', {
      activeLineNumber: activeLine.number,
      activeLineLength,
      activeLineIsEmpty,
      blockCount: blocks.length,
      lineDecorationCount: plan.stats.lineDecorationCount,
      tokenDecorationCount: plan.stats.tokenDecorationCount,
      headingLineCount: plan.stats.headingLineCount,
      paragraphLineCount: plan.stats.paragraphLineCount,
      quoteLineCount: plan.stats.quoteLineCount,
      listLineCount: plan.stats.listLineCount,
      taskLineCount: plan.stats.taskLineCount,
      tableLineCount: plan.stats.tableLineCount,
      hrLineCount: plan.stats.hrLineCount,
      fenceLineCount: plan.stats.fenceLineCount,
      fenceMarkerLineCount: plan.stats.fenceMarkerLineCount
    });

    return {
      decorations: ranges.length > 0 ? Decoration.set(ranges, true) : Decoration.none,
      sourceMapIndex: buildSourceMapIndex({
        blocks,
        renderedFragments: [],
        activeLine
      })
    };
  }

  return {
    buildDecorations
  };
}
