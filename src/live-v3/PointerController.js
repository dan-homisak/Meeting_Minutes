import {
  resolveInteractionSourceFromTarget,
  findInteractionEntriesAtPosition
} from './InteractionMap.js';

function readPointerCoordinates(event) {
  if (Number.isFinite(event?.clientX) && Number.isFinite(event?.clientY)) {
    return {
      x: event.clientX,
      y: event.clientY
    };
  }

  const firstTouch = event?.touches?.[0] ?? event?.changedTouches?.[0] ?? null;
  if (!firstTouch) {
    return null;
  }

  return {
    x: firstTouch.clientX,
    y: firstTouch.clientY
  };
}

function clampPosition(value, docLength) {
  if (!Number.isFinite(value)) {
    return null;
  }
  const max = Math.max(0, Math.trunc(docLength));
  return Math.max(0, Math.min(max, Math.trunc(value)));
}

function toggleTaskCheckboxAtSource(view, sourceFrom, nextChecked) {
  if (!view?.state?.doc || !Number.isFinite(sourceFrom)) {
    return false;
  }

  const doc = view.state.doc;
  const position = clampPosition(sourceFrom, doc.length);
  const line = doc.lineAt(position);
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

export function createPointerController({
  liveDebug,
  readInteractionMapForView
} = {}) {
  function resolvePointerPosition(view, event, targetElement) {
    const interactionMap = readInteractionMapForView(view);
    const interactionRange = resolveInteractionSourceFromTarget(targetElement, interactionMap);
    if (Number.isFinite(interactionRange.sourceFrom)) {
      return clampPosition(interactionRange.sourceFrom, view.state.doc.length);
    }

    const coordinates = readPointerCoordinates(event);
    if (coordinates && typeof view.posAtCoords === 'function') {
      const mapped = view.posAtCoords(coordinates);
      if (Number.isFinite(mapped)) {
        const entries = findInteractionEntriesAtPosition(interactionMap, mapped);
        if (entries.length > 0) {
          return clampPosition(entries[0].sourceFrom, view.state.doc.length);
        }
        return clampPosition(mapped, view.state.doc.length);
      }
    }

    if (typeof view.posAtDOM === 'function') {
      try {
        const domPos = view.posAtDOM(targetElement, 0);
        return clampPosition(domPos, view.state.doc.length);
      } catch {
        return null;
      }
    }

    return null;
  }

  function handlePointer(view, event, trigger = 'mousedown') {
    const target = event?.target && typeof event.target.closest === 'function'
      ? event.target
      : null;

    if (!target) {
      return false;
    }

    const taskElement = target.closest?.('[data-task-source-from]');
    if (taskElement) {
      const sourceFrom = Number(taskElement.getAttribute('data-task-source-from'));
      const toggled = toggleTaskCheckboxAtSource(
        view,
        sourceFrom,
        !Boolean(taskElement.checked)
      );
      if (toggled) {
        event.preventDefault?.();
        liveDebug?.trace?.('live-v3.task.toggle', {
          trigger,
          sourceFrom: Number.isFinite(sourceFrom) ? Math.trunc(sourceFrom) : null,
          nextChecked: !Boolean(taskElement.checked)
        });
        return true;
      }
    }

    const anchor = target.closest?.('a[href]');
    const modifier = Boolean(event.metaKey) || Boolean(event.ctrlKey);
    if (anchor && modifier) {
      const href = anchor.getAttribute('href') ?? '';
      const opener = view?.contentDOM?.ownerDocument?.defaultView?.open ?? globalThis?.open ?? null;
      if (typeof opener === 'function') {
        opener(href, '_blank', 'noopener,noreferrer');
      }
      event.preventDefault?.();
      liveDebug?.trace?.('live-v3.link.open.modifier', { trigger, href });
      return true;
    }

    const targetPosition = resolvePointerPosition(view, event, target);
    if (!Number.isFinite(targetPosition)) {
      liveDebug?.warn?.('live-v3.pointer.miss', { trigger });
      return false;
    }

    view.dispatch({
      selection: {
        anchor: targetPosition,
        head: targetPosition
      },
      scrollIntoView: true
    });
    view.focus();
    event.preventDefault?.();

    liveDebug?.trace?.('live-v3.pointer.activate', {
      trigger,
      targetPosition
    });

    return true;
  }

  return {
    handlePointer
  };
}
