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
  function normalizeRefreshReason(value) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return normalizeRefreshReason(value.reason);
    }

    return 'manual';
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
    renderMarkdownHtml
  });

  const livePreviewStateField = StateField.define({
    create(state) {
      const blocks = collectTopLevelBlocksSafe(state.doc, null, 'state-create');
      const blockIndex = buildLiveBlockIndex(state.doc, blocks);
      const initialRender = liveHybridRenderer.buildDecorations(state, blocks);
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
        fragmentMap: initialRender.fragmentMap,
        activeBlockId: initialRender.activeBlockId,
        lastSelectionLineFrom
      };
    },
    update(value, transaction) {
      let blocks = value.blocks;
      let blockIndex = Array.isArray(value.blockIndex) ? value.blockIndex : [];

      if (transaction.docChanged) {
        blocks = collectTopLevelBlocksSafe(transaction.state.doc, transaction, 'transaction-doc-changed');
        const nextBlockIndex = buildLiveBlockIndex(transaction.state.doc, blocks);
        blockIndex = nextBlockIndex;
      }

      const refreshReasons = transaction.effects
        .filter((effect) => effect.is(refreshLivePreviewEffect))
        .map((effect) => normalizeRefreshReason(effect.value));
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
        transaction.docChanged || refreshRequested || selectionLineChanged;

      if (shouldRebuildDecorations) {
        const renderResult = liveHybridRenderer.buildDecorations(transaction.state, blocks);
        liveDebug.trace('plugin.update', {
          docChanged: transaction.docChanged,
          selectionSet,
          selectionLineChanged,
          previousSelectionLineFrom: value.lastSelectionLineFrom,
          currentSelectionLineFrom,
          refreshRequested,
          refreshReasons,
          activeBlockId: renderResult.activeBlockId,
          renderedFragmentCount: renderResult.fragmentMap.length
        });

        return {
          blocks,
          blockIndex,
          decorations: renderResult.decorations,
          sourceMapIndex: renderResult.sourceMapIndex,
          fragmentMap: renderResult.fragmentMap,
          activeBlockId: renderResult.activeBlockId,
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
          blockIndex,
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
    const refreshReason = normalizeRefreshReason(reason);
    liveDebug.trace('refresh.requested', {
      mode: app.viewMode,
      reason: refreshReason
    });
    view.dispatch({
      effects: refreshLivePreviewEffect.of(refreshReason)
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
