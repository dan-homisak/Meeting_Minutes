import { EditorSelection } from '@codemirror/state';

function clampToLine(line, column) {
  const normalizedColumn = Math.max(0, Math.trunc(column));
  return Math.min(line.to, line.from + normalizedColumn);
}

function readMarkerGapRange(lineText, lineFrom) {
  if (typeof lineText !== 'string' || !Number.isFinite(lineFrom)) {
    return null;
  }

  const taskMatch = lineText.match(/^(\s*)([-+*]|\d+\.)(\s+)(\[(?: |x|X)\])(\s+)/);
  if (taskMatch) {
    const indentationText = taskMatch[1] ?? '';
    const listToken = taskMatch[2] ?? '-';
    const listKind = /^\d+\.$/.test(listToken) ? 'ordered' : 'bullet';
    const markerPrefixSpacing = taskMatch[3] ?? ' ';
    const markerCoreText = taskMatch[4] ?? '[ ]';
    const trailingSpacing = taskMatch[5] ?? ' ';
    const markerCoreFrom = Math.trunc(lineFrom) + indentationText.length;
    const markerCoreTo = markerCoreFrom + listToken.length + markerPrefixSpacing.length + markerCoreText.length;
    const contentFrom = markerCoreTo + trailingSpacing.length;
    if (contentFrom > markerCoreTo) {
      return {
        markerKind: 'task',
        listKind,
        lineFrom: Math.trunc(lineFrom),
        markerCoreFrom,
        markerCoreTo,
        contentFrom,
        indentationChars: indentationText.length
      };
    }
  }

  const listMatch = lineText.match(/^(\s*)([-+*]|\d+\.)(\s+)/);
  if (listMatch) {
    const indentationText = listMatch[1] ?? '';
    const markerCoreText = listMatch[2] ?? '-';
    const markerKind = /^\d+\.$/.test(markerCoreText) ? 'ordered' : 'bullet';
    const trailingSpacing = listMatch[3] ?? ' ';
    const markerCoreFrom = Math.trunc(lineFrom) + indentationText.length;
    const markerCoreTo = markerCoreFrom + markerCoreText.length;
    const contentFrom = markerCoreTo + trailingSpacing.length;
    if (contentFrom > markerCoreTo) {
      return {
        markerKind,
        lineFrom: Math.trunc(lineFrom),
        markerCoreFrom,
        markerCoreTo,
        contentFrom,
        indentationChars: indentationText.length
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
      if (head < markerGapRange.markerCoreFrom) {
        target = markerGapRange.markerCoreFrom;
      } else if (head >= markerGapRange.markerCoreTo && head < markerGapRange.contentFrom) {
        target = markerGapRange.contentFrom;
      }
    } else if (head > markerGapRange.markerCoreTo && head <= markerGapRange.contentFrom) {
      target = markerGapRange.markerCoreTo;
    } else if (head <= markerGapRange.markerCoreFrom && markerGapRange.markerCoreFrom > markerGapRange.lineFrom) {
      // Keep the caret out of hidden indentation guide ranges.
      target = markerGapRange.markerCoreFrom;
    }

    if (!Number.isFinite(target)) {
      return false;
    }

    if (target === head) {
      return true;
    }

    view.dispatch({
      // Keep caret on visible boundaries when marker/indent syntax is hidden.
      selection: createCursorSelection(target, 1),
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

  function adjustListIndent(view, direction, trigger = 'list-indent') {
    if (!Number.isInteger(direction) || direction === 0) {
      return false;
    }

    const selection = view.state.selection.main;
    if (!selection.empty) {
      return false;
    }

    const line = view.state.doc.lineAt(selection.head);
    const lineText = view.state.doc.sliceString(line.from, line.to);
    const markerGapRange = readMarkerGapRange(lineText, line.from);
    if (!markerGapRange) {
      return false;
    }

    // Treat Tab/Backspace as indent controls while caret is in guide/marker zone.
    if (selection.head > markerGapRange.contentFrom) {
      return false;
    }

    const indentationChars = Math.max(0, Math.trunc(markerGapRange.indentationChars ?? 0));
    if (direction > 0) {
      const insertText = '  ';
      view.dispatch({
        changes: {
          from: line.from,
          to: line.from,
          insert: insertText
        },
        selection: createCursorSelection(selection.head + insertText.length, -1),
        scrollIntoView: true
      });
      view.focus();
      liveDebug?.trace?.('cursor.list-indent', {
        trigger,
        direction,
        from: selection.head,
        to: selection.head + insertText.length,
        lineNumber: line.number
      });
      return true;
    }

    if (indentationChars < 2) {
      return true;
    }

    const removeChars = Math.min(2, indentationChars);
    view.dispatch({
      changes: {
        from: line.from,
        to: line.from + removeChars,
        insert: ''
      },
      selection: createCursorSelection(Math.max(line.from, selection.head - removeChars), -1),
      scrollIntoView: true
    });
    view.focus();
    liveDebug?.trace?.('cursor.list-indent', {
      trigger,
      direction,
      from: selection.head,
      to: Math.max(line.from, selection.head - removeChars),
      lineNumber: line.number
    });
    return true;
  }

  return {
    moveCursorVertically,
    moveCursorHorizontally,
    adjustListIndent
  };
}
