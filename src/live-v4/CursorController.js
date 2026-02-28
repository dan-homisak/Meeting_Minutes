import { EditorSelection } from '@codemirror/state';

function clampToLine(line, column) {
  const normalizedColumn = Math.max(0, Math.trunc(column));
  return Math.min(line.to, line.from + normalizedColumn);
}

export function createCursorController({
  liveDebug,
  createCursorSelection = (position, assoc) => EditorSelection.cursor(position, assoc)
} = {}) {
  const preferredColumns = new WeakMap();

  function moveCursorVertically(view, direction, trigger = 'arrow') {
    if (!Number.isInteger(direction) || direction === 0) {
      liveDebug?.trace?.('cursor.move.vertical.skipped', {
        trigger,
        reason: 'invalid-direction',
        direction
      });
      return false;
    }

    const selection = view.state.selection.main;
    if (!selection.empty) {
      liveDebug?.trace?.('cursor.move.vertical.skipped', {
        trigger,
        reason: 'selection-not-empty',
        anchor: selection.anchor,
        head: selection.head
      });
      return false;
    }

    const currentLine = view.state.doc.lineAt(selection.head);
    const targetLineNumber = currentLine.number + direction;
    if (targetLineNumber < 1 || targetLineNumber > view.state.doc.lines) {
      liveDebug?.trace?.('cursor.move.vertical.boundary', {
        trigger,
        from: selection.head,
        fromLine: currentLine.number
      });
      return true;
    }

    const priorPreferred = preferredColumns.get(view);
    const currentColumn = Math.max(0, selection.head - currentLine.from);
    const preferredColumn = Number.isFinite(priorPreferred) ? priorPreferred : currentColumn;

    const targetLine = view.state.doc.line(targetLineNumber);
    const targetPosition = clampToLine(targetLine, preferredColumn);

    preferredColumns.set(view, preferredColumn);

    view.dispatch({
      selection: createCursorSelection(targetPosition, direction > 0 ? -1 : 1),
      scrollIntoView: true
    });

    view.focus();

    liveDebug?.trace?.('live-v4.cursor.move', {
      trigger,
      direction,
      from: selection.head,
      to: targetPosition,
      fromLine: currentLine.number,
      toLine: targetLine.number,
      preferredColumn
    });
    liveDebug?.trace?.('cursor.move.vertical', {
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
