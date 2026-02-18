import { StateField } from '@codemirror/state';
import { Decoration, WidgetType } from '@codemirror/view';
import {
  buildLiveBlockIndex,
  blockContainsLine,
  collectTopLevelBlocks,
  findIndexedBlockAtPosition,
  isFencedCodeBlock,
  readFenceVisibilityState,
  shouldSkipEmptyTrailingBoundaryBlock,
  splitBlockAroundActiveLine
} from '../livePreviewCore.js';
import { buildSourceFirstDecorationPlan } from '../liveSourceRenderer.js';

export function createLivePreviewController({
  app,
  liveDebug,
  markdownEngine,
  renderMarkdownHtml,
  normalizeLogString,
  sourceFirstMode = true,
  refreshLivePreviewEffect,
  fragmentCacheMax = 2500,
  slowBuildWarnMs = 12
} = {}) {
  function collectTopLevelBlocksSafe(doc) {
    const startedAt = performance.now();
    try {
      const blocks = collectTopLevelBlocks(doc, (source) => markdownEngine.parse(source, {}));
      liveDebug.trace('blocks.collected', {
        blockCount: blocks.length,
        docLength: doc.length,
        elapsedMs: Number((performance.now() - startedAt).toFixed(2))
      });
      return blocks;
    } catch (error) {
      liveDebug.error('blocks.collect.failed', {
        message: error instanceof Error ? error.message : String(error)
      });
      console.warn('Live preview block parser failed. Falling back to raw lines.', error);
      return [];
    }
  }

  class RenderedMarkdownBlockWidget extends WidgetType {
    constructor(
      html,
      sourceFrom,
      sourceTo = sourceFrom,
      fragmentFrom = sourceFrom,
      fragmentTo = sourceTo
    ) {
      super();
      this.html = html;
      this.sourceFrom = sourceFrom;
      this.sourceTo = sourceTo;
      this.fragmentFrom = fragmentFrom;
      this.fragmentTo = fragmentTo;
    }

    eq(other) {
      return (
        other.html === this.html &&
        other.sourceFrom === this.sourceFrom &&
        other.sourceTo === this.sourceTo &&
        other.fragmentFrom === this.fragmentFrom &&
        other.fragmentTo === this.fragmentTo
      );
    }

    toDOM() {
      const element = document.createElement('div');
      element.className = 'cm-rendered-block';
      element.dataset.sourceFrom = String(this.sourceFrom);
      element.dataset.sourceTo = String(this.sourceTo);
      element.dataset.fragmentFrom = String(this.fragmentFrom);
      element.dataset.fragmentTo = String(this.fragmentTo);
      element.innerHTML = this.html;
      return element;
    }

    ignoreEvent() {
      return false;
    }
  }

  function buildLivePreviewDecorations(state, blocks, fragmentHtmlCache = null) {
    if (app.viewMode !== 'live') {
      return Decoration.none;
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
      return ranges.length > 0 ? Decoration.set(ranges, true) : Decoration.none;
    }

    if (blocks.length === 0) {
      return Decoration.none;
    }

    const ranges = [];
    let skippedEmptyActiveLineBlocks = 0;
    let skippedEmptyBoundaryBlocks = 0;
    let skippedActiveFencedCodeBlocks = 0;
    let cacheHits = 0;
    let cacheMisses = 0;
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

    for (const block of blocks) {
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
        ranges.push(
          Decoration.replace({
            block: true,
            widget: new RenderedMarkdownBlockWidget(
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
      skippedEmptyActiveLineBlocks,
      skippedEmptyBoundaryBlocks,
      skippedActiveFencedCodeBlocks,
      decorationCount: ranges.length,
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

    return ranges.length > 0 ? Decoration.set(ranges, true) : Decoration.none;
  }

  const livePreviewStateField = StateField.define({
    create(state) {
      const blocks = collectTopLevelBlocksSafe(state.doc);
      const blockIndex = buildLiveBlockIndex(state.doc, blocks);
      const fragmentHtmlCache = new Map();
      const decorations = buildLivePreviewDecorations(state, blocks, fragmentHtmlCache);
      const lastSelectionLineFrom = state.doc.lineAt(state.selection.main.head).from;
      liveDebug.trace('block.index.rebuilt', {
        reason: 'create',
        blockCount: blocks.length,
        indexCount: blockIndex.length
      });
      return {
        blocks,
        blockIndex,
        decorations,
        fragmentHtmlCache,
        lastSelectionLineFrom
      };
    },
    update(value, transaction) {
      let blocks = value.blocks;
      let blockIndex = Array.isArray(value.blockIndex) ? value.blockIndex : [];
      let fragmentHtmlCache = value.fragmentHtmlCache;

      if (transaction.docChanged) {
        blocks = collectTopLevelBlocksSafe(transaction.state.doc);
        const nextBlockIndex = buildLiveBlockIndex(transaction.state.doc, blocks);
        const previousIds = new Set(blockIndex.map((entry) => entry.id));
        const nextIds = new Set(nextBlockIndex.map((entry) => entry.id));
        let addedCount = 0;
        let removedCount = 0;
        for (const id of nextIds) {
          if (!previousIds.has(id)) {
            addedCount += 1;
          }
        }
        for (const id of previousIds) {
          if (!nextIds.has(id)) {
            removedCount += 1;
          }
        }
        liveDebug.trace('block.index.rebuilt', {
          reason: 'doc-changed',
          blockCount: blocks.length,
          indexCount: nextBlockIndex.length
        });
        liveDebug.trace('block.index.delta', {
          previousCount: blockIndex.length,
          nextCount: nextBlockIndex.length,
          addedCount,
          removedCount
        });
        blockIndex = nextBlockIndex;
        fragmentHtmlCache = new Map();
      }

      const refreshReasons = transaction.effects
        .filter((effect) => effect.is(refreshLivePreviewEffect))
        .map((effect) => effect.value ?? 'manual');
      const refreshRequested = refreshReasons.length > 0;

      const previousSelection = transaction.startState.selection.main;
      const currentSelection = transaction.state.selection.main;
      const selectionSet =
        previousSelection.anchor !== currentSelection.anchor ||
        previousSelection.head !== currentSelection.head;

      const currentSelectionLineFrom = transaction.state.doc.lineAt(currentSelection.head).from;
      const selectionLineChanged =
        selectionSet && currentSelectionLineFrom !== value.lastSelectionLineFrom;
      const shouldRebuildDecorations =
        sourceFirstMode
          ? (transaction.docChanged || refreshRequested || selectionLineChanged)
          : (transaction.docChanged || refreshRequested || selectionLineChanged);

      if (shouldRebuildDecorations) {
        liveDebug.trace('plugin.update', {
          docChanged: transaction.docChanged,
          viewportChanged: false,
          selectionSet,
          selectionLineChanged,
          previousSelectionLineFrom: value.lastSelectionLineFrom,
          currentSelectionLineFrom,
          refreshRequested,
          refreshReasons
        });

        return {
          blocks,
          blockIndex,
          decorations: buildLivePreviewDecorations(
            transaction.state,
            blocks,
            fragmentHtmlCache
          ),
          fragmentHtmlCache,
          lastSelectionLineFrom: currentSelectionLineFrom
        };
      }

      if (selectionSet) {
        liveDebug.trace('plugin.update.selection-skipped', {
          previousSelectionLineFrom: value.lastSelectionLineFrom,
          currentSelectionLineFrom
        });

        if (sourceFirstMode && currentSelectionLineFrom !== value.lastSelectionLineFrom) {
          return {
            ...value,
            blocks,
            blockIndex,
            lastSelectionLineFrom: currentSelectionLineFrom
          };
        }
      }

      return value;
    }
  });

  function readLivePreviewState(state) {
    try {
      return state.field(livePreviewStateField);
    } catch {
      return null;
    }
  }

  function liveBlocksForView(view) {
    const livePreviewState = readLivePreviewState(view.state);
    return Array.isArray(livePreviewState?.blocks) ? livePreviewState.blocks : [];
  }

  function liveBlockIndexForView(view) {
    const livePreviewState = readLivePreviewState(view.state);
    return Array.isArray(livePreviewState?.blockIndex) ? livePreviewState.blockIndex : [];
  }

  function emitFenceVisibilityState(view, reason = 'selection-changed') {
    if (app.viewMode !== 'live') {
      return;
    }

    const selectionHead = view.state.selection.main.head;
    const blocks = liveBlocksForView(view);
    const fenceState = readFenceVisibilityState(view.state.doc, blocks, selectionHead);
    const indexedBlock = findIndexedBlockAtPosition(liveBlockIndexForView(view), selectionHead);
    liveDebug.trace('fence.visibility.state', {
      reason,
      selectionHead,
      indexedBlockType: indexedBlock?.type ?? null,
      indexedBlockId: indexedBlock?.id ?? null,
      ...fenceState
    });
  }

  function requestLivePreviewRefresh(view, reason = 'manual') {
    liveDebug.trace('refresh.requested', {
      mode: app.viewMode,
      reason
    });
    view.dispatch({
      effects: refreshLivePreviewEffect.of(reason)
    });
  }

  return {
    livePreviewStateField,
    requestLivePreviewRefresh,
    readLivePreviewState,
    liveBlocksForView,
    liveBlockIndexForView,
    emitFenceVisibilityState
  };
}
