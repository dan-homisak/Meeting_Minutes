import { EditorSelection } from '@codemirror/state';
import { findSourceMapEntriesAtPosition } from '../core/mapping/SourceMapIndex.js';

export function createCursorNavigationController({
  app,
  liveDebug,
  recordInputSignal,
  normalizeLogString,
  scheduleCursorVisibilityProbe,
  readCursorVisibilityForLog,
  readDomSelectionForLog,
  isCursorVisibilitySuspect,
  liveSourceMapIndexForView,
  requestAnimationFrameFn = (callback) => window.requestAnimationFrame(callback),
  createCursorSelection = (position, assoc) => EditorSelection.cursor(position, assoc)
} = {}) {
  function readSourceMapIndex(view) {
    if (typeof liveSourceMapIndexForView !== 'function') {
      return [];
    }

    const sourceMapIndex = liveSourceMapIndexForView(view);
    return Array.isArray(sourceMapIndex) ? sourceMapIndex : [];
  }

  function findSourceMapBlockAtCursorPosition(sourceMapIndex, position) {
    if (!Array.isArray(sourceMapIndex) || !Number.isFinite(position)) {
      return null;
    }

    const lookupPositions = [];
    const truncated = Math.max(0, Math.trunc(position));
    lookupPositions.push(truncated);
    if (truncated > 0) {
      lookupPositions.push(truncated - 1);
    }

    for (const lookupPosition of lookupPositions) {
      const entries = findSourceMapEntriesAtPosition(sourceMapIndex, lookupPosition);
      const blockEntry = entries.find((entry) => entry?.kind === 'block');
      if (blockEntry) {
        return blockEntry;
      }
    }

    let nearest = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const entry of sourceMapIndex) {
      if (
        !entry ||
        entry.kind !== 'block' ||
        !Number.isFinite(entry.sourceFrom) ||
        !Number.isFinite(entry.sourceTo)
      ) {
        continue;
      }

      const distanceToStart = Math.abs(truncated - entry.sourceFrom);
      const distanceToEnd = Math.abs(truncated - entry.sourceTo);
      const distance = Math.min(distanceToStart, distanceToEnd);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = entry;
      }
    }

    if (nearest && nearestDistance <= 1) {
      return nearest;
    }

    return null;
  }

  function clampCursorPositionToSourceMapBlock(position, blockEntry) {
    if (
      !Number.isFinite(position) ||
      !blockEntry ||
      !Number.isFinite(blockEntry.sourceFrom) ||
      !Number.isFinite(blockEntry.sourceTo)
    ) {
      return {
        position,
        clamped: false
      };
    }

    const min = Math.max(0, Math.trunc(blockEntry.sourceFrom));
    const max = Math.max(min, Math.trunc(blockEntry.sourceTo));
    const clampedPosition = Math.max(min, Math.min(max, Math.trunc(position)));
    return {
      position: clampedPosition,
      clamped: clampedPosition !== position
    };
  }

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
    const rawTargetPos = Math.min(targetLine.to, targetLine.from + currentColumn);
    const sourceMapIndex = readSourceMapIndex(view);
    const sourceMapTargetBlock = findSourceMapBlockAtCursorPosition(sourceMapIndex, rawTargetPos);
    const sourceMapClamp = clampCursorPositionToSourceMapBlock(rawTargetPos, sourceMapTargetBlock);
    const targetPos = sourceMapClamp.position;
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
      rawTargetPos,
      sourceMapTargetBlockId: sourceMapTargetBlock?.id ?? null,
      sourceMapTargetFrom: sourceMapTargetBlock?.sourceFrom ?? null,
      sourceMapTargetTo: sourceMapTargetBlock?.sourceTo ?? null,
      sourceMapClamped: sourceMapClamp.clamped,
      assoc: primaryAssoc
    });
    if (sourceMapClamp.clamped) {
      liveDebug.warn('cursor.move.vertical.source-map-clamped', {
        trigger,
        direction,
        from: selection.head,
        rawTargetPos,
        targetPos,
        sourceMapTargetBlockId: sourceMapTargetBlock?.id ?? null,
        sourceMapTargetFrom: sourceMapTargetBlock?.sourceFrom ?? null,
        sourceMapTargetTo: sourceMapTargetBlock?.sourceTo ?? null
      });
    }
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
