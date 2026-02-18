export function createLiveDiagnosticsLogHelpers({
  normalizeLogString,
  windowObject = typeof window !== 'undefined' ? window : null,
  elementConstructor = typeof Element === 'function' ? Element : null,
  nodeConstructor = typeof Node === 'function' ? Node : null
} = {}) {
  const normalizeText =
    typeof normalizeLogString === 'function'
      ? normalizeLogString
      : (value, maxLength = 120) => String(value ?? '').trim().slice(0, maxLength);

  function isElement(value) {
    if (!value) {
      return false;
    }

    if (elementConstructor) {
      return value instanceof elementConstructor;
    }

    return typeof value.tagName === 'string' && typeof value.getAttribute === 'function';
  }

  function describeElementForLog(element) {
    if (!isElement(element)) {
      return null;
    }

    return {
      tagName: element.tagName,
      id: element.id || '',
      className:
        typeof element.className === 'string' ? normalizeText(element.className, 140) : '',
      sourceFrom: element.getAttribute('data-source-from') ?? null,
      fragmentFrom: element.getAttribute('data-fragment-from') ?? null,
      textPreview: normalizeText(element.textContent ?? '', 90)
    };
  }

  function describeNodeForLog(node) {
    if (!node) {
      return null;
    }

    if (isElement(node)) {
      return describeElementForLog(node);
    }

    const textNodeType = Number.isFinite(nodeConstructor?.TEXT_NODE) ? nodeConstructor.TEXT_NODE : 3;
    if (node.nodeType === textNodeType) {
      const parent = node.parentElement;
      return {
        nodeType: 'text',
        textPreview: normalizeText(node.textContent ?? '', 60),
        parentTag: parent?.tagName ?? null,
        parentClass:
          typeof parent?.className === 'string' ? normalizeText(parent.className, 120) : null
      };
    }

    return {
      nodeType: String(node.nodeType)
    };
  }

  function readDomSelectionForLog(targetWindow = windowObject) {
    try {
      const domSelection = targetWindow?.getSelection?.() ?? null;
      const activeElementRaw = targetWindow?.document?.activeElement;
      const activeElement = isElement(activeElementRaw) ? activeElementRaw : null;

      if (!domSelection) {
        return {
          hasSelection: false,
          activeElement: describeElementForLog(activeElement)
        };
      }

      return {
        hasSelection: true,
        rangeCount: domSelection.rangeCount,
        isCollapsed: domSelection.isCollapsed,
        anchorOffset: domSelection.anchorOffset,
        focusOffset: domSelection.focusOffset,
        anchorNode: describeNodeForLog(domSelection.anchorNode),
        focusNode: describeNodeForLog(domSelection.focusNode),
        activeElement: describeElementForLog(activeElement)
      };
    } catch (error) {
      return {
        hasSelection: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  return {
    describeElementForLog,
    describeNodeForLog,
    readDomSelectionForLog
  };
}
