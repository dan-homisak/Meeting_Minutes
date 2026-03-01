import {
  resolveInteractionSourceFromTarget,
  findInteractionEntriesAtPosition
} from './InteractionMap.js';
import { isCodeFenceLineText, resolveCodeFenceCaretPosition } from './codeFenceCaret.js';

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

function readFiniteAttributeValue(element, attributeName) {
  if (!element || typeof element.getAttribute !== 'function') {
    return null;
  }
  const raw = Number(element.getAttribute(attributeName));
  return Number.isFinite(raw) ? Math.trunc(raw) : null;
}

function resolveCodeFenceLineTarget(targetElement) {
  if (!targetElement || typeof targetElement.closest !== 'function') {
    return null;
  }
  const host = targetElement.closest('.cm-line[data-src-from][data-src-to]');
  if (!host) {
    return null;
  }

  const hostClassName = String(host.className ?? '');
  const isCodeFenceLine = (
    hostClassName.includes('mm-live-v4-source-code-fence-hidden') ||
    hostClassName.includes('mm-live-v4-source-code-line-start') ||
    hostClassName.includes('mm-live-v4-source-code-line-end')
  );
  if (!isCodeFenceLine) {
    return null;
  }

  const sourceFrom = readFiniteAttributeValue(host, 'data-src-from');
  const sourceTo = readFiniteAttributeValue(host, 'data-src-to');
  if (!Number.isFinite(sourceFrom) || !Number.isFinite(sourceTo) || sourceTo < sourceFrom) {
    return null;
  }
  return {
    host,
    sourceFrom,
    sourceTo,
    hidden: hostClassName.includes('mm-live-v4-source-code-fence-hidden')
  };
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
  readInteractionMapForView,
  readLiveState = null
} = {}) {
  function resolveCodeFenceLineTargetFromCoords(view, event) {
    if (!view?.state?.doc || typeof view.posAtCoords !== 'function') {
      return null;
    }

    const coordinates = readPointerCoordinates(event);
    if (!coordinates) {
      return null;
    }
    const mapped = view.posAtCoords(coordinates);
    if (!Number.isFinite(mapped)) {
      return null;
    }

    const position = clampPosition(mapped, view.state.doc.length);
    if (!Number.isFinite(position)) {
      return null;
    }

    const line = view.state.doc.lineAt(position);
    const lineText = view.state.doc.sliceString(line.from, line.to);
    if (!isCodeFenceLineText(lineText)) {
      return null;
    }

    const liveState = typeof readLiveState === 'function' ? readLiveState(view.state) : null;
    const blocks = Array.isArray(liveState?.model?.blocks) ? liveState.model.blocks : [];
    const isFenceBoundary = blocks.some((block) => (
      block &&
      block.type === 'code' &&
      Number.isFinite(block.from) &&
      Number.isFinite(block.to) &&
      (Math.trunc(block.from) === Math.trunc(line.from) || Math.trunc(block.to) === Math.trunc(line.to))
    ));
    if (!isFenceBoundary) {
      return null;
    }

    return {
      host: null,
      sourceFrom: Math.trunc(line.from),
      sourceTo: Math.trunc(line.to),
      hidden: false,
      byCoords: true
    };
  }

  function resolveCodeFenceLineTargetForEvent(view, event, targetElement) {
    const targetResolved = resolveCodeFenceLineTarget(targetElement);
    if (targetResolved) {
      return {
        ...targetResolved,
        byCoords: false
      };
    }
    return resolveCodeFenceLineTargetFromCoords(view, event);
  }

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

  function resolvePointerPosition(
    view,
    event,
    targetElement,
    trigger = 'mousedown',
    renderedWidgetTarget = false
  ) {
    const interactionMap = readInteractionMapForView(view);
    const interactionRange = resolveInteractionSourceFromTarget(targetElement, interactionMap);
    const coordinates = readPointerCoordinates(event);
    const mappedByCoords = (
      coordinates && typeof view.posAtCoords === 'function'
        ? view.posAtCoords(coordinates)
        : null
    );
    const clampedByCoords = clampPosition(mappedByCoords, view.state.doc.length);

    if (Number.isFinite(interactionRange.sourceFrom) && Number.isFinite(interactionRange.sourceTo)) {
      const geometryMapped = mapPointerByElementGeometry({
        event,
        targetElement,
        sourceFrom: interactionRange.sourceFrom,
        sourceTo: interactionRange.sourceTo,
        docLength: view.state.doc.length
      });

      if (Number.isFinite(clampedByCoords)) {
        const nativeInsideRange = isPositionInsideRange(
          clampedByCoords,
          interactionRange.sourceFrom,
          interactionRange.sourceTo
        );
        const preferGeometry = (
          renderedWidgetTarget &&
          Number.isFinite(geometryMapped) &&
          (
            !nativeInsideRange ||
            Math.abs(Math.trunc(geometryMapped) - Math.trunc(clampedByCoords)) >= 3
          )
        );

        const finalMapped = preferGeometry ? geometryMapped : clampedByCoords;
        liveDebug?.trace?.('pointer.map.fragment', {
          trigger,
          fragmentId: interactionRange.fragmentId ?? null,
          sourceFrom: interactionRange.sourceFrom,
          sourceTo: interactionRange.sourceTo,
          mappedPosition: finalMapped,
          strategy: preferGeometry
            ? 'geometry-preferred-for-rendered-widget'
            : 'native-coords',
          nativeInsideRange,
          targetTagName: describeTargetElement(targetElement).tagName
        });
        return {
          targetPosition: finalMapped,
          interactionRange
        };
      }

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

    if (Number.isFinite(clampedByCoords)) {
      liveDebug?.trace?.('pointer.map.native', {
        trigger,
        rawMappedPosition: Number.isFinite(mappedByCoords) ? Math.trunc(mappedByCoords) : null,
        mappedPosition: clampedByCoords,
        targetTagName: describeTargetElement(targetElement).tagName
      });
      return {
        targetPosition: clampedByCoords,
        interactionRange: null
      };
    }

    const entries = Number.isFinite(mappedByCoords)
      ? findInteractionEntriesAtPosition(interactionMap, mappedByCoords)
      : [];
    if (entries.length > 0) {
      liveDebug?.trace?.('pointer.map.fragment-miss', {
        trigger,
        reason: 'native-miss-with-entry',
        entrySourceFrom: entries[0].sourceFrom,
        entrySourceTo: entries[0].sourceTo
      });
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

    const codeFenceLineTarget = resolveCodeFenceLineTargetForEvent(view, event, target);
    if (codeFenceLineTarget && !target.closest?.('.mm-live-v4-code-copy-button')) {
      // Obsidian-style behavior: entering a fence line via click places caret at
      // the end of the visible fence text (` ``` ` or ` ```lang `).
      const targetPosition = resolveCodeFenceCaretPosition(
        view.state.doc,
        codeFenceLineTarget.sourceFrom,
        codeFenceLineTarget.sourceTo
      );
      if (Number.isFinite(targetPosition)) {
        view.dispatch({
          selection: {
            anchor: targetPosition,
            head: targetPosition
          },
          scrollIntoView: true
        });
        view.focus();
        event.preventDefault?.();
        liveDebug?.trace?.('pointer.activate.code-fence-line', {
          trigger,
          sourceFrom: codeFenceLineTarget.sourceFrom,
          sourceTo: codeFenceLineTarget.sourceTo,
          hidden: codeFenceLineTarget.hidden,
          byCoords: codeFenceLineTarget.byCoords,
          targetPosition
        });
        return true;
      }
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
    } = resolvePointerPosition(view, event, target, trigger, renderedWidgetTarget);
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
