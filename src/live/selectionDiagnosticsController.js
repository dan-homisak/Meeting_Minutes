export function createSelectionDiagnosticsController({
  app,
  liveDebug,
  liveDebugDiagnostics,
  liveDebugSelectionJumpWarnLineDelta = 20,
  liveDebugSelectionJumpWarnPosDelta = 80,
  liveDebugSelectionJumpSuppressAfterProgrammaticMs = 900,
  readRecentInputSignal,
  readDomSelectionForLog,
  scheduleCursorVisibilityProbe,
  emitFenceVisibilityState,
  captureLiveDebugSnapshot,
  transactionUserEventAnnotation,
  isRefreshEffect,
  nowFn = () => Date.now()
} = {}) {
  const readRecentSignal =
    typeof readRecentInputSignal === 'function' ? readRecentInputSignal : () => null;
  const readDomSelection =
    typeof readDomSelectionForLog === 'function' ? readDomSelectionForLog : () => null;
  const scheduleCursorProbe =
    typeof scheduleCursorVisibilityProbe === 'function'
      ? scheduleCursorVisibilityProbe
      : () => {};
  const emitFenceState =
    typeof emitFenceVisibilityState === 'function' ? emitFenceVisibilityState : () => {};
  const captureSnapshot =
    typeof captureLiveDebugSnapshot === 'function' ? captureLiveDebugSnapshot : () => {};
  const readNow = typeof nowFn === 'function' ? nowFn : () => Date.now();

  function readTransactionUserEvent(transaction) {
    if (
      !transaction ||
      typeof transaction.annotation !== 'function' ||
      transactionUserEventAnnotation === undefined
    ) {
      return null;
    }
    return transaction.annotation(transactionUserEventAnnotation);
  }

  function countRefreshEffects(transaction) {
    if (!Array.isArray(transaction?.effects) || transaction.effects.length === 0) {
      return 0;
    }
    if (typeof isRefreshEffect !== 'function') {
      return 0;
    }
    return transaction.effects.filter((effect) => isRefreshEffect(effect)).length;
  }

  function summarizeTransactionsForLog(update) {
    if (!Array.isArray(update?.transactions) || update.transactions.length === 0) {
      return {
        count: 0,
        selectionTransactions: 0,
        docChangedTransactions: 0,
        refreshEffectTransactions: 0,
        details: []
      };
    }

    const details = update.transactions.slice(0, 4).map((transaction, index) => ({
      index,
      docChanged: Boolean(transaction?.docChanged),
      hasSelection: Boolean(transaction?.selection),
      effectCount: Array.isArray(transaction?.effects) ? transaction.effects.length : 0,
      userEvent: readTransactionUserEvent(transaction) ?? null,
      refreshEffects: countRefreshEffects(transaction)
    }));

    return {
      count: update.transactions.length,
      selectionTransactions: details.filter((entry) => entry.hasSelection).length,
      docChangedTransactions: details.filter((entry) => entry.docChanged).length,
      refreshEffectTransactions: details.reduce((sum, entry) => sum + entry.refreshEffects, 0),
      details
    };
  }

  function collectTransactionUserEvents(update) {
    if (!Array.isArray(update?.transactions) || update.transactions.length === 0) {
      return [];
    }

    const seen = new Set();
    for (const transaction of update.transactions) {
      const userEvent = readTransactionUserEvent(transaction);
      if (typeof userEvent === 'string' && userEvent.trim()) {
        seen.add(userEvent);
      }
    }

    return [...seen];
  }

  function handleSelectionUpdate(update) {
    if (
      !update?.selectionSet ||
      !update?.view ||
      !update?.startState?.selection?.main ||
      !update?.state?.selection?.main ||
      typeof update.startState?.doc?.lineAt !== 'function' ||
      typeof update.state?.doc?.lineAt !== 'function'
    ) {
      return;
    }

    const previousSelection = update.startState.selection.main;
    const currentSelection = update.state.selection.main;
    const previousLine = update.startState.doc.lineAt(previousSelection.head);
    const currentLine = update.state.doc.lineAt(currentSelection.head);
    const positionDelta = Math.abs(currentSelection.head - previousSelection.head);
    const lineDelta = Math.abs(currentLine.number - previousLine.number);
    const userEvents = collectTransactionUserEvents(update);
    const recentInput = readRecentSignal();
    const transactionSummary = summarizeTransactionsForLog(update);
    const domSelection = readDomSelection();
    const now = readNow();
    const hasRecentInput = Boolean(recentInput && Number.isFinite(recentInput.ageMs));
    const programmaticSelectionAgeMs = now - liveDebugDiagnostics.lastProgrammaticSelectionAt;
    const shouldSuppressJumpDetection =
      app.isLoadingFile ||
      (
        Number.isFinite(programmaticSelectionAgeMs) &&
        programmaticSelectionAgeMs >= 0 &&
        programmaticSelectionAgeMs <=
          liveDebugSelectionJumpSuppressAfterProgrammaticMs
      ) ||
      (update.docChanged && !hasRecentInput);

    liveDebug.trace('selection.changed', {
      anchor: currentSelection.anchor,
      head: currentSelection.head,
      previousAnchor: previousSelection.anchor,
      previousHead: previousSelection.head,
      previousLineNumber: previousLine.number,
      currentLineNumber: currentLine.number,
      positionDelta,
      lineDelta,
      docChanged: update.docChanged,
      userEvents,
      recentInputKind: recentInput?.kind ?? null,
      recentInputTrigger: recentInput?.trigger ?? null,
      recentInputKey: recentInput?.key ?? null,
      recentInputAgeMs: recentInput?.ageMs ?? null,
      programmaticSelectionAgeMs: Number.isFinite(programmaticSelectionAgeMs)
        ? programmaticSelectionAgeMs
        : null,
      jumpDetectionSuppressed: shouldSuppressJumpDetection,
      transactionSummary,
      domSelection
    });
    scheduleCursorProbe(update.view, 'selection-changed');
    emitFenceState(update.view, 'selection-changed');

    const likelyUnexpectedJump =
      positionDelta >= liveDebugSelectionJumpWarnPosDelta &&
      lineDelta >= liveDebugSelectionJumpWarnLineDelta;
    if (likelyUnexpectedJump && shouldSuppressJumpDetection) {
      liveDebug.trace('selection.jump.suppressed', {
        previousHead: previousSelection.head,
        currentHead: currentSelection.head,
        previousLineNumber: previousLine.number,
        currentLineNumber: currentLine.number,
        positionDelta,
        lineDelta,
        docChanged: update.docChanged,
        appIsLoadingFile: app.isLoadingFile,
        programmaticSelectionAgeMs: Number.isFinite(programmaticSelectionAgeMs)
          ? programmaticSelectionAgeMs
          : null,
        recentInputKind: recentInput?.kind ?? null,
        recentInputKey: recentInput?.key ?? null,
        recentInputAgeMs: recentInput?.ageMs ?? null,
        userEvents
      });
    }
    if (
      likelyUnexpectedJump &&
      !shouldSuppressJumpDetection &&
      now - liveDebugDiagnostics.lastSelectionJumpLoggedAt > 500
    ) {
      liveDebugDiagnostics.lastSelectionJumpLoggedAt = now;
      liveDebug.warn('selection.jump.detected', {
        previousHead: previousSelection.head,
        currentHead: currentSelection.head,
        previousLineNumber: previousLine.number,
        currentLineNumber: currentLine.number,
        positionDelta,
        lineDelta,
        userEvents,
        recentInputKind: recentInput?.kind ?? null,
        recentInputTrigger: recentInput?.trigger ?? null,
        recentInputKey: recentInput?.key ?? null,
        recentInputAgeMs: recentInput?.ageMs ?? null,
        transactionSummary,
        domSelection
      });
      captureSnapshot('selection-jump-detected');
    }
  }

  return {
    summarizeTransactionsForLog,
    collectTransactionUserEvents,
    handleSelectionUpdate
  };
}
