import { EditorSelection } from '@codemirror/state';

function clampToLine(line, column) {
  const normalizedColumn = Math.max(0, Math.trunc(column));
  return Math.min(line.to, line.from + normalizedColumn);
}

export function createCursorController({
  liveDebug,
  createCursorSelection = (position, assoc) => EditorSelection.cursor(position, assoc)
} = {}) {
  function moveCursorVertically(view, direction, trigger = 'arrow') {
    if (!Number.isInteger(direction) || direction === 0) {
      return false;
    }

    const selection = view.state.selection.main;
    if (!selection.empty) {
      return false;
    }

    const currentLine = view.state.doc.lineAt(selection.head);
    const targetLineNumber = currentLine.number + direction;
    if (targetLineNumber < 1 || targetLineNumber > view.state.doc.lines) {
      return true;
    }

    const targetLine = view.state.doc.line(targetLineNumber);
    const currentColumn = Math.max(0, selection.head - currentLine.from);
    const targetPosition = clampToLine(targetLine, currentColumn);

    view.dispatch({
      selection: createCursorSelection(targetPosition, direction > 0 ? -1 : 1),
      scrollIntoView: true
    });
    view.focus();

    liveDebug?.trace?.('live-v3.cursor.move', {
      trigger,
      direction,
      from: selection.head,
      to: targetPosition,
      fromLine: currentLine.number,
      toLine: targetLine.number
    });

    return true;
  }

  return {
    moveCursorVertically
  };
}
