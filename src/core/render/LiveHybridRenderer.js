import { Decoration } from '@codemirror/view';
import { buildSourceMapIndex } from '../mapping/SourceMapIndex.js';
import {
  blockContainsLine,
  isFencedCodeBlock,
  shouldSkipEmptyTrailingBoundaryBlock,
  splitBlockAroundActiveLine
} from './LiveBlockHelpers.js';
import { buildSourceFirstDecorationPlan } from './LiveSourceRenderer.js';
import { RenderedBlockWidget } from './RenderedBlockWidget.js';
import { buildViewportWindow } from '../viewport/ViewportWindow.js';
import { virtualizeBlocksForViewport } from '../viewport/BlockVirtualizer.js';
import { applyRenderBudget } from '../viewport/RenderBudget.js';

export function createLiveHybridRenderer({
  app,
  liveDebug,
  renderMarkdownHtml,
  normalizeLogString,
  sourceFirstMode = true,
  fragmentCacheMax = 2500,
  slowBuildWarnMs = 12,
  viewportLineBuffer = 8,
  viewportMinimumLineSpan = 24,
  maxViewportBlocks = 160,
  maxViewportCharacters = 24000
} = {}) {
  function buildDecorations(state, blocks, fragmentHtmlCache = null, renderContext = {}) {
    if (app.viewMode !== 'live') {
      return {
        decorations: Decoration.none,
        sourceMapIndex: buildSourceMapIndex({
          blocks: [],
          renderedFragments: []
        })
      };
    }

    const startedAt = performance.now();
    const doc = state.doc;
    const activeLine = doc.lineAt(state.selection.main.head);
    const activeLineLength = Math.max(0, activeLine.to - activeLine.from);
    const activeLineIsEmpty = activeLineLength === 0;

    if (sourceFirstMode) {
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

    if (blocks.length === 0) {
      return {
        decorations: Decoration.none,
        sourceMapIndex: buildSourceMapIndex({
          blocks: [],
          renderedFragments: [],
          activeLine
        })
      };
    }

    const ranges = [];
    const renderedFragments = [];
    let skippedEmptyActiveLineBlocks = 0;
    let skippedEmptyBoundaryBlocks = 0;
    let skippedActiveFencedCodeBlocks = 0;
    let cacheHits = 0;
    let cacheMisses = 0;
    const viewportWindow = buildViewportWindow({
      doc,
      viewport: renderContext?.viewport ?? null,
      visibleRanges: renderContext?.visibleRanges ?? [],
      activeLineNumber: activeLine.number,
      lineBuffer: viewportLineBuffer,
      minimumLineSpan: viewportMinimumLineSpan
    });
    const virtualizedBlocks = virtualizeBlocksForViewport({
      blocks,
      viewportWindow,
      activeLineFrom: activeLine.from
    });
    const budgetedBlocks = applyRenderBudget({
      blocks: virtualizedBlocks.blocks,
      maxBlocks: maxViewportBlocks,
      maxCharacters: maxViewportCharacters,
      activeLineFrom: activeLine.from
    });
    const renderBlocks = budgetedBlocks.blocks;

    const renderFragmentMarkdown = (source, from, to) => {
      if (!(fragmentHtmlCache instanceof Map)) {
        return renderMarkdownHtml(source, {
          sourceFrom: from,
          sourceTo: to
        });
      }

      const cacheKey = `${from}:${to}`;
      if (fragmentHtmlCache.has(cacheKey)) {
        cacheHits += 1;
        return fragmentHtmlCache.get(cacheKey);
      }

      cacheMisses += 1;
      const html = renderMarkdownHtml(source, {
        sourceFrom: from,
        sourceTo: to
      });
      fragmentHtmlCache.set(cacheKey, html);
      if (fragmentHtmlCache.size > fragmentCacheMax) {
        fragmentHtmlCache.clear();
        fragmentHtmlCache.set(cacheKey, html);
        liveDebug.trace('decorations.cache.reset', {
          reason: 'size-limit',
          maxEntries: fragmentCacheMax
        });
      }

      return html;
    };

    for (const block of renderBlocks) {
      const activeLineInsideBlock = blockContainsLine(block, activeLine);
      const blockIsFencedCode = isFencedCodeBlock(doc, block);
      if (activeLineInsideBlock && blockIsFencedCode) {
        const blockStartLine = doc.lineAt(block.from);
        const blockEndLine = doc.lineAt(Math.max(block.from, block.to - 1));
        const activeLineText = doc.sliceString(activeLine.from, activeLine.to);
        const activeLineStartsFence = /^\s*([`~]{3,})/.test(activeLineText);
        const activeLineIsBlockStart = activeLine.from === blockStartLine.from;
        const activeLineIsBlockEnd = activeLine.to === blockEndLine.to;
        skippedActiveFencedCodeBlocks += 1;
        liveDebug.trace('decorations.block.skipped-active-fenced-code', {
          activeLineNumber: activeLine.number,
          activeLineFrom: activeLine.from,
          activeLineTo: activeLine.to,
          activeLineLength,
          activeLineTextPreview: normalizeLogString(activeLineText, 100),
          activeLineStartsFence,
          activeLineIsBlockStart,
          activeLineIsBlockEnd,
          blockStartLineNumber: blockStartLine.number,
          blockEndLineNumber: blockEndLine.number,
          activeLineIndexInBlock: Math.max(0, activeLine.number - blockStartLine.number),
          blockFrom: block.from,
          blockTo: block.to
        });
        continue;
      }

      if (activeLineIsEmpty && activeLineInsideBlock) {
        skippedEmptyActiveLineBlocks += 1;
        liveDebug.trace('decorations.block.skipped-empty-active-line', {
          activeLineNumber: activeLine.number,
          activeLineFrom: activeLine.from,
          activeLineTo: activeLine.to,
          activeLineLength,
          blockFrom: block.from,
          blockTo: block.to
        });
        continue;
      }

      const skipEmptyTrailingBoundary = shouldSkipEmptyTrailingBoundaryBlock(
        activeLine,
        block,
        blockIsFencedCode
      );
      if (skipEmptyTrailingBoundary) {
        skippedEmptyBoundaryBlocks += 1;
        liveDebug.trace('decorations.block.skipped-empty-line-boundary', {
          activeLineNumber: activeLine.number,
          activeLineFrom: activeLine.from,
          activeLineTo: activeLine.to,
          activeLineLength,
          blockIsFencedCode,
          blockFrom: block.from,
          blockTo: block.to
        });
        continue;
      }

      const fragments = splitBlockAroundActiveLine(doc, block, activeLine, renderFragmentMarkdown);
      for (const fragment of fragments) {
        renderedFragments.push({
          from: fragment.from,
          to: fragment.to,
          blockFrom: block.from,
          blockTo: block.to
        });
        ranges.push(
          Decoration.replace({
            block: true,
            widget: new RenderedBlockWidget(
              fragment.html,
              block.from,
              block.to,
              fragment.from,
              fragment.to
            )
          }).range(fragment.from, fragment.to)
        );
      }
    }

    const elapsedMs = Number((performance.now() - startedAt).toFixed(2));
    liveDebug.trace('decorations.built', {
      activeLineNumber: activeLine.number,
      activeLineLength,
      activeLineIsEmpty,
      activeLineFrom: activeLine.from,
      activeLineTo: activeLine.to,
      blockCount: blocks.length,
      windowedBlockCount: virtualizedBlocks.stats.outputBlockCount,
      budgetedBlockCount: budgetedBlocks.stats.outputBlockCount,
      budgetDroppedBlockCount: budgetedBlocks.stats.droppedBlockCount,
      budgetConsumedCharacters: budgetedBlocks.stats.consumedCharacters,
      budgetLimitHit: budgetedBlocks.stats.limitHit,
      viewportLineFrom: viewportWindow.lineFrom,
      viewportLineTo: viewportWindow.lineTo,
      viewportSourceFrom: viewportWindow.sourceFrom,
      viewportSourceTo: viewportWindow.sourceTo,
      viewportRangeCount: viewportWindow.rangeCount,
      skippedEmptyActiveLineBlocks,
      skippedEmptyBoundaryBlocks,
      skippedActiveFencedCodeBlocks,
      decorationCount: ranges.length,
      sourceMapIndexCount: renderedFragments.length + blocks.length,
      cacheHits,
      cacheMisses,
      cacheSize: fragmentHtmlCache instanceof Map ? fragmentHtmlCache.size : 0,
      elapsedMs
    });

    if (elapsedMs >= slowBuildWarnMs) {
      liveDebug.warn('decorations.slow', {
        elapsedMs,
        blockCount: blocks.length,
        decorationCount: ranges.length
      });
    }

    return {
      decorations: ranges.length > 0 ? Decoration.set(ranges, true) : Decoration.none,
      sourceMapIndex: buildSourceMapIndex({
        blocks,
        renderedFragments,
        activeLine
      })
    };
  }

  return {
    buildDecorations
  };
}
