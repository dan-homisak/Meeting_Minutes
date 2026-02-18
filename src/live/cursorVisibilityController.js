import { EditorSelection } from '@codemirror/state';

export function createCursorVisibilityController({
  app,
  liveDebug,
  liveDebugDiagnostics,
  liveDebugCursorMaxExpectedHeightPx = 42,
  liveDebugCursorProbeThrottleMs = 100,
  liveDebugCursorActiveLineMissingThrottleMs = 220,
  liveDebugGutterProbeThrottleMs = 220,
  liveDebugCursorRecoveryCooldownMs = 260,
  readCursorVisibilityForLog,
  readDomSelectionForLog,
  readGutterVisibilityForLog,
  requestLivePreviewRefresh,
  captureLiveDebugSnapshot,
  requestAnimationFrameFn = (callback) => window.requestAnimationFrame(callback),
  createCursorSelection = (position, assoc) => EditorSelection.cursor(position, assoc)
} = {}) {
  function isCursorVisibilitySuspect(cursorState, selectionLineLength, domSelectionOnContentContainer) {
    if (!cursorState?.hasView) {
      return true;
    }

    const offToRightOnEmptyLine =
      selectionLineLength === 0 &&
      (cursorState.nearRightEdge || cursorState.farRightFromScroller);
    const oversizedCursorHeight =
      cursorState.oversizedHeight ||
      (Number.isFinite(cursorState.cursorHeight) &&
        cursorState.cursorHeight > liveDebugCursorMaxExpectedHeightPx);

    return (
      !cursorState.hasCursorElement ||
      cursorState.cursorHeight === 0 ||
      !cursorState.inVerticalViewport ||
      !cursorState.inHorizontalViewport ||
      cursorState.farRightFromScroller ||
      oversizedCursorHeight ||
      cursorState.oversizedWidth ||
      offToRightOnEmptyLine ||
      (domSelectionOnContentContainer && (oversizedCursorHeight || offToRightOnEmptyLine))
    );
  }

  function attemptCursorRecovery(
    view,
    reason,
    selectionHead,
    selectionLineNumber,
    selectionLineLength,
    cursorState
  ) {
    if (app.viewMode !== 'live') {
      return;
    }

    const now = Date.now();
    if (liveDebugDiagnostics.cursorRecoveryInFlight) {
      return;
    }

    if (now - liveDebugDiagnostics.lastCursorRecoveryAt < liveDebugCursorRecoveryCooldownMs) {
      return;
    }

    liveDebugDiagnostics.cursorRecoveryInFlight = true;
    liveDebugDiagnostics.lastCursorRecoveryAt = now;

    const runRecoveryDispatch = (assoc, step) => {
      view.dispatch({
        selection: createCursorSelection(selectionHead, assoc),
        scrollIntoView: true
      });
      view.focus();

      liveDebug.warn('cursor.recover.dispatch', {
        reason,
        step,
        assoc,
        selectionHead,
        selectionLineNumber,
        selectionLineLength,
        cursorState
      });
      scheduleCursorVisibilityProbe(view, `cursor-recover-${step}`);
    };

    try {
      runRecoveryDispatch(-1, 'primary');
      requestLivePreviewRefresh('cursor-recover-primary');
    } catch (error) {
      liveDebugDiagnostics.cursorRecoveryInFlight = false;
      liveDebug.error('cursor.recover.failed', {
        reason,
        step: 'primary',
        selectionHead,
        selectionLineNumber,
        message: error instanceof Error ? error.message : String(error)
      });
      return;
    }

    requestAnimationFrameFn(() => {
      try {
        if (app.viewMode !== 'live') {
          return;
        }

        if (view.state.selection.main.head !== selectionHead) {
          return;
        }

        const nextCursorState = readCursorVisibilityForLog(view, selectionHead);
        const stillSuspect = isCursorVisibilitySuspect(nextCursorState, selectionLineLength, false);
        if (!stillSuspect) {
          return;
        }

        runRecoveryDispatch(1, 'secondary');
        requestLivePreviewRefresh('cursor-recover-secondary');
      } catch (error) {
        liveDebug.error('cursor.recover.failed', {
          reason,
          step: 'secondary',
          selectionHead,
          selectionLineNumber,
          message: error instanceof Error ? error.message : String(error)
        });
      } finally {
        liveDebugDiagnostics.cursorRecoveryInFlight = false;
      }
    });
  }

  function probeCursorVisibility(view, reason = 'manual') {
    if (app.viewMode !== 'live') {
      return;
    }

    const now = Date.now();
    if (
      reason === 'selection-changed' &&
      now - liveDebugDiagnostics.lastCursorProbeAt < liveDebugCursorProbeThrottleMs
    ) {
      return;
    }
    liveDebugDiagnostics.lastCursorProbeAt = now;

    const selection = view.state.selection.main;
    const selectionLine = view.state.doc.lineAt(selection.head);
    const selectionLineLength = Math.max(0, selectionLine.to - selectionLine.from);
    const cursorState = readCursorVisibilityForLog(view, selection.head);
    const domSelection = readDomSelectionForLog();
    const hasFocus = Boolean(view.hasFocus);
    const expectCursor = hasFocus && selection.empty;
    const domSelectionOnContentContainer =
      typeof domSelection?.anchorNode?.className === 'string' &&
      domSelection.anchorNode.className.includes('cm-content');
    const transientCursorDrift =
      expectCursor &&
      cursorState.cursorOutOfSyncWithHeadCoords &&
      !cursorState.nearRightEdge &&
      !cursorState.farRightFromScroller;
    const offToRightOnEmptyLine =
      selectionLineLength === 0 &&
      (cursorState.nearRightEdge || cursorState.farRightFromScroller);
    const missingActiveLineElement =
      expectCursor &&
      selectionLineLength === 0 &&
      !cursorState.activeLineElementPresent;
    const suspectCursorVisibility =
      expectCursor &&
      isCursorVisibilitySuspect(
        cursorState,
        selectionLineLength,
        domSelectionOnContentContainer
      );

    liveDebug.trace('cursor.visibility.probe', {
      reason,
      hasFocus,
      selectionAnchor: selection.anchor,
      selectionHead: selection.head,
      selectionLineNumber: selectionLine.number,
      selectionLineLength,
      domSelectionOnContentContainer,
      expectCursor,
      transientCursorDrift,
      offToRightOnEmptyLine,
      missingActiveLineElement,
      suspectCursorVisibility,
      cursorState,
      domSelection
    });

    if (
      reason === 'selection-changed' &&
      transientCursorDrift
    ) {
      liveDebug.trace('cursor.visibility.defer-transient-drift', {
        reason,
        selectionHead: selection.head,
        selectionLineNumber: selectionLine.number,
        selectionLineLength,
        cursorState
      });
      scheduleCursorVisibilityProbe(view, 'selection-changed-transient-reprobe');
      return;
    }

    if (missingActiveLineElement) {
      const shouldLogActiveLineMissing =
        now - liveDebugDiagnostics.lastCursorActiveLineMissingLoggedAt >=
        liveDebugCursorActiveLineMissingThrottleMs;
      if (shouldLogActiveLineMissing) {
        liveDebugDiagnostics.lastCursorActiveLineMissingLoggedAt = now;
        liveDebug.warn('cursor.active-line.missing', {
          reason,
          selectionHead: selection.head,
          selectionLineNumber: selectionLine.number,
          selectionLineLength,
          cursorState
        });
      }
    }

    if (now - liveDebugDiagnostics.lastGutterProbeAt >= liveDebugGutterProbeThrottleMs) {
      liveDebugDiagnostics.lastGutterProbeAt = now;
      const gutterState = readGutterVisibilityForLog(view);
      liveDebug.trace('gutter.visibility.probe', {
        reason,
        mode: app.viewMode,
        gutterState
      });

      const gutterHiddenInLiveMode =
        app.viewMode === 'live' &&
        gutterState?.hasGutters &&
        (gutterState.display === 'none' || gutterState.visibility === 'hidden');
      if (gutterHiddenInLiveMode) {
        liveDebug.warn('gutter.visibility.hidden', {
          reason,
          gutterState
        });
      }
    }

    if (suspectCursorVisibility) {
      liveDebug.warn('cursor.visibility.suspect', {
        reason,
        hasFocus,
        selectionAnchor: selection.anchor,
        selectionHead: selection.head,
        cursorState,
        domSelection
      });
      captureLiveDebugSnapshot('cursor-visibility-suspect');
      attemptCursorRecovery(
        view,
        reason,
        selection.head,
        selectionLine.number,
        selectionLineLength,
        cursorState
      );
    }
  }

  function scheduleCursorVisibilityProbe(view, reason = 'manual') {
    if (!view || app.viewMode !== 'live') {
      return;
    }

    requestAnimationFrameFn(() => {
      requestAnimationFrameFn(() => {
        probeCursorVisibility(view, reason);
      });
    });
  }

  return {
    isCursorVisibilitySuspect,
    attemptCursorRecovery,
    probeCursorVisibility,
    scheduleCursorVisibilityProbe
  };
}
