export function createEditorDocumentAdapter({
  app,
  liveDebug,
  liveDebugDiagnostics,
  getEditorView,
  nowFn = () => Date.now()
} = {}) {
  function getEditorText() {
    return getEditorView().state.doc.toString();
  }

  function setEditorText(nextText) {
    const editorView = getEditorView();
    app.isLoadingFile = true;
    liveDebugDiagnostics.lastProgrammaticSelectionAt = nowFn();
    const previousLength = editorView.state.doc.length;
    const previousHead = editorView.state.selection.main.head;

    editorView.dispatch({
      changes: {
        from: 0,
        to: editorView.state.doc.length,
        insert: nextText
      },
      selection: { anchor: 0 },
      scrollIntoView: true
    });

    liveDebug.trace('editor.text.set.programmatic', {
      previousLength,
      nextLength: nextText.length,
      previousHead,
      nextHead: editorView.state.selection.main.head
    });

    app.isLoadingFile = false;
  }

  return {
    getEditorText,
    setEditorText
  };
}
