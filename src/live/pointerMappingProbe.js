export function createPointerMappingProbe({
  clampNumber,
  readBlockLineBoundsForLog,
  buildCoordSamples,
  readLineInfoForPosition,
  resolvePointerPosition,
  summarizeRectForLog,
  readComputedStyleSnapshotForLog,
  normalizeLogString
} = {}) {
  const clamp =
    typeof clampNumber === 'function'
      ? clampNumber
      : (value, min, max) => {
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
        };
  const readBlockLines =
    typeof readBlockLineBoundsForLog === 'function'
      ? readBlockLineBoundsForLog
      : () => null;
  const sampleCoords =
    typeof buildCoordSamples === 'function'
      ? buildCoordSamples
      : () => [];
  const readLineInfo =
    typeof readLineInfoForPosition === 'function'
      ? readLineInfoForPosition
      : () => null;
  const resolvePointerPos =
    typeof resolvePointerPosition === 'function'
      ? resolvePointerPosition
      : () => null;
  const summarizeRect =
    typeof summarizeRectForLog === 'function'
      ? summarizeRectForLog
      : () => null;
  const readStyle =
    typeof readComputedStyleSnapshotForLog === 'function'
      ? readComputedStyleSnapshotForLog
      : () => null;
  const normalizeText =
    typeof normalizeLogString === 'function'
      ? normalizeLogString
      : (value, maxLength = 120) => String(value ?? '').slice(0, maxLength);

  function buildRenderedPointerProbe(
    view,
    renderedBlock,
    targetElement,
    coordinates,
    blockBounds,
    sourcePos,
    sourceFromBlockBounds = null,
    sourcePosBlockBounds = null
  ) {
    if (
      !view?.state?.doc ||
      !renderedBlock?.getBoundingClientRect ||
      !coordinates ||
      !Number.isFinite(coordinates.x) ||
      !Number.isFinite(coordinates.y)
    ) {
      return null;
    }

    const doc = view.state.doc;
    const blockRect = renderedBlock.getBoundingClientRect();
    const targetRect = targetElement?.getBoundingClientRect?.() ?? null;
    const pointerOffsetY = Number.isFinite(blockRect.top)
      ? Number((coordinates.y - blockRect.top).toFixed(2))
      : null;
    const pointerOffsetX = Number.isFinite(blockRect.left)
      ? Number((coordinates.x - blockRect.left).toFixed(2))
      : null;
    const pointerRatioY =
      Number.isFinite(pointerOffsetY) && blockRect.height > 0
        ? Number((clamp(pointerOffsetY / blockRect.height, 0, 1) ?? 0).toFixed(4))
        : null;
    const pointerDistanceToBlockBottom =
      Number.isFinite(blockRect.bottom) ? Number((blockRect.bottom - coordinates.y).toFixed(2)) : null;

    const blockLineBounds = readBlockLines(doc, blockBounds);
    const sourceFromBlockLineBounds = readBlockLines(doc, sourceFromBlockBounds);
    const sourcePosBlockLineBounds = readBlockLines(doc, sourcePosBlockBounds);
    const leftX = Number.isFinite(blockRect.left) ? blockRect.left + 4 : Number.NaN;
    const centerX = Number.isFinite(blockRect.left) && Number.isFinite(blockRect.width)
      ? blockRect.left + blockRect.width / 2
      : Number.NaN;
    const rightX =
      Number.isFinite(blockRect.right) && Number.isFinite(blockRect.left)
        ? Math.max(blockRect.left + 4, blockRect.right - 4)
        : Number.NaN;
    const sampleY = coordinates.y;
    const coordSamples = sampleCoords(view, [
      { label: 'click', x: coordinates.x, y: sampleY },
      { label: 'block-left', x: leftX, y: sampleY },
      { label: 'block-center', x: centerX, y: sampleY },
      { label: 'block-right', x: rightX, y: sampleY }
    ]);
    const verticalScanCoordSamples = sampleCoords(
      view,
      [-18, -12, -8, -4, 0, 4, 8, 12, 18].map((offset) => ({
        label: `pointer-y${offset >= 0 ? `+${offset}` : offset}`,
        x: coordinates.x,
        y: coordinates.y + offset
      }))
    );
    const edgeCoordSamples = sampleCoords(view, [
      { label: 'edge-top-outer', x: coordinates.x, y: blockRect.top - 1 },
      { label: 'edge-top-inner', x: coordinates.x, y: blockRect.top + 1 },
      { label: 'edge-bottom-inner', x: coordinates.x, y: blockRect.bottom - 1 },
      { label: 'edge-bottom-outer', x: coordinates.x, y: blockRect.bottom + 1 }
    ]);

    const sourceLineInfo = readLineInfo(doc, sourcePos);
    const domBlockPos = resolvePointerPos(view, renderedBlock, null);
    const domTargetPos = resolvePointerPos(view, targetElement, null);

    return {
      pointer: {
        x: Number(coordinates.x.toFixed(2)),
        y: Number(coordinates.y.toFixed(2)),
        pointerOffsetX,
        pointerOffsetY,
        pointerRatioY,
        pointerDistanceToBlockBottom
      },
      renderedBlockRect: summarizeRect(blockRect),
      renderedBlockStyle: readStyle(renderedBlock),
      targetRect: summarizeRect(targetRect),
      targetStyle: readStyle(targetElement),
      targetTagName: targetElement?.tagName ?? null,
      targetClassName:
        typeof targetElement?.className === 'string'
          ? normalizeText(targetElement.className, 120)
          : null,
      blockLineBounds,
      sourceFromBlockLineBounds,
      sourcePosBlockLineBounds,
      sourceLineInfo,
      domBlockPos,
      domTargetPos,
      coordSamples,
      verticalScanCoordSamples,
      edgeCoordSamples
    };
  }

  function buildLineFallbackPointerProbe(
    view,
    lineElement,
    targetElement,
    coordinates,
    blockBounds,
    sourcePos
  ) {
    if (!view?.state?.doc || !lineElement?.getBoundingClientRect) {
      return null;
    }

    const doc = view.state.doc;
    const lineRect = lineElement.getBoundingClientRect();
    const targetRect = targetElement?.getBoundingClientRect?.() ?? null;
    const pointerOffsetY =
      coordinates && Number.isFinite(lineRect.top) && Number.isFinite(coordinates.y)
        ? Number((coordinates.y - lineRect.top).toFixed(2))
        : null;
    const pointerOffsetX =
      coordinates && Number.isFinite(lineRect.left) && Number.isFinite(coordinates.x)
        ? Number((coordinates.x - lineRect.left).toFixed(2))
        : null;
    const blockLineBounds = readBlockLines(doc, blockBounds);

    const sampleY = coordinates?.y ?? lineRect.top + Math.max(1, lineRect.height / 2);
    const coordSamples = sampleCoords(view, [
      {
        label: 'line-left',
        x: lineRect.left + 4,
        y: sampleY
      },
      {
        label: 'line-center',
        x: lineRect.left + lineRect.width / 2,
        y: sampleY
      },
      {
        label: 'line-right',
        x: Math.max(lineRect.left + 4, lineRect.right - 4),
        y: sampleY
      }
    ]);

    return {
      pointer: coordinates
        ? {
            x: Number(coordinates.x.toFixed(2)),
            y: Number(coordinates.y.toFixed(2)),
            pointerOffsetX,
            pointerOffsetY
          }
        : null,
      lineRect: summarizeRect(lineRect),
      targetRect: summarizeRect(targetRect),
      lineTagName: lineElement?.tagName ?? null,
      targetTagName: targetElement?.tagName ?? null,
      lineTextPreview: normalizeText(lineElement?.textContent ?? '', 100),
      sourceLineInfo: readLineInfo(doc, sourcePos),
      blockLineBounds,
      coordSamples
    };
  }

  return {
    buildRenderedPointerProbe,
    buildLineFallbackPointerProbe
  };
}
