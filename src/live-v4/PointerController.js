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

function describeTargetElement(targetElement) {
  if (!targetElement || typeof targetElement !== 'object') {
    return {
      tagName: null,
      className: null
    };
  }

  return {
    tagName: typeof targetElement.tagName === 'string'
      ? targetElement.tagName.toLowerCase()
      : null,
    className: typeof targetElement.className === 'string'
      ? targetElement.className
      : null
  };
}

function isRenderedWidgetTarget(targetElement) {
  return Boolean(targetElement?.closest?.('.mm-live-v4-block-widget'));
}

function clampPosition(value, docLength) {
  if (!Number.isFinite(value)) {
    return null;
  }

  const max = Math.max(0, Math.trunc(docLength));
  return Math.max(0, Math.min(max, Math.trunc(value)));
}

function isPositionInsideRange(position, sourceFrom, sourceTo) {
  if (!Number.isFinite(position) || !Number.isFinite(sourceFrom) || !Number.isFinite(sourceTo)) {
    return false;
  }

  const pos = Math.trunc(position);
  return pos >= Math.trunc(sourceFrom) && pos <= Math.trunc(sourceTo);
}

function mapPointerByElementGeometry({
  event,
  targetElement,
  sourceFrom,
  sourceTo,
  docLength
}) {
  if (!Number.isFinite(sourceFrom) || !Number.isFinite(sourceTo) || sourceTo <= sourceFrom) {
    return null;
  }

  const coordinates = readPointerCoordinates(event);
  const host = targetElement?.closest?.('[data-src-from][data-src-to]') ?? targetElement;
  const rect = host?.getBoundingClientRect?.();
  if (
    !coordinates ||
    !rect ||
    !Number.isFinite(rect.left) ||
    !Number.isFinite(rect.width) ||
    rect.width <= 0
  ) {
    return null;
  }

  const relativeX = Math.max(0, Math.min(1, (coordinates.x - rect.left) / rect.width));
  const sourceSpan = Math.max(0, Math.trunc(sourceTo) - Math.trunc(sourceFrom));
  const estimated = Math.trunc(sourceFrom) + Math.round(relativeX * sourceSpan);
  return clampPosition(estimated, docLength);
}

function toggleTaskCheckboxAtSource(view, sourceFrom, nextChecked) {
  if (!view?.state?.doc || !Number.isFinite(sourceFrom)) {
    return false;
  }

  const doc = view.state.doc;
  const position = clampPosition(sourceFrom, doc.length);
  const line = doc.lineAt(position);
  const lineText = doc.sliceString(line.from, line.to);
  const taskMatch = lineText.match(/^(\s*(?:[-+*]|\d+\.)\s+\[)( |x|X)(\](?:\s+.*)?$)/);
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
  function schedulePostActivationRemap({
    view,
    pointerCoordinates,
    interactionRange,
    fallbackPosition,
    trigger
  }) {
    if (!view || !pointerCoordinates || !Number.isFinite(fallbackPosition)) {
      return;
    }

    const ownerWindow = view.contentDOM?.ownerDocument?.defaultView ?? globalThis;
    const scheduleFrame = typeof ownerWindow?.requestAnimationFrame === 'function'
      ? ownerWindow.requestAnimationFrame.bind(ownerWindow)
      : (callback) => setTimeout(callback, 0);

    scheduleFrame(() => {
      if (typeof view.posAtCoords !== 'function') {
        return;
      }

      const remappedRaw = view.posAtCoords(pointerCoordinates);
      if (!Number.isFinite(remappedRaw)) {
        liveDebug?.trace?.('pointer.remap.post-activate.miss', {
          trigger,
          reason: 'native-coords-unavailable'
        });
        return;
      }

      const remapped = clampPosition(remappedRaw, view.state.doc.length);
      const sourceFrom = Number.isFinite(interactionRange?.sourceFrom)
        ? Math.trunc(interactionRange.sourceFrom)
        : null;
      const sourceTo = Number.isFinite(interactionRange?.sourceTo)
        ? Math.trunc(interactionRange.sourceTo)
        : null;
      const remappedInsideRange = (
        Number.isFinite(sourceFrom) &&
        Number.isFinite(sourceTo) &&
        Number.isFinite(remapped) &&
        remapped >= sourceFrom &&
        remapped <= sourceTo
      );
      const remapDelta = Number.isFinite(remapped)
        ? Math.abs(Math.trunc(remapped) - Math.trunc(fallbackPosition))
        : Number.POSITIVE_INFINITY;
      const useRemappedPosition = remappedInsideRange && remapDelta <= 2;
      const finalPosition = useRemappedPosition
        ? Math.trunc(remapped)
        : Math.trunc(fallbackPosition);
      const currentHead = view.state.selection.main.head;
      if (!Number.isFinite(finalPosition) || finalPosition === currentHead) {
        return;
      }

      view.dispatch({
        selection: {
          anchor: finalPosition,
          head: finalPosition
        },
        scrollIntoView: true
      });

      liveDebug?.trace?.('pointer.remap.post-activate', {
        trigger,
        fallbackPosition: Math.trunc(fallbackPosition),
        remappedRaw: Math.trunc(remappedRaw),
        remappedPosition: Number.isFinite(remapped) ? Math.trunc(remapped) : null,
        finalPosition: Math.trunc(finalPosition),
        remappedInsideRange,
        remapDelta: Number.isFinite(remapDelta) ? remapDelta : null,
        useRemappedPosition,
        sourceFrom,
        sourceTo
      });
    });
  }

  function resolvePointerPosition(view, event, targetElement, trigger = 'mousedown') {
    const interactionMap = readInteractionMapForView(view);
    const interactionRange = resolveInteractionSourceFromTarget(targetElement, interactionMap);

    if (Number.isFinite(interactionRange.sourceFrom) && Number.isFinite(interactionRange.sourceTo)) {
      const coordinates = readPointerCoordinates(event);
      if (coordinates && typeof view.posAtCoords === 'function') {
        const mappedByCoords = view.posAtCoords(coordinates);
        if (isPositionInsideRange(mappedByCoords, interactionRange.sourceFrom, interactionRange.sourceTo)) {
          const clamped = clampPosition(mappedByCoords, view.state.doc.length);
          const geometryMapped = mapPointerByElementGeometry({
            event,
            targetElement,
            sourceFrom: interactionRange.sourceFrom,
            sourceTo: interactionRange.sourceTo,
            docLength: view.state.doc.length
          });
          const shouldPreferGeometry = (
            Number.isFinite(geometryMapped) &&
            Number.isFinite(clamped) &&
            Math.abs(geometryMapped - clamped) >= 3
          );
          const finalMapped = shouldPreferGeometry ? geometryMapped : clamped;

          liveDebug?.trace?.('pointer.map.fragment', {
            trigger,
            fragmentId: interactionRange.fragmentId ?? null,
            sourceFrom: interactionRange.sourceFrom,
            sourceTo: interactionRange.sourceTo,
            mappedPosition: finalMapped,
            strategy: shouldPreferGeometry
              ? 'native-with-geometry-correction'
              : 'native-within-range',
            targetTagName: describeTargetElement(targetElement).tagName
          });
          return {
            targetPosition: finalMapped,
            interactionRange
          };
        }
      }

      const geometryMapped = mapPointerByElementGeometry({
        event,
        targetElement,
        sourceFrom: interactionRange.sourceFrom,
        sourceTo: interactionRange.sourceTo,
        docLength: view.state.doc.length
      });
      if (Number.isFinite(geometryMapped)) {
        liveDebug?.trace?.('pointer.map.fragment', {
          trigger,
          fragmentId: interactionRange.fragmentId ?? null,
          sourceFrom: interactionRange.sourceFrom,
          sourceTo: interactionRange.sourceTo,
          mappedPosition: geometryMapped,
          strategy: 'geometry-fallback',
          targetTagName: describeTargetElement(targetElement).tagName
        });
        return {
          targetPosition: geometryMapped,
          interactionRange
        };
      }

      const fallbackPosition = clampPosition(interactionRange.sourceFrom, view.state.doc.length);
      if (Number.isFinite(fallbackPosition)) {
        liveDebug?.trace?.('pointer.map.fragment', {
          trigger,
          fragmentId: interactionRange.fragmentId ?? null,
          sourceFrom: interactionRange.sourceFrom,
          sourceTo: interactionRange.sourceTo,
          mappedPosition: fallbackPosition,
          strategy: 'range-start-fallback',
          targetTagName: describeTargetElement(targetElement).tagName
        });
        return {
          targetPosition: fallbackPosition,
          interactionRange
        };
      }

      liveDebug?.trace?.('pointer.map.fragment-miss', {
        trigger,
        fragmentId: interactionRange.fragmentId ?? null,
        sourceFrom: interactionRange.sourceFrom,
        sourceTo: interactionRange.sourceTo
      });
      return {
        targetPosition: null,
        interactionRange
      };
    }

    if (interactionRange.fragmentId) {
      liveDebug?.trace?.('pointer.map.fragment-miss', {
        trigger,
        fragmentId: interactionRange.fragmentId
      });
    }

    const coordinates = readPointerCoordinates(event);
    if (coordinates && typeof view.posAtCoords === 'function') {
      const mapped = view.posAtCoords(coordinates);
      if (Number.isFinite(mapped)) {
        const clamped = clampPosition(mapped, view.state.doc.length);
        if (clamped !== Math.trunc(mapped)) {
          liveDebug?.trace?.('pointer.map.clamped', {
            trigger,
            rawMappedPosition: Math.trunc(mapped),
            mappedPosition: clamped,
            docLength: view.state.doc.length
          });
        }
        liveDebug?.trace?.('pointer.map.native', {
          trigger,
          rawMappedPosition: Math.trunc(mapped),
          mappedPosition: clamped,
          lineInfo: {
            lineNumber: Number.isFinite(clamped) ? view.state.doc.lineAt(clamped).number : null
          },
          targetTagName: describeTargetElement(targetElement).tagName
        });

        const entries = findInteractionEntriesAtPosition(interactionMap, mapped);
        if (entries.length > 0) {
          return {
            targetPosition: clampPosition(entries[0].sourceFrom, view.state.doc.length),
            interactionRange: {
              sourceFrom: entries[0].sourceFrom,
              sourceTo: entries[0].sourceTo,
              fragmentId: entries[0].fragmentId ?? null
            }
          };
        }
        return {
          targetPosition: clamped,
          interactionRange: null
        };
      }
    }

    if (typeof view.posAtDOM === 'function') {
      try {
        const domPos = view.posAtDOM(targetElement, 0);
        return {
          targetPosition: clampPosition(domPos, view.state.doc.length),
          interactionRange: null
        };
      } catch {
        return {
          targetPosition: null,
          interactionRange: null
        };
      }
    }

    return {
      targetPosition: null,
      interactionRange: null
    };
  }

  function handlePointer(view, event, trigger = 'mousedown') {
    const target = event?.target && typeof event.target.closest === 'function'
      ? event.target
      : null;

    if (!target) {
      return false;
    }

    const pointerCoordinates = readPointerCoordinates(event);
    const renderedWidgetTarget = isRenderedWidgetTarget(target);
    liveDebug?.trace?.('input.pointer.root', {
      trigger,
      x: pointerCoordinates?.x ?? null,
      y: pointerCoordinates?.y ?? null,
      inRenderedWidget: renderedWidgetTarget,
      target: describeTargetElement(target)
    });
    liveDebug?.trace?.('input.pointer', {
      trigger,
      x: pointerCoordinates?.x ?? null,
      y: pointerCoordinates?.y ?? null,
      inRenderedWidget: renderedWidgetTarget,
      target: describeTargetElement(target)
    });

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
        liveDebug?.trace?.('live-v4.task.toggle', {
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
      liveDebug?.trace?.('live-v4.link.open.modifier', { trigger, href });
      return true;
    }

    // Let CodeMirror own pointer behavior in editable/native source DOM.
    if (!renderedWidgetTarget) {
      liveDebug?.trace?.('pointer.pass-through.native', {
        trigger,
        targetTagName: describeTargetElement(target).tagName
      });
      return false;
    }

    const {
      targetPosition,
      interactionRange
    } = resolvePointerPosition(view, event, target, trigger);
    if (!Number.isFinite(targetPosition)) {
      liveDebug?.warn?.('block.activate.miss', {
        trigger,
        reason: 'unmapped-pointer'
      });
      liveDebug?.warn?.('live-v4.pointer.miss', { trigger });
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
    schedulePostActivationRemap({
      view,
      pointerCoordinates,
      interactionRange,
      fallbackPosition: targetPosition,
      trigger
    });

    liveDebug?.trace?.('live-v4.pointer.activate', {
      trigger,
      targetPosition
    });

    return true;
  }

  return {
    handlePointer
  };
}
