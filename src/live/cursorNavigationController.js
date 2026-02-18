import { EditorSelection } from '@codemirror/state';

export function createCursorNavigationController({
  app,
  liveDebug,
  recordInputSignal,
  normalizeLogString,
  scheduleCursorVisibilityProbe,
  readCursorVisibilityForLog,
  readDomSelectionForLog,
  isCursorVisibilitySuspect,
  requestAnimationFrameFn = (callback) => window.requestAnimationFrame(callback),
  createCursorSelection = (position, assoc) => EditorSelection.cursor(position, assoc)
} = {}) {
  function moveLiveCursorVertically(view, direction, trigger = 'arrow') {
    if (app.viewMode !== 'live' || !Number.isInteger(direction) || direction === 0) {
      return false;
    }

    recordInputSignal('keyboard', {
      trigger,
      key: direction > 0 ? 'ArrowDown' : 'ArrowUp'
    });

    const selection = view.state.selection.main;
    if (!selection.empty) {
      liveDebug.trace('cursor.move.vertical.skipped', {
        trigger,
        reason: 'non-empty-selection',
        anchor: selection.anchor,
        head: selection.head
      });
      return false;
    }

    const currentLine = view.state.doc.lineAt(selection.head);
    const targetLineNumber = currentLine.number + direction;
    if (targetLineNumber < 1 || targetLineNumber > view.state.doc.lines) {
      liveDebug.trace('cursor.move.vertical.boundary', {
        trigger,
        direction,
        from: selection.head,
        fromLine: currentLine.number
      });
      return true;
    }

    const targetLine = view.state.doc.line(targetLineNumber);
    const currentColumn = Math.max(0, selection.head - currentLine.from);
    const targetPos = Math.min(targetLine.to, targetLine.from + currentColumn);
    const currentLineLength = Math.max(0, currentLine.to - currentLine.from);
    const targetLineLength = Math.max(0, targetLine.to - targetLine.from);
    const primaryAssoc = direction > 0 ? -1 : 1;
    const secondaryAssoc = -primaryAssoc;

    view.dispatch({
      selection: createCursorSelection(targetPos, primaryAssoc),
      scrollIntoView: true
    });
    view.focus();

    liveDebug.trace('cursor.move.vertical', {
      trigger,
      direction,
      from: selection.head,
      to: targetPos,
      fromLine: currentLine.number,
      toLine: targetLine.number,
      column: currentColumn,
      currentLineLength,
      targetLineLength,
      targetLineTextPreview: normalizeLogString(
        view.state.doc.sliceString(targetLine.from, targetLine.to),
        80
      ),
      assoc: primaryAssoc
    });
    scheduleCursorVisibilityProbe(view, 'moveLiveCursorVertically');

    requestAnimationFrameFn(() => {
      if (app.viewMode !== 'live' || view.state.selection.main.head !== targetPos) {
        return;
      }

      const cursorState = readCursorVisibilityForLog(view, targetPos);
      const selectedLine = view.state.doc.lineAt(view.state.selection.main.head);
      const selectedLineLength = Math.max(0, selectedLine.to - selectedLine.from);
      const domSelection = readDomSelectionForLog();
      const domSelectionOnContentContainer =
        typeof domSelection?.anchorNode?.className === 'string' &&
        domSelection.anchorNode.className.includes('cm-content');
      const shouldCorrectAssoc =
        cursorState.hasCursorElement &&
        isCursorVisibilitySuspect(
          cursorState,
          selectedLineLength,
          domSelectionOnContentContainer
        );
      if (!shouldCorrectAssoc) {
        return;
      }

      view.dispatch({
        selection: createCursorSelection(targetPos, secondaryAssoc),
        scrollIntoView: true
      });
      view.focus();
      liveDebug.warn('cursor.move.vertical.corrected-assoc', {
        trigger,
        targetPos,
        lineNumber: selectedLine.number,
        lineLength: selectedLineLength,
        previousAssoc: primaryAssoc,
        nextAssoc: secondaryAssoc,
        cursorState
      });
      scheduleCursorVisibilityProbe(view, 'moveLiveCursorVertically-corrected-assoc');
    });

    return true;
  }

  return {
    moveLiveCursorVertically
  };
}
