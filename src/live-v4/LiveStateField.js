import { StateEffect, StateField } from '@codemirror/state';

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

function normalizeRefreshPayload(payload, docLength) {
  if (typeof payload === 'string' && payload.trim().length > 0) {
    return {
      reason: payload,
      viewportWindow: null
    };
  }

  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return {
      reason: typeof payload.reason === 'string' && payload.reason.trim().length > 0
        ? payload.reason
        : 'manual',
      viewportWindow: normalizeViewportWindow(payload.viewportWindow, docLength)
    };
  }

  return {
    reason: 'manual',
    viewportWindow: null
  };
}

export function createLiveStateField({
  parser,
  renderer,
  liveDebug
} = {}) {
  const refreshEffect = StateEffect.define();

  function collectModel(state, transaction = null) {
    if (!parser) {
      return null;
    }

    if (transaction?.docChanged) {
      return parser.applyEditorTransaction(transaction)?.model ?? null;
    }

    return parser.ensureText(state.doc.toString())?.model ?? parser.getModel?.() ?? null;
  }

  const liveStateField = StateField.define({
    create(state) {
      const model = collectModel(state, null);
      const projection = renderer.buildRenderProjection(state, model, null);
      return {
        model,
        decorations: projection.decorations,
        interactionMap: projection.interactionMap,
        activeBlockId: projection.activeBlockId,
        metrics: projection.metrics,
        viewportWindow: projection.viewportWindow,
        version: 1,
        lastSelectionLineFrom: state.doc.lineAt(state.selection.main.head).from
      };
    },
    update(value, transaction) {
      let model = value.model;
      if (transaction.docChanged) {
        model = collectModel(transaction.state, transaction);
      }

      const refreshPayloads = transaction.effects
        .filter((effect) => effect.is(refreshEffect))
        .map((effect) => normalizeRefreshPayload(effect.value, transaction.state.doc.length));
      const refreshRequested = refreshPayloads.length > 0;
      const latestViewportWindow = refreshPayloads
        .map((payload) => payload.viewportWindow)
        .filter(Boolean)
        .at(-1) ?? null;

      let viewportWindow = latestViewportWindow ?? value.viewportWindow;

      const previousSelection = transaction.startState.selection.main;
      const currentSelection = transaction.state.selection.main;
      const selectionSet = (
        previousSelection.anchor !== currentSelection.anchor ||
        previousSelection.head !== currentSelection.head
      );

      const selectionLineFrom = transaction.state.doc.lineAt(currentSelection.head).from;
      const selectionLineChanged = selectionSet && selectionLineFrom !== value.lastSelectionLineFrom;
      const shouldRebuild = transaction.docChanged || refreshRequested || selectionLineChanged;
      liveDebug?.trace?.('plugin.update', {
        docChanged: Boolean(transaction.docChanged),
        selectionSet,
        selectionLineChanged,
        refreshRequested
      });

      if (!shouldRebuild) {
        if (selectionSet) {
          liveDebug?.trace?.('plugin.update.selection-skipped', {
            previousSelectionLineFrom: value.lastSelectionLineFrom,
            currentSelectionLineFrom: selectionLineFrom
          });
          return {
            ...value,
            model,
            lastSelectionLineFrom: selectionLineFrom
          };
        }
        return value;
      }

      const projection = renderer.buildRenderProjection(transaction.state, model, viewportWindow);
      viewportWindow = projection.viewportWindow ?? viewportWindow;
      const version = value.version + 1;

      liveDebug?.trace?.('live-v4.state.updated', {
        docChanged: transaction.docChanged,
        selectionLineChanged,
        refreshRequested,
        activeBlockId: projection.activeBlockId,
        renderedBlockCount: projection.metrics.renderedBlockCount,
        version
      });

      return {
        model,
        decorations: projection.decorations,
        interactionMap: projection.interactionMap,
        activeBlockId: projection.activeBlockId,
        metrics: projection.metrics,
        viewportWindow,
        version,
        lastSelectionLineFrom: selectionLineFrom
      };
    }
  });

  function readLiveState(state) {
    try {
      return state.field(liveStateField);
    } catch {
      return null;
    }
  }

  function requestRefresh(view, reason = 'manual', viewportWindow = null) {
    const payload = normalizeRefreshPayload({ reason, viewportWindow }, view.state.doc.length);
    liveDebug?.trace?.('refresh.requested', {
      reason: payload.reason,
      viewportFrom: payload.viewportWindow?.from ?? null,
      viewportTo: payload.viewportWindow?.to ?? null
    });
    view.dispatch({
      effects: refreshEffect.of(payload)
    });
  }

  function readInteractionMapForView(view) {
    const liveState = readLiveState(view.state);
    return Array.isArray(liveState?.interactionMap) ? liveState.interactionMap : [];
  }

  return {
    liveStateField,
    refreshEffect,
    readLiveState,
    requestRefresh,
    readInteractionMapForView
  };
}
