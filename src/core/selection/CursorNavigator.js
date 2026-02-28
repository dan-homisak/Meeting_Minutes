import { EditorSelection } from '@codemirror/state';
import {
  buildVerticalCursorMoveLogEvents,
  emitLiveDebugEvents,
  readSourceMapIndexForView,
  resolveVerticalCursorAssocCorrection,
  resolveVerticalCursorMoveContext
} from './SelectionPolicy.js';

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
  function moveLiveCursorVertically(view, direction, trigger = 'arrow') {
    if (app.viewMode !== 'live' || !Number.isInteger(direction) || direction === 0) {
      return false;
    }

    recordInputSignal('keyboard', {
      trigger,
      key: direction > 0 ? 'ArrowDown' : 'ArrowUp'
    });

    const selection = view.state.selection.main;
    const sourceMapIndex = readSourceMapIndexForView(liveSourceMapIndexForView, view);
    const moveContext = resolveVerticalCursorMoveContext({
      doc: view.state.doc,
      selection,
      direction,
      sourceMapIndex
    });
    const moveLogEvents = buildVerticalCursorMoveLogEvents({
      trigger,
      moveContext,
      targetLineTextPreview: moveContext.status === 'target'
        ? normalizeLogString(
          view.state.doc.sliceString(moveContext.targetLine.from, moveContext.targetLine.to),
          80
        )
        : null
    });
    emitLiveDebugEvents(liveDebug, moveLogEvents);

    if (moveContext.status === 'non-empty-selection') {
      return false;
    }
    if (moveContext.status === 'boundary') {
      return true;
    }
    if (moveContext.status !== 'target') {
      return false;
    }

    view.dispatch({
      selection: createCursorSelection(moveContext.to, moveContext.primaryAssoc),
      scrollIntoView: true
    });
    view.focus();
    scheduleCursorVisibilityProbe(view, 'moveLiveCursorVertically');

    requestAnimationFrameFn(() => {
      if (app.viewMode !== 'live' || view.state.selection.main.head !== moveContext.to) {
        return;
      }

      const cursorState = readCursorVisibilityForLog(view, moveContext.to);
      const selectedLine = view.state.doc.lineAt(view.state.selection.main.head);
      const domSelection = readDomSelectionForLog();
      const domSelectionOnContentContainer =
        typeof domSelection?.anchorNode?.className === 'string' &&
        domSelection.anchorNode.className.includes('cm-content');
      const assocCorrection = resolveVerticalCursorAssocCorrection({
        trigger,
        moveContext,
        cursorState,
        selectedLine,
        domSelectionOnContentContainer,
        isCursorVisibilitySuspect
      });
      if (!assocCorrection.shouldCorrectAssoc) {
        return;
      }

      view.dispatch({
        selection: createCursorSelection(moveContext.to, moveContext.secondaryAssoc),
        scrollIntoView: true
      });
      view.focus();
      emitLiveDebugEvents(liveDebug, assocCorrection.logs);
      scheduleCursorVisibilityProbe(view, 'moveLiveCursorVertically-corrected-assoc');
    });

    return true;
  }

  return {
    moveLiveCursorVertically
  };
}
