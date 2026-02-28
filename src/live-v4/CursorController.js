import { EditorSelection } from '@codemirror/state';

function clampToLine(line, column) {
  const normalizedColumn = Math.max(0, Math.trunc(column));
  return Math.min(line.to, line.from + normalizedColumn);
}

function readMarkerGapRange(lineText, lineFrom) {
  if (typeof lineText !== 'string' || !Number.isFinite(lineFrom)) {
    return null;
  }

  const taskMatch = lineText.match(/^(\s*(?:[-+*]|\d+\.)\s+\[(?: |x|X)\])(\s+)/);
  if (taskMatch && typeof taskMatch[1] === 'string' && typeof taskMatch[2] === 'string') {
    const markerCoreFrom = Math.trunc(lineFrom);
    const markerCoreTo = markerCoreFrom + taskMatch[1].length;
    const contentFrom = markerCoreTo + taskMatch[2].length;
    if (contentFrom > markerCoreTo) {
      return {
        markerCoreFrom,
        markerCoreTo,
        contentFrom
      };
    }
  }

  const listMatch = lineText.match(/^(\s*(?:[-+*]|\d+\.))(\s+)/);
  if (listMatch && typeof listMatch[1] === 'string' && typeof listMatch[2] === 'string') {
    const markerCoreFrom = Math.trunc(lineFrom);
    const markerCoreTo = markerCoreFrom + listMatch[1].length;
    const contentFrom = markerCoreTo + listMatch[2].length;
    if (contentFrom > markerCoreTo) {
      return {
        markerCoreFrom,
        markerCoreTo,
        contentFrom
      };
    }
  }

  return null;
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

  function moveCursorHorizontally(view, direction, trigger = 'arrow') {
    if (!Number.isInteger(direction) || (direction !== -1 && direction !== 1)) {
      return false;
    }

    const selection = view.state.selection.main;
    if (!selection.empty) {
      return false;
    }

    const head = selection.head;
    const line = view.state.doc.lineAt(head);
    const lineText = view.state.doc.sliceString(line.from, line.to);
    const markerGapRange = readMarkerGapRange(lineText, line.from);
    if (!markerGapRange) {
      return false;
    }

    let target = null;
    if (direction > 0) {
      if (head >= markerGapRange.markerCoreTo && head < markerGapRange.contentFrom) {
        target = markerGapRange.contentFrom;
      }
    } else if (head <= markerGapRange.contentFrom && head > markerGapRange.markerCoreTo) {
      target = markerGapRange.markerCoreTo;
    }

    if (!Number.isFinite(target) || target === head) {
      return false;
    }

    view.dispatch({
      selection: createCursorSelection(target, direction > 0 ? -1 : 1),
      scrollIntoView: true
    });
    view.focus();

    liveDebug?.trace?.('cursor.move.horizontal.marker-gap', {
      trigger,
      direction,
      from: head,
      to: target,
      markerCoreFrom: markerGapRange.markerCoreFrom,
      markerCoreTo: markerGapRange.markerCoreTo,
      contentFrom: markerGapRange.contentFrom
    });

    return true;
  }

  return {
    moveCursorVertically,
    moveCursorHorizontally
  };
}
