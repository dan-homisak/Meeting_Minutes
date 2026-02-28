import {
  emitLiveDebugEvents,
  resolvePointerActivationIntent
} from './SelectionPolicy.js';

export function createPointerActivationController({
  app,
  liveDebug,
  liveBlocksForView,
  liveSourceMapIndexForView,
  normalizePointerTarget,
  readPointerCoordinates,
  describeElementForLog,
  recordInputSignal,
  resolvePointerPosition,
  readLineInfoForPosition,
  readBlockLineBoundsForLog,
  resolveActivationBlockBounds
} = {}) {
  function toFinitePosition(value) {
    if (value == null || value === '') {
      return null;
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.trunc(numeric) : null;
  }

  function readTaskSourceFromTarget(targetElement) {
    if (!targetElement) {
      return null;
    }
    const directValue = toFinitePosition(
      typeof targetElement.getAttribute === 'function'
        ? targetElement.getAttribute('data-task-source-from')
        : undefined
    );
    if (Number.isFinite(directValue)) {
      return directValue;
    }

    const closestTask = typeof targetElement.closest === 'function'
      ? targetElement.closest('[data-task-source-from]')
      : null;
    const closestValue = toFinitePosition(
      typeof closestTask?.getAttribute === 'function'
        ? closestTask.getAttribute('data-task-source-from')
        : undefined
    );
    return Number.isFinite(closestValue) ? closestValue : null;
  }

  function toggleTaskCheckboxAtSource(view, sourceFrom, nextChecked) {
    if (!view?.state?.doc || !Number.isFinite(sourceFrom)) {
      return false;
    }

    const doc = view.state.doc;
    const clampedSourceFrom = Math.max(0, Math.min(doc.length, Math.trunc(sourceFrom)));
    const line = doc.lineAt(clampedSourceFrom);
    const lineText = doc.sliceString(line.from, line.to);
    const taskMatch = lineText.match(/^(\s*(?:[-+*]|\d+\.)\s+\[)( |x|X)(\]\s+.*)$/);
    if (!taskMatch) {
      return false;
    }

    const markerOffset = taskMatch[1].length;
    const markerPosition = line.from + markerOffset;
    view.dispatch({
      changes: {
        from: markerPosition,
        to: markerPosition + 1,
        insert: nextChecked ? 'x' : ' '
      }
    });
    view.focus();
    return true;
  }

  function handleLivePointerActivation(view, event, trigger) {
    const targetElement = normalizePointerTarget(event.target);
    const coordinatesRaw = readPointerCoordinates(event);
    const coordinates = coordinatesRaw
      ? {
          ...coordinatesRaw,
          altKey: Boolean(event.altKey),
          ctrlKey: Boolean(event.ctrlKey),
          metaKey: Boolean(event.metaKey),
          shiftKey: Boolean(event.shiftKey)
        }
      : {
          altKey: Boolean(event.altKey),
          ctrlKey: Boolean(event.ctrlKey),
          metaKey: Boolean(event.metaKey),
          shiftKey: Boolean(event.shiftKey)
        };
    const targetSummary = describeElementForLog(targetElement);

    if (app.viewMode === 'live') {
      const taskSourceFrom = readTaskSourceFromTarget(targetElement);
      if (Number.isFinite(taskSourceFrom)) {
        const toggled = toggleTaskCheckboxAtSource(
          view,
          taskSourceFrom,
          !Boolean(targetElement?.checked)
        );
        if (toggled) {
          event.preventDefault?.();
          liveDebug.trace('task.toggle', {
            trigger,
            sourceFrom: taskSourceFrom,
            nextChecked: !Boolean(targetElement?.checked)
          });
          return true;
        }
      }

      const anchorElement = typeof targetElement?.closest === 'function'
        ? targetElement.closest('a[href]')
        : null;
      const shouldOpenLink = Boolean(anchorElement) && (Boolean(event.metaKey) || Boolean(event.ctrlKey));
      if (shouldOpenLink) {
        const href = anchorElement.getAttribute('href') ?? '';
        const target = anchorElement.getAttribute('target') ?? '_blank';
        const rel = anchorElement.getAttribute('rel') ?? 'noopener noreferrer';
        const opener =
          view?.contentDOM?.ownerDocument?.defaultView?.open ??
          globalThis?.open ??
          null;
        if (typeof opener === 'function') {
          opener(href, target, rel);
        }
        event.preventDefault?.();
        liveDebug.trace('link.open.modifier', {
          trigger,
          href,
          target
        });
        return true;
      }
    }

    const pointerIntent = resolvePointerActivationIntent({
      viewMode: app.viewMode,
      trigger,
      targetElement,
      coordinates,
      targetSummary,
      recordInputSignal,
      resolvePointerPosition,
      view,
      liveBlocksForView,
      liveSourceMapIndexForView,
      readLineInfoForPosition,
      resolveActivationBlockBounds,
      readBlockLineBoundsForLog
    });
    emitLiveDebugEvents(liveDebug, pointerIntent.logs);

    if (!pointerIntent.proceed || !Number.isFinite(pointerIntent.targetPosition)) {
      return false;
    }

    try {
      view.dispatch({
        selection: {
          anchor: pointerIntent.targetPosition,
          head: pointerIntent.targetPosition
        },
        scrollIntoView: true
      });
      view.focus();
      event.preventDefault?.();
      liveDebug.trace('block.activated', {
        trigger,
        targetPosition: pointerIntent.targetPosition
      });
      return true;
    } catch (error) {
      liveDebug.error('block.activate.dispatch-failed', {
        trigger,
        message: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  return {
    handleLivePointerActivation
  };
}
