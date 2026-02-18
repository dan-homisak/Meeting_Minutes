function defaultClampNumber(value, min, max) {
  if (!Number.isFinite(value)) {
    return null;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

export function createPointerSourceMapping({
  clampNumber,
  traceDomPosFailure,
  elementConstructor
} = {}) {
  const clamp = typeof clampNumber === 'function' ? clampNumber : defaultClampNumber;
  const traceFailure = typeof traceDomPosFailure === 'function' ? traceDomPosFailure : () => {};
  const elementCtor = typeof elementConstructor === 'function' ? elementConstructor : null;

  function isElement(value) {
    if (!value) {
      return false;
    }
    if (elementCtor) {
      return value instanceof elementCtor;
    }
    return typeof value.getAttribute === 'function';
  }

  function parseSourceRangeValue(rawValue) {
    if (rawValue === null || rawValue === undefined || String(rawValue).trim() === '') {
      return null;
    }

    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
      return null;
    }

    return Math.trunc(parsed);
  }

  function readSourceRangeFromElement(element) {
    if (!isElement(element)) {
      return null;
    }

    const from = parseSourceRangeValue(element.getAttribute('data-src-from'));
    const to = parseSourceRangeValue(element.getAttribute('data-src-to'));
    if (Number.isFinite(from) && Number.isFinite(to) && to > from) {
      return {
        from,
        to,
        source: 'token-attrs'
      };
    }

    const fragmentFrom = parseSourceRangeValue(element.getAttribute('data-fragment-from'));
    const fragmentTo = parseSourceRangeValue(element.getAttribute('data-fragment-to'));
    if (Number.isFinite(fragmentFrom) && Number.isFinite(fragmentTo) && fragmentTo > fragmentFrom) {
      return {
        from: fragmentFrom,
        to: fragmentTo,
        source: 'fragment-attrs'
      };
    }

    const sourceFrom = parseSourceRangeValue(element.getAttribute('data-source-from'));
    const sourceTo = parseSourceRangeValue(element.getAttribute('data-source-to'));
    if (Number.isFinite(sourceFrom) && Number.isFinite(sourceTo) && sourceTo > sourceFrom) {
      return {
        from: sourceFrom,
        to: sourceTo,
        source: 'block-attrs'
      };
    }

    return null;
  }

  function findFirstChildSourceRangeElement(element) {
    if (!isElement(element)) {
      return null;
    }

    const directChildren = Array.from(element.children ?? []);
    for (const child of directChildren) {
      const range = readSourceRangeFromElement(child);
      if (range) {
        return {
          element: child,
          range
        };
      }
    }

    for (const child of directChildren) {
      const nested = child.querySelector?.('[data-src-from][data-src-to]');
      if (!isElement(nested)) {
        continue;
      }

      const range = readSourceRangeFromElement(nested);
      if (range) {
        return {
          element: nested,
          range
        };
      }
    }

    return null;
  }

  function findRenderedSourceRangeTarget(targetElement, renderedBlock) {
    if (!isElement(targetElement) || !isElement(renderedBlock)) {
      return null;
    }

    let current = targetElement;
    while (current) {
      const range = readSourceRangeFromElement(current);
      if (range) {
        return {
          element: current,
          range
        };
      }

      if (current === renderedBlock) {
        break;
      }

      current = current.parentElement;
    }

    const childRangeTarget = findFirstChildSourceRangeElement(targetElement);
    if (childRangeTarget) {
      return childRangeTarget;
    }

    const renderedBlockRange = readSourceRangeFromElement(renderedBlock);
    if (renderedBlockRange) {
      return {
        element: renderedBlock,
        range: renderedBlockRange
      };
    }

    return null;
  }

  function clampToRange(position, from, to) {
    if (!Number.isFinite(position) || !Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
      return null;
    }

    if (position < from) {
      return from;
    }

    if (position >= to) {
      return Math.max(from, to - 1);
    }

    return Math.trunc(position);
  }

  function resolvePositionFromRenderedSourceRange(
    doc,
    sourceRange,
    sourceRangeElement,
    coordinates,
    fallbackPosition = null
  ) {
    if (
      !doc ||
      !sourceRange ||
      !Number.isFinite(sourceRange.from) ||
      !Number.isFinite(sourceRange.to) ||
      sourceRange.to <= sourceRange.from
    ) {
      return null;
    }

    const clampedFallback = clampToRange(fallbackPosition, sourceRange.from, sourceRange.to);
    const startLine = doc.lineAt(sourceRange.from);
    const endLine = doc.lineAt(Math.max(sourceRange.from, sourceRange.to - 1));
    const lineCount = Math.max(1, endLine.number - startLine.number + 1);
    const hasCoords = coordinates && Number.isFinite(coordinates.y);
    const hasRect = sourceRangeElement?.getBoundingClientRect instanceof Function;
    const rect = hasRect ? sourceRangeElement.getBoundingClientRect() : null;
    const canMapByY = Boolean(
      hasCoords &&
      rect &&
      Number.isFinite(rect.height) &&
      rect.height > 0 &&
      lineCount > 1
    );

    if (canMapByY) {
      const ratioY = clamp((coordinates.y - rect.top) / rect.height, 0, 0.9999) ?? 0;
      const relativeLineIndex = Math.min(lineCount - 1, Math.max(0, Math.floor(ratioY * lineCount)));
      const targetLineNumber = Math.min(endLine.number, startLine.number + relativeLineIndex);
      const targetLine = doc.line(targetLineNumber);
      const lineFrom = Math.max(sourceRange.from, targetLine.from);
      const lineToExclusive = Math.min(sourceRange.to, targetLine.to + 1);
      const lineTo = Math.max(lineFrom, lineToExclusive - 1);

      if (
        Number.isFinite(clampedFallback) &&
        clampedFallback >= lineFrom &&
        clampedFallback <= lineTo
      ) {
        return clampedFallback;
      }

      return lineFrom;
    }

    if (Number.isFinite(clampedFallback)) {
      return clampedFallback;
    }

    return sourceRange.from;
  }

  function resolvePointerPosition(view, targetElement, coordinates = null) {
    if (coordinates && typeof view?.posAtCoords === 'function') {
      const mappedPos = view.posAtCoords(coordinates);
      if (Number.isFinite(mappedPos)) {
        return mappedPos;
      }
    }

    try {
      if (typeof view?.posAtDOM === 'function') {
        const domPos = view.posAtDOM(targetElement, 0);
        if (Number.isFinite(domPos)) {
          return domPos;
        }
      }
    } catch (error) {
      traceFailure(error);
    }

    return null;
  }

  return {
    findRenderedSourceRangeTarget,
    resolvePositionFromRenderedSourceRange,
    resolvePointerPosition
  };
}
