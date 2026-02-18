export function createLiveSnapshotController({
  app,
  liveDebug,
  liveDebugDiagnostics,
  liveDebugInputTtlMs = 900,
  getEditorView,
  readLivePreviewState,
  findBlockContainingPosition,
  findNearestBlockForPosition,
  readDomSelectionForLog,
  getQueuedUploadEntryCount,
  nowFn = () => Date.now()
} = {}) {
  const readEditorView = typeof getEditorView === 'function' ? getEditorView : () => null;
  const readPreviewState = typeof readLivePreviewState === 'function' ? readLivePreviewState : () => null;
  const findContainingBlock =
    typeof findBlockContainingPosition === 'function' ? findBlockContainingPosition : () => null;
  const findNearestBlock =
    typeof findNearestBlockForPosition === 'function' ? findNearestBlockForPosition : () => null;
  const readDomSelection =
    typeof readDomSelectionForLog === 'function' ? readDomSelectionForLog : () => null;
  const readQueueCount =
    typeof getQueuedUploadEntryCount === 'function' ? getQueuedUploadEntryCount : () => null;
  const readNow = typeof nowFn === 'function' ? nowFn : () => Date.now();

  function recordInputSignal(kind, details = {}) {
    const signal = {
      at: readNow(),
      kind,
      ...details
    };
    liveDebugDiagnostics.lastInputSignal = signal;
    return signal;
  }

  function readRecentInputSignal(maxAgeMs = liveDebugInputTtlMs) {
    const signal = liveDebugDiagnostics.lastInputSignal;
    if (!signal) {
      return null;
    }

    const ageMs = readNow() - signal.at;
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > maxAgeMs) {
      return null;
    }

    return {
      ...signal,
      ageMs
    };
  }

  function captureLiveDebugSnapshot(reason = 'manual') {
    const editorView = readEditorView();
    if (!editorView?.state) {
      liveDebug.trace('snapshot.unavailable', {
        reason,
        hasEditor: false
      });
      return;
    }

    const state = editorView.state;
    const selection = state.selection.main;
    const selectionLine = state.doc.lineAt(selection.head);
    const livePreviewState = readPreviewState(state);
    const blocks = Array.isArray(livePreviewState?.blocks) ? livePreviewState.blocks : [];
    const activeBlock =
      findContainingBlock(blocks, selection.head) ??
      findNearestBlock(blocks, selection.head, 1);
    const recentInput = readRecentInputSignal();

    liveDebug.info('snapshot.editor', {
      reason,
      mode: app.viewMode,
      currentPath: app.currentPath,
      docLength: state.doc.length,
      lineCount: state.doc.lines,
      selectionAnchor: selection.anchor,
      selectionHead: selection.head,
      selectionLineNumber: selectionLine.number,
      selectionLineFrom: selectionLine.from,
      selectionLineTo: selectionLine.to,
      blockCount: blocks.length,
      activeBlockFrom: activeBlock?.from ?? null,
      activeBlockTo: activeBlock?.to ?? null,
      hasUnsavedChanges: app.hasUnsavedChanges,
      queuedUploadEntries: readQueueCount(),
      loggerLevel: liveDebug.getLevel(),
      recentInputKind: recentInput?.kind ?? null,
      recentInputTrigger: recentInput?.trigger ?? null,
      recentInputKey: recentInput?.key ?? null,
      recentInputAgeMs: recentInput?.ageMs ?? null,
      domSelection: readDomSelection()
    });
  }

  return {
    recordInputSignal,
    readRecentInputSignal,
    captureLiveDebugSnapshot
  };
}
