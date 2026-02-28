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
  refreshLivePreviewEffect,
  renderMarkdownHtml = null
} = {}) {
  function normalizeViewportWindow(viewportWindow, docLength) {
    if (
      !viewportWindow ||
      !Number.isFinite(viewportWindow.from) ||
      !Number.isFinite(viewportWindow.to) ||
      viewportWindow.to <= viewportWindow.from
    ) {
      return null;
    }

    const max = Math.max(0, Math.trunc(docLength));
    const from = Math.max(0, Math.min(max, Math.trunc(viewportWindow.from)));
    const to = Math.max(from, Math.min(max, Math.trunc(viewportWindow.to)));
    return {
      from,
      to
    };
  }

  function normalizeRefreshPayload(value, docLength = 0) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return {
        reason: value,
        viewportWindow: null
      };
    }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return {
        reason: normalizeRefreshPayload(value.reason, docLength).reason,
        viewportWindow: normalizeViewportWindow(value.viewportWindow, docLength)
      };
    }

    return {
      reason: 'manual',
      viewportWindow: null
    };
  }

  function collectLiveModelSafe(doc, transaction = null, reason = 'state-read') {
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
        const inlineSpans = Array.isArray(sessionResult?.model?.inlineSpans)
          ? sessionResult.model.inlineSpans
          : Array.isArray(sessionResult?.model?.inline)
            ? sessionResult.model.inline
            : [];
        const elapsedMs = Number((performance.now() - startedAt).toFixed(2));
        const parserMeta = sessionResult?.model?.meta ?? {};
        liveDebug.trace('blocks.collected', {
          blockCount: blocks.length,
          inlineSpanCount: inlineSpans.length,
          docLength: doc.length,
          elapsedMs,
          strategy: parserMeta.parser ?? 'session',
          reason,
          reparsedCharLength: Number.isFinite(parserMeta.reparsedCharLength)
            ? parserMeta.reparsedCharLength
            : null
        });
        return {
          blocks,
          inlineSpans
        };
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
      return {
        blocks,
        inlineSpans: []
      };
    } catch (error) {
      liveDebug.error('blocks.collect.failed', {
        message: error instanceof Error ? error.message : String(error)
      });
      console.warn('Live preview block parser failed. Falling back to raw lines.', error);
      return {
        blocks: [],
        inlineSpans: []
      };
    }
  }

  const liveHybridRenderer = createLiveHybridRenderer({
    app,
    liveDebug,
    renderMarkdownHtml
  });

  const livePreviewStateField = StateField.define({
    create(state) {
      const liveModel = collectLiveModelSafe(state.doc, null, 'state-create');
      const blocks = liveModel.blocks;
      const inlineSpans = liveModel.inlineSpans;
      const blockIndex = buildLiveBlockIndex(state.doc, blocks);
      const initialRender = liveHybridRenderer.buildDecorations(state, blocks, null, {
        inlineSpans
      });
      const lastSelectionLineFrom = state.doc.lineAt(state.selection.main.head).from;
      liveDebug.trace('block.index.rebuilt', {
        reason: 'create',
        blockCount: blocks.length,
        indexCount: blockIndex.length
      });
      return {
        blocks,
        inlineSpans,
        blockIndex,
        decorations: initialRender.decorations,
        sourceMapIndex: initialRender.sourceMapIndex,
        fragmentMap: initialRender.fragmentMap,
        activeBlockId: initialRender.activeBlockId,
        activeLineFrom: initialRender.activeLineRange?.from ?? null,
        activeLineTo: initialRender.activeLineRange?.to ?? null,
        viewportWindow: initialRender.renderMetrics?.viewportFrom != null &&
          initialRender.renderMetrics?.viewportTo != null
          ? {
            from: initialRender.renderMetrics.viewportFrom,
            to: initialRender.renderMetrics.viewportTo
          }
          : null,
        renderMetrics: initialRender.renderMetrics,
        renderVersion: 1,
        lastSelectionLineFrom
      };
    },
    update(value, transaction) {
      let blocks = value.blocks;
      let inlineSpans = Array.isArray(value.inlineSpans) ? value.inlineSpans : [];
      let blockIndex = Array.isArray(value.blockIndex) ? value.blockIndex : [];
      let viewportWindow = value.viewportWindow ?? null;
      let renderVersion = Number.isFinite(value.renderVersion) ? Math.trunc(value.renderVersion) : 1;

      if (transaction.docChanged) {
        const liveModel = collectLiveModelSafe(transaction.state.doc, transaction, 'transaction-doc-changed');
        blocks = liveModel.blocks;
        inlineSpans = liveModel.inlineSpans;
        const nextBlockIndex = buildLiveBlockIndex(transaction.state.doc, blocks);
        blockIndex = nextBlockIndex;
      }

      const refreshPayloads = transaction.effects
        .filter((effect) => effect.is(refreshLivePreviewEffect))
        .map((effect) => normalizeRefreshPayload(effect.value, transaction.state.doc.length));
      const refreshReasons = refreshPayloads.map((payload) => payload.reason);
      const refreshRequested = refreshPayloads.length > 0;
      const latestViewportWindow = refreshPayloads
        .map((payload) => payload.viewportWindow)
        .filter(Boolean)
        .at(-1) ?? null;
      if (latestViewportWindow) {
        viewportWindow = latestViewportWindow;
      }

      const previousSelection = transaction.startState.selection.main;
      const currentSelection = transaction.state.selection.main;
      const selectionSet =
        previousSelection.anchor !== currentSelection.anchor ||
        previousSelection.head !== currentSelection.head;

      const currentSelectionLineFrom = transaction.state.doc.lineAt(currentSelection.head).from;
      const selectionLineChanged =
        selectionSet && currentSelectionLineFrom !== value.lastSelectionLineFrom;
      const shouldRebuildDecorations =
        transaction.docChanged || refreshRequested || selectionLineChanged;

      if (shouldRebuildDecorations) {
        const renderResult = liveHybridRenderer.buildDecorations(
          transaction.state,
          blocks,
          viewportWindow,
          {
            inlineSpans
          }
        );
        renderVersion += 1;
        viewportWindow = renderResult.renderMetrics?.viewportFrom != null &&
          renderResult.renderMetrics?.viewportTo != null
          ? {
            from: renderResult.renderMetrics.viewportFrom,
            to: renderResult.renderMetrics.viewportTo
          }
          : viewportWindow;
        liveDebug.trace('plugin.update', {
          docChanged: transaction.docChanged,
          selectionSet,
          selectionLineChanged,
          previousSelectionLineFrom: value.lastSelectionLineFrom,
          currentSelectionLineFrom,
          refreshRequested,
          refreshReasons,
          activeBlockId: renderResult.activeBlockId,
          activeLineFrom: renderResult.activeLineRange?.from ?? null,
          activeLineTo: renderResult.activeLineRange?.to ?? null,
          renderedFragmentCount: renderResult.fragmentMap.length,
          viewportFrom: renderResult.renderMetrics?.viewportFrom ?? null,
          viewportTo: renderResult.renderMetrics?.viewportTo ?? null,
          renderVersion
        });

        return {
          blocks,
          inlineSpans,
          blockIndex,
          decorations: renderResult.decorations,
          sourceMapIndex: renderResult.sourceMapIndex,
          fragmentMap: renderResult.fragmentMap,
          activeBlockId: renderResult.activeBlockId,
          activeLineFrom: renderResult.activeLineRange?.from ?? null,
          activeLineTo: renderResult.activeLineRange?.to ?? null,
          viewportWindow,
          renderMetrics: renderResult.renderMetrics,
          renderVersion,
          lastSelectionLineFrom: currentSelectionLineFrom
        };
      }

      if (selectionSet && currentSelectionLineFrom === value.lastSelectionLineFrom) {
        liveDebug.trace('plugin.update.selection-skipped', {
          previousSelectionLineFrom: value.lastSelectionLineFrom,
          currentSelectionLineFrom
        });
      }

      if (selectionSet && currentSelectionLineFrom !== value.lastSelectionLineFrom) {
        return {
          ...value,
          blocks,
          inlineSpans,
          blockIndex,
          viewportWindow,
          renderVersion,
          lastSelectionLineFrom: currentSelectionLineFrom
        };
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
    const refreshPayload = normalizeRefreshPayload(reason, view?.state?.doc?.length ?? 0);
    liveDebug.trace('refresh.requested', {
      mode: app.viewMode,
      reason: refreshPayload.reason,
      viewportFrom: refreshPayload.viewportWindow?.from ?? null,
      viewportTo: refreshPayload.viewportWindow?.to ?? null
    });
    view.dispatch({
      effects: refreshLivePreviewEffect.of(refreshPayload)
    });
  }

  return {
    livePreviewStateField,
    requestLivePreviewRefresh,
    readLivePreviewState,
    liveBlocksForView,
    liveSourceMapIndexForView,
    emitFenceVisibilityState
  };
}
