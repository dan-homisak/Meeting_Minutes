import { StateField } from '@codemirror/state';
import { createLiveHybridRenderer } from '../core/render/LiveHybridRenderer.js';
import {
  buildLiveBlockIndex,
  findIndexedBlockAtPosition,
  readFenceVisibilityState
} from '../core/render/LiveBlockIndex.js';
import {
  collectTopLevelBlocks
} from '../core/parser/BlockRangeCollector.js';

export function createLivePreviewController({
  app,
  liveDebug,
  markdownEngine,
  documentSession = null,
  renderMarkdownHtml,
  normalizeLogString,
  sourceFirstMode = true,
  refreshLivePreviewEffect,
  fragmentCacheMax = 2500,
  slowBuildWarnMs = 12,
  viewportLineBuffer = 8,
  viewportMinimumLineSpan = 24,
  maxViewportBlocks = 160,
  maxViewportCharacters = 24000
} = {}) {
  function normalizeRefreshRequestValue(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const reason =
        typeof value.reason === 'string' && value.reason.trim().length > 0
          ? value.reason
          : 'manual';
      const viewport =
        Number.isFinite(value.viewport?.from) && Number.isFinite(value.viewport?.to)
          ? {
            from: Math.trunc(value.viewport.from),
            to: Math.trunc(value.viewport.to)
          }
          : null;
      const visibleRanges = Array.isArray(value.visibleRanges)
        ? value.visibleRanges
          .filter((range) => Number.isFinite(range?.from) && Number.isFinite(range?.to))
          .map((range) => ({
            from: Math.trunc(range.from),
            to: Math.trunc(range.to)
          }))
        : [];
      return {
        reason,
        viewport,
        visibleRanges
      };
    }

    if (typeof value === 'string' && value.trim().length > 0) {
      return {
        reason: value,
        viewport: null,
        visibleRanges: []
      };
    }

    return {
      reason: 'manual',
      viewport: null,
      visibleRanges: []
    };
  }

  function buildRefreshRequest(view, reason = 'manual') {
    const normalizedReason =
      typeof reason === 'string' && reason.trim().length > 0 ? reason : 'manual';
    const viewport =
      Number.isFinite(view?.viewport?.from) && Number.isFinite(view?.viewport?.to)
        ? {
          from: Math.trunc(view.viewport.from),
          to: Math.trunc(view.viewport.to)
        }
        : null;
    const visibleRanges = Array.isArray(view?.visibleRanges)
      ? view.visibleRanges
        .filter((range) => Number.isFinite(range?.from) && Number.isFinite(range?.to))
        .map((range) => ({
          from: Math.trunc(range.from),
          to: Math.trunc(range.to)
        }))
      : [];

    return {
      reason: normalizedReason,
      viewport,
      visibleRanges
    };
  }

  function collectTopLevelBlocksSafe(doc, transaction = null, reason = 'state-read') {
    const startedAt = performance.now();
    if (documentSession) {
      try {
        let sessionResult = null;
        if (transaction?.docChanged) {
          sessionResult = documentSession.applyEditorTransaction(transaction);
        } else {
          sessionResult = documentSession.ensureText(doc.toString());
        }

        const blocks = Array.isArray(sessionResult?.model?.blocks) ? sessionResult.model.blocks : [];
        const elapsedMs = Number((performance.now() - startedAt).toFixed(2));
        const parserMeta = sessionResult?.model?.meta ?? {};
        liveDebug.trace('blocks.collected', {
          blockCount: blocks.length,
          docLength: doc.length,
          elapsedMs,
          strategy: parserMeta.parser ?? 'session',
          reason,
          reparsedCharLength: Number.isFinite(parserMeta.reparsedCharLength)
            ? parserMeta.reparsedCharLength
            : null
        });
        return blocks;
      } catch (error) {
        liveDebug.error('blocks.collect.session-failed', {
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }

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
  const liveHybridRenderer = createLiveHybridRenderer({
    app,
    liveDebug,
    renderMarkdownHtml,
    normalizeLogString,
    sourceFirstMode,
    fragmentCacheMax,
    slowBuildWarnMs,
    viewportLineBuffer,
    viewportMinimumLineSpan,
    maxViewportBlocks,
    maxViewportCharacters
  });

  const livePreviewStateField = StateField.define({
    create(state) {
      const blocks = collectTopLevelBlocksSafe(state.doc, null, 'state-create');
      const blockIndex = buildLiveBlockIndex(state.doc, blocks);
      const fragmentHtmlCache = new Map();
      const initialRender = liveHybridRenderer.buildDecorations(state, blocks, fragmentHtmlCache);
      const lastSelectionLineFrom = state.doc.lineAt(state.selection.main.head).from;
      liveDebug.trace('block.index.rebuilt', {
        reason: 'create',
        blockCount: blocks.length,
        indexCount: blockIndex.length
      });
      return {
        blocks,
        blockIndex,
        decorations: initialRender.decorations,
        sourceMapIndex: initialRender.sourceMapIndex,
        fragmentHtmlCache,
        lastSelectionLineFrom
      };
    },
    update(value, transaction) {
      let blocks = value.blocks;
      let blockIndex = Array.isArray(value.blockIndex) ? value.blockIndex : [];
      let fragmentHtmlCache = value.fragmentHtmlCache;

      if (transaction.docChanged) {
        blocks = collectTopLevelBlocksSafe(transaction.state.doc, transaction, 'transaction-doc-changed');
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

      const refreshRequests = transaction.effects
        .filter((effect) => effect.is(refreshLivePreviewEffect))
        .map((effect) => normalizeRefreshRequestValue(effect.value));
      const refreshReasons = refreshRequests.map((request) => request.reason);
      const refreshRequested = refreshReasons.length > 0;
      const latestRefreshRequest = refreshRequests.length > 0
        ? refreshRequests[refreshRequests.length - 1]
        : null;

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
          viewportChanged: refreshReasons.includes('viewport-changed'),
          selectionSet,
          selectionLineChanged,
          previousSelectionLineFrom: value.lastSelectionLineFrom,
          currentSelectionLineFrom,
          refreshRequested,
          refreshReasons,
          viewportRangeCount: latestRefreshRequest?.visibleRanges?.length ?? 0
        });

        const renderResult = liveHybridRenderer.buildDecorations(
          transaction.state,
          blocks,
          fragmentHtmlCache,
          {
            viewport: latestRefreshRequest?.viewport ?? null,
            visibleRanges: latestRefreshRequest?.visibleRanges ?? []
          }
        );
        return {
          blocks,
          blockIndex,
          decorations: renderResult.decorations,
          sourceMapIndex: renderResult.sourceMapIndex,
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

  function liveSourceMapIndexForView(view) {
    const livePreviewState = readLivePreviewState(view.state);
    return Array.isArray(livePreviewState?.sourceMapIndex) ? livePreviewState.sourceMapIndex : [];
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
    const refreshRequest = buildRefreshRequest(view, reason);
    liveDebug.trace('refresh.requested', {
      mode: app.viewMode,
      reason: refreshRequest.reason,
      viewportFrom: refreshRequest.viewport?.from ?? null,
      viewportTo: refreshRequest.viewport?.to ?? null,
      viewportRangeCount: refreshRequest.visibleRanges.length
    });
    view.dispatch({
      effects: refreshLivePreviewEffect.of(refreshRequest)
    });
  }

  return {
    livePreviewStateField,
    requestLivePreviewRefresh,
    readLivePreviewState,
    liveBlocksForView,
    liveBlockIndexForView,
    liveSourceMapIndexForView,
    emitFenceVisibilityState
  };
}
