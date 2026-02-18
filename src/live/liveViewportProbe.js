export function createLiveViewportProbe({
  normalizeLogString,
  liveDebugCursorMaxExpectedHeightPx = 42,
  liveDebugCursorMaxExpectedWidthPx = 6,
  liveDebugCursorRightDriftPx = 12,
  liveDebugCursorTransientDriftDeltaPx = 80,
  windowObject = window
} = {}) {
  const normalizeText =
    typeof normalizeLogString === 'function'
      ? normalizeLogString
      : (value, maxLength = 120) => String(value ?? '').slice(0, maxLength);

  function parsePositivePixelValue(rawValue) {
    const numeric = Number.parseFloat(String(rawValue ?? ''));
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return null;
    }

    return numeric;
  }

  function resolveCursorLineHeight(view, cursorRect = null) {
    const candidates = [
      ['content-style', windowObject.getComputedStyle(view.contentDOM).lineHeight],
      ['scroller-style', windowObject.getComputedStyle(view.scrollDOM).lineHeight],
      ['editor-style', windowObject.getComputedStyle(view.dom).lineHeight],
      ['cm-default-line-height', view.defaultLineHeight],
      ['cursor-fallback', cursorRect?.height]
    ];

    for (const [source, rawValue] of candidates) {
      const parsed = parsePositivePixelValue(rawValue);
      if (parsed === null) {
        continue;
      }

      // Cursor fallback only helps when cursor geometry already looks plausible.
      if (source === 'cursor-fallback' && parsed > liveDebugCursorMaxExpectedHeightPx) {
        continue;
      }

      return {
        lineHeight: Number(parsed.toFixed(2)),
        lineHeightSource: source
      };
    }

    return {
      lineHeight: null,
      lineHeightSource: null
    };
  }

  function readCursorVisibilityForLog(view, selectionHead = Number.NaN) {
    if (!view?.dom || !view?.scrollDOM) {
      return {
        hasView: false
      };
    }

    const cursorElement = view.dom.querySelector('.cm-cursor');
    const cursorCount = view.dom.querySelectorAll('.cm-cursor').length;
    const cursorRect = cursorElement?.getBoundingClientRect?.() ?? null;
    const scrollerRect = view.scrollDOM.getBoundingClientRect();
    const activeLineElement = view.dom.querySelector('.cm-activeLine');
    const activeLineRect = activeLineElement?.getBoundingClientRect?.() ?? null;
    const headCoords = Number.isFinite(selectionHead) ? view.coordsAtPos(selectionHead) : null;
    const headLineBlock = Number.isFinite(selectionHead) ? view.lineBlockAt(selectionHead) : null;
    const { lineHeight, lineHeightSource } = resolveCursorLineHeight(view, cursorRect);
    const inVerticalViewport = Boolean(
      cursorRect &&
        cursorRect.bottom >= scrollerRect.top &&
        cursorRect.top <= scrollerRect.bottom
    );
    const inHorizontalViewport = Boolean(
      cursorRect &&
        cursorRect.right >= scrollerRect.left &&
        cursorRect.left <= scrollerRect.right
    );
    const farRightFromScroller = Boolean(
      cursorRect &&
        cursorRect.left > scrollerRect.right + liveDebugCursorRightDriftPx
    );
    const nearRightEdge = Boolean(
      cursorRect &&
        (cursorRect.left >= scrollerRect.right - 4 || farRightFromScroller)
    );
    const oversizedHeightByLineHeight = Boolean(
      cursorRect &&
        Number.isFinite(lineHeight) &&
        lineHeight > 0 &&
        cursorRect.height > lineHeight * 2.5
    );
    const oversizedHeightAbsolute = Boolean(
      cursorRect && cursorRect.height > liveDebugCursorMaxExpectedHeightPx
    );
    const oversizedHeight = oversizedHeightByLineHeight || oversizedHeightAbsolute;
    const oversizedWidth = Boolean(
      cursorRect && cursorRect.width > liveDebugCursorMaxExpectedWidthPx
    );
    const headCoordsDeltaX =
      cursorRect && headCoords
        ? Number((cursorRect.left - headCoords.left).toFixed(2))
        : null;
    const cursorOutOfSyncWithHeadCoords = Boolean(
      Number.isFinite(headCoordsDeltaX) &&
        Math.abs(headCoordsDeltaX) >= liveDebugCursorTransientDriftDeltaPx
    );

    return {
      hasView: true,
      cursorCount,
      hasCursorElement: Boolean(cursorElement),
      cursorHeight: cursorRect ? Number(cursorRect.height.toFixed(2)) : null,
      cursorWidth: cursorRect ? Number(cursorRect.width.toFixed(2)) : null,
      cursorTop: cursorRect ? Number(cursorRect.top.toFixed(2)) : null,
      cursorRight: cursorRect ? Number(cursorRect.right.toFixed(2)) : null,
      cursorBottom: cursorRect ? Number(cursorRect.bottom.toFixed(2)) : null,
      cursorLeft: cursorRect ? Number(cursorRect.left.toFixed(2)) : null,
      headCoordsLeft: headCoords ? Number(headCoords.left.toFixed(2)) : null,
      headCoordsRight: headCoords ? Number(headCoords.right.toFixed(2)) : null,
      headCoordsTop: headCoords ? Number(headCoords.top.toFixed(2)) : null,
      headCoordsBottom: headCoords ? Number(headCoords.bottom.toFixed(2)) : null,
      headCoordsNearRightEdge: Boolean(
        headCoords && headCoords.left >= scrollerRect.right - 4
      ),
      headCoordsDeltaX,
      cursorOutOfSyncWithHeadCoords,
      headLineBlockFrom: headLineBlock?.from ?? null,
      headLineBlockTo: headLineBlock?.to ?? null,
      headLineBlockTop: Number.isFinite(headLineBlock?.top)
        ? Number(headLineBlock.top.toFixed(2))
        : null,
      headLineBlockHeight: Number.isFinite(headLineBlock?.height)
        ? Number(headLineBlock.height.toFixed(2))
        : null,
      activeLineElementPresent: Boolean(activeLineElement),
      activeLineLeft: activeLineRect ? Number(activeLineRect.left.toFixed(2)) : null,
      activeLineRight: activeLineRect ? Number(activeLineRect.right.toFixed(2)) : null,
      activeLineTop: activeLineRect ? Number(activeLineRect.top.toFixed(2)) : null,
      activeLineBottom: activeLineRect ? Number(activeLineRect.bottom.toFixed(2)) : null,
      activeLineTextPreview: activeLineElement
        ? normalizeText(activeLineElement.textContent ?? '', 90)
        : null,
      inVerticalViewport,
      inHorizontalViewport,
      nearRightEdge,
      farRightFromScroller,
      oversizedHeight,
      oversizedHeightByLineHeight,
      oversizedHeightAbsolute,
      oversizedWidth,
      lineHeight,
      lineHeightSource,
      scrollerLeft: Number(scrollerRect.left.toFixed(2)),
      scrollerRight: Number(scrollerRect.right.toFixed(2)),
      scrollerTop: Number(scrollerRect.top.toFixed(2)),
      scrollerBottom: Number(scrollerRect.bottom.toFixed(2)),
      scrollTop: Number(view.scrollDOM.scrollTop.toFixed(2)),
      scrollHeight: Number(view.scrollDOM.scrollHeight.toFixed(2)),
      clientHeight: Number(view.scrollDOM.clientHeight.toFixed(2))
    };
  }

  function readGutterVisibilityForLog(view) {
    if (!view?.dom || !view?.scrollDOM) {
      return {
        hasView: false
      };
    }

    const gutters = view.dom.querySelector('.cm-gutters');
    if (!gutters) {
      return {
        hasView: true,
        hasGutters: false
      };
    }

    const gutterStyle = windowObject.getComputedStyle(gutters);
    const gutterRect = gutters.getBoundingClientRect();
    const scrollerRect = view.scrollDOM.getBoundingClientRect();
    const gutterElements = [...view.dom.querySelectorAll('.cm-lineNumbers .cm-gutterElement')];
    const visibleLineNumberCount = gutterElements.reduce((count, element) => {
      const rect = element.getBoundingClientRect();
      if (rect.height < 0.5) {
        return count;
      }

      const overlapsViewport =
        rect.bottom >= scrollerRect.top && rect.top <= scrollerRect.bottom;
      return overlapsViewport ? count + 1 : count;
    }, 0);

    return {
      hasView: true,
      hasGutters: true,
      display: gutterStyle.display,
      visibility: gutterStyle.visibility,
      width: Number(gutterRect.width.toFixed(2)),
      totalLineNumberCount: gutterElements.length,
      visibleLineNumberCount
    };
  }

  return {
    readCursorVisibilityForLog,
    readGutterVisibilityForLog
  };
}
