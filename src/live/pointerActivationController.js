import { findSourceMapEntriesAtPosition } from '../core/mapping/SourceMapIndex.js';

export function createPointerActivationController({
  app,
  liveDebug,
  sourceFirstMode = true,
  livePreviewRenderedDomAnchorStickyMaxPosDelta = 40,
  livePreviewRenderedFencedStickyMaxPosDelta = 12,
  livePreviewRenderedFencedStickyMaxLineDelta = 2,
  livePreviewRenderedBoundaryStickyMaxPosDelta = 30,
  livePreviewRenderedBoundaryStickyMaxLineDelta = 3,
  livePreviewRenderedBoundaryStickyMaxDistanceFromBottomPx = 14,
  livePreviewRenderedBoundaryStickyMinRatioY = 0.3,
  liveDebugBlockMapLargeDeltaPos = 20,
  liveDebugBlockMapLargeDeltaLines = 2,
  requestAnimationFrameFn = (callback) => window.requestAnimationFrame(callback),
  liveBlocksForView,
  liveSourceMapIndexForView,
  normalizePointerTarget,
  readPointerCoordinates,
  describeElementForLog,
  recordInputSignal,
  resolvePointerPosition,
  readLineInfoForPosition,
  readBlockLineBoundsForLog,
  resolveActivationBlockBounds,
  resolveLiveBlockSelection,
  findBlockContainingPosition,
  findNearestBlockForPosition,
  isFencedCodeBlock,
  parseSourceFromAttribute,
  findRenderedSourceRangeTarget,
  resolvePositionFromRenderedSourceRange,
  distanceToBlockBounds,
  shouldPreferRenderedDomAnchorPosition,
  shouldPreferSourceFromForRenderedFencedClick,
  shouldPreferSourceFromForRenderedBoundaryClick,
  buildRenderedPointerProbe,
  summarizeLineNumbersForCoordSamples,
  normalizeLogString
} = {}) {
  function normalizeBounds(from, to) {
    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      return null;
    }

    const rangeFrom = Math.max(0, Math.trunc(from));
    const rangeTo = Math.max(rangeFrom, Math.trunc(to));
    if (rangeTo <= rangeFrom) {
      return null;
    }

    return {
      from: rangeFrom,
      to: rangeTo
    };
  }

  function readSourceMapIndex(view) {
    if (typeof liveSourceMapIndexForView !== 'function') {
      return [];
    }

    const index = liveSourceMapIndexForView(view);
    return Array.isArray(index) ? index : [];
  }

  function findSourceMapContext(sourceMapIndex, sourceFrom, sourceTo, fragmentFrom, fragmentTo) {
    if (!Array.isArray(sourceMapIndex) || sourceMapIndex.length === 0) {
      return {
        blockBounds: null,
        fragmentBounds: null,
        match: null
      };
    }

    let blockEntry = null;
    if (Number.isFinite(sourceFrom)) {
      blockEntry = sourceMapIndex.find((entry) =>
        entry?.kind === 'block' &&
          entry.sourceFrom === sourceFrom &&
          (!Number.isFinite(sourceTo) || entry.sourceTo === sourceTo)
      ) ?? null;
      if (!blockEntry) {
        blockEntry = sourceMapIndex.find((entry) =>
          entry?.kind === 'block' &&
            Number.isFinite(entry.sourceFrom) &&
            Number.isFinite(entry.sourceTo) &&
            sourceFrom >= entry.sourceFrom &&
            sourceFrom < entry.sourceTo
        ) ?? null;
      }
    }

    let fragmentEntry = null;
    if (Number.isFinite(fragmentFrom) && Number.isFinite(fragmentTo)) {
      fragmentEntry = sourceMapIndex.find((entry) =>
        entry?.kind === 'rendered-fragment' &&
          entry.fragmentFrom === fragmentFrom &&
          entry.fragmentTo === fragmentTo &&
          (
            !blockEntry ||
            (entry.blockFrom === blockEntry.blockFrom && entry.blockTo === blockEntry.blockTo)
          )
      ) ?? null;
    }

    if (!fragmentEntry && blockEntry) {
      fragmentEntry = sourceMapIndex.find((entry) =>
        entry?.kind === 'rendered-fragment' &&
          entry.blockFrom === blockEntry.blockFrom &&
          entry.blockTo === blockEntry.blockTo
      ) ?? null;
    }

    const blockBounds = blockEntry
      ? normalizeBounds(blockEntry.blockFrom, blockEntry.blockTo)
      : null;
    const fragmentBounds = fragmentEntry
      ? normalizeBounds(fragmentEntry.fragmentFrom, fragmentEntry.fragmentTo)
      : null;
    const match = blockEntry || fragmentEntry
      ? {
          block: blockEntry?.id ?? null,
          fragment: fragmentEntry?.id ?? null
        }
      : null;

    return {
      blockBounds,
      fragmentBounds,
      match
    };
  }

  function findSourceMapBlockBoundsForPosition(sourceMapIndex, position) {
    if (!Array.isArray(sourceMapIndex) || !Number.isFinite(position)) {
      return null;
    }

    const matches = findSourceMapEntriesAtPosition(sourceMapIndex, position);
    const blockMatch = matches.find(
      (entry) => entry?.kind === 'block' && Number.isFinite(entry.blockFrom) && Number.isFinite(entry.blockTo)
    ) ?? null;
    const fallbackMatch = blockMatch ?? matches.find(
      (entry) => Number.isFinite(entry?.blockFrom) && Number.isFinite(entry?.blockTo)
    ) ?? null;
    if (!fallbackMatch) {
      return null;
    }

    return normalizeBounds(fallbackMatch.blockFrom, fallbackMatch.blockTo);
  }

  function resolveLiveActivationContext(view, targetElement, coordinates, trigger) {
    const blocks = liveBlocksForView(view);
    const sourceMapIndex = readSourceMapIndex(view);
    const renderedBlock = targetElement.closest('.cm-rendered-block');
    if (renderedBlock) {
      const sourceFrom = parseSourceFromAttribute(renderedBlock.getAttribute('data-source-from'));
      if (sourceFrom === null) {
        liveDebug.warn('block.activate.skipped', {
          trigger,
          reason: 'invalid-source-from'
        });
        return null;
      }
      const sourceTo = parseSourceFromAttribute(renderedBlock.getAttribute('data-source-to'));
      const fragmentFrom = parseSourceFromAttribute(renderedBlock.getAttribute('data-fragment-from'));
      const fragmentTo = parseSourceFromAttribute(renderedBlock.getAttribute('data-fragment-to'));
      const sourceMapContext = findSourceMapContext(
        sourceMapIndex,
        sourceFrom,
        sourceTo,
        fragmentFrom,
        fragmentTo
      );
      const sourceAnchorFrom = sourceMapContext.blockBounds?.from ?? sourceFrom;

      const sourceRangeTarget = findRenderedSourceRangeTarget(targetElement, renderedBlock);
      const sourcePosByCoordinates = resolvePointerPosition(view, renderedBlock, coordinates);
      const sourcePosBySourceRange = resolvePositionFromRenderedSourceRange(
        view.state.doc,
        sourceRangeTarget?.range ?? null,
        sourceRangeTarget?.element ?? null,
        coordinates,
        sourcePosByCoordinates
      );
      const sourcePosByDomTarget = resolvePointerPosition(view, targetElement, null);
      const sourcePosByDomBlock = resolvePointerPosition(view, renderedBlock, null);
      const blockBoundsBySourceFrom = sourceMapContext.blockBounds ?? resolveActivationBlockBounds(
        blocks,
        sourceAnchorFrom,
        Number.isFinite(sourcePosBySourceRange) ? sourcePosBySourceRange : sourcePosByCoordinates
      );
      const sourcePosBySourceMap = (
        !Number.isFinite(sourcePosBySourceRange) &&
        sourceMapContext.fragmentBounds &&
        (
          Number.isFinite(sourcePosByCoordinates) ||
          Number.isFinite(sourceMapContext.fragmentBounds?.from)
        )
      )
        ? resolveLiveBlockSelection(
            view.state.doc.length,
            sourceMapContext.fragmentBounds.from,
            Number.isFinite(sourcePosByCoordinates)
              ? sourcePosByCoordinates
              : sourceMapContext.fragmentBounds.from,
            sourceMapContext.fragmentBounds
          )
        : null;
      const sourcePosByCoordinatesDistanceToSourceFromBlock =
        Number.isFinite(sourcePosByCoordinates) && blockBoundsBySourceFrom
          ? distanceToBlockBounds(sourcePosByCoordinates, blockBoundsBySourceFrom)
          : null;
      const sourcePosBySourceRangeDistanceToSourceFromBlock =
        Number.isFinite(sourcePosBySourceRange) && blockBoundsBySourceFrom
          ? distanceToBlockBounds(sourcePosBySourceRange, blockBoundsBySourceFrom)
          : null;
      const sourcePosByDomTargetDistanceToSourceFromBlock =
        Number.isFinite(sourcePosByDomTarget) && blockBoundsBySourceFrom
          ? distanceToBlockBounds(sourcePosByDomTarget, blockBoundsBySourceFrom)
          : null;
      const sourcePosByDomBlockDistanceToSourceFromBlock =
        Number.isFinite(sourcePosByDomBlock) && blockBoundsBySourceFrom
          ? distanceToBlockBounds(sourcePosByDomBlock, blockBoundsBySourceFrom)
          : null;
      const allowHeuristicSticky =
        !Number.isFinite(sourcePosBySourceRange) && !Number.isFinite(sourcePosBySourceMap);
      const preferDomAnchorForRenderedClick = allowHeuristicSticky && shouldPreferRenderedDomAnchorPosition({
        sourcePosDistanceToSourceFromBlock: sourcePosByCoordinatesDistanceToSourceFromBlock,
        domTargetDistanceToSourceFromBlock: sourcePosByDomTargetDistanceToSourceFromBlock,
        domBlockDistanceToSourceFromBlock: sourcePosByDomBlockDistanceToSourceFromBlock,
        maxSourcePosDistance: livePreviewRenderedDomAnchorStickyMaxPosDelta
      });
      const sourcePosByStickyClamp =
        preferDomAnchorForRenderedClick &&
        Number.isFinite(sourcePosByCoordinates) &&
        blockBoundsBySourceFrom
          ? resolveLiveBlockSelection(
              view.state.doc.length,
              sourceFrom,
              sourcePosByCoordinates,
              blockBoundsBySourceFrom
            )
          : null;
      let sourcePos = sourcePosByCoordinates;
      let sourcePosOrigin = 'coordinates';
      if (Number.isFinite(sourcePosBySourceRange)) {
        sourcePos = sourcePosBySourceRange;
        sourcePosOrigin = 'source-range';
      } else if (Number.isFinite(sourcePosBySourceMap)) {
        sourcePos = sourcePosBySourceMap;
        sourcePosOrigin = 'source-map-fragment';
      } else if (preferDomAnchorForRenderedClick) {
        if (Number.isFinite(sourcePosByStickyClamp)) {
          sourcePos = sourcePosByStickyClamp;
          sourcePosOrigin = 'dom-sticky-clamped';
        } else if (sourcePosByDomTargetDistanceToSourceFromBlock === 0) {
          sourcePos = sourcePosByDomTarget;
          sourcePosOrigin = 'dom-target-sticky';
        } else if (sourcePosByDomBlockDistanceToSourceFromBlock === 0) {
          sourcePos = sourcePosByDomBlock;
          sourcePosOrigin = 'dom-block-sticky';
        }
      }

      if (!Number.isFinite(sourcePos)) {
        if (Number.isFinite(sourcePosByDomTarget)) {
          sourcePos = sourcePosByDomTarget;
          sourcePosOrigin = 'dom-target-fallback';
        } else if (Number.isFinite(sourcePosByDomBlock)) {
          sourcePos = sourcePosByDomBlock;
          sourcePosOrigin = 'dom-block-fallback';
        }
      }

      const blockBoundsBySourcePos = Number.isFinite(sourcePos)
        ? (
            findSourceMapBlockBoundsForPosition(sourceMapIndex, sourcePos) ??
            findBlockContainingPosition(blocks, sourcePos) ??
            findNearestBlockForPosition(blocks, sourcePos, 1)
          )
        : null;
      const sourcePosDistanceToSourceFromBlock =
        Number.isFinite(sourcePos) && blockBoundsBySourceFrom
          ? distanceToBlockBounds(sourcePos, blockBoundsBySourceFrom)
          : null;
      const sourcePosOutsideSourceFromBlock =
        Number.isFinite(sourcePos) &&
        blockBoundsBySourceFrom &&
        sourcePosDistanceToSourceFromBlock !== 0;
      const sourceFromBlockLineBounds = readBlockLineBoundsForLog(view.state.doc, blockBoundsBySourceFrom);
      const sourcePosBlockLineBounds = readBlockLineBoundsForLog(view.state.doc, blockBoundsBySourcePos);
      const sourcePosLineInfo = readLineInfoForPosition(view.state.doc, sourcePos);
      const sourcePosLineDeltaAfterSourceFromBlock =
        Number.isFinite(sourcePosLineInfo?.lineNumber) &&
        Number.isFinite(sourceFromBlockLineBounds?.endLineNumber)
          ? sourcePosLineInfo.lineNumber - sourceFromBlockLineBounds.endLineNumber
          : null;
      const sourceFromBlockIsFencedCode =
        blockBoundsBySourceFrom && isFencedCodeBlock(view.state.doc, blockBoundsBySourceFrom);
      const preferSourceFromForRenderedFencedClick = allowHeuristicSticky && shouldPreferSourceFromForRenderedFencedClick({
        targetTagName: targetElement?.tagName ?? null,
        sourceFromBlockIsFencedCode,
        sourcePosDistanceToSourceFromBlock,
        sourcePosLineDeltaAfterSourceFromBlock,
        maxDistance: livePreviewRenderedFencedStickyMaxPosDelta,
        maxLineDelta: livePreviewRenderedFencedStickyMaxLineDelta
      });
      const shouldReboundToSourcePosBlockCandidate =
        sourcePosOutsideSourceFromBlock &&
        blockBoundsBySourcePos &&
        blockBoundsBySourcePos !== blockBoundsBySourceFrom;
      const provisionalBlockBounds = shouldReboundToSourcePosBlockCandidate
        ? blockBoundsBySourcePos
        : blockBoundsBySourceFrom;
      const pointerProbeForDecision = buildRenderedPointerProbe(
        view,
        renderedBlock,
        targetElement,
        coordinates,
        provisionalBlockBounds,
        sourcePos,
        blockBoundsBySourceFrom,
        blockBoundsBySourcePos
      );
      const preferSourceFromForRenderedBoundaryClick = allowHeuristicSticky && shouldPreferSourceFromForRenderedBoundaryClick({
        targetTagName: targetElement?.tagName ?? null,
        sourceFromBlockIsFencedCode,
        sourcePosDistanceToSourceFromBlock,
        sourcePosLineDeltaAfterSourceFromBlock,
        pointerDistanceToBlockBottom: pointerProbeForDecision?.pointer?.pointerDistanceToBlockBottom ?? null,
        pointerRatioY: pointerProbeForDecision?.pointer?.pointerRatioY ?? null,
        maxSourcePosDistance: livePreviewRenderedBoundaryStickyMaxPosDelta,
        maxLineDelta: livePreviewRenderedBoundaryStickyMaxLineDelta,
        maxDistanceFromBottomPx: livePreviewRenderedBoundaryStickyMaxDistanceFromBottomPx,
        minPointerRatioY: livePreviewRenderedBoundaryStickyMinRatioY
      });
      const shouldReboundToSourcePosBlock =
        allowHeuristicSticky &&
        shouldReboundToSourcePosBlockCandidate &&
        !preferSourceFromForRenderedFencedClick &&
        !preferSourceFromForRenderedBoundaryClick;
      const blockBounds = shouldReboundToSourcePosBlock
        ? blockBoundsBySourcePos
        : blockBoundsBySourceFrom;
      const sourcePosDistanceToFinalBlock =
        Number.isFinite(sourcePos) ? distanceToBlockBounds(sourcePos, blockBounds) : null;
      const pointerProbe =
        provisionalBlockBounds === blockBounds
          ? pointerProbeForDecision
          : buildRenderedPointerProbe(
              view,
              renderedBlock,
              targetElement,
              coordinates,
              blockBounds,
              sourcePos,
              blockBoundsBySourceFrom,
              blockBoundsBySourcePos
            );
      const boundaryCrossingLineNumbers = summarizeLineNumbersForCoordSamples(
        pointerProbe?.verticalScanCoordSamples
      );
      const boundaryEdgeLineNumbers = summarizeLineNumbersForCoordSamples(
        pointerProbe?.edgeCoordSamples
      );
      const renderedBoundaryCrossingLikely =
        sourcePosOutsideSourceFromBlock &&
        blockBoundsBySourceFrom &&
        blockBoundsBySourcePos &&
        blockBoundsBySourcePos !== blockBoundsBySourceFrom &&
        Number.isFinite(sourcePosLineDeltaAfterSourceFromBlock) &&
        Math.abs(sourcePosLineDeltaAfterSourceFromBlock) >= 2;
      const sourcePosInBounds =
        Number.isFinite(sourcePos) && distanceToBlockBounds(sourcePos, blockBounds) === 0;
      const sourcePosNearFinalBlock =
        Number.isFinite(sourcePosDistanceToFinalBlock) && sourcePosDistanceToFinalBlock <= 1;
      const stickySelection = (preferSourceFromForRenderedFencedClick || preferSourceFromForRenderedBoundaryClick)
        ? resolveLiveBlockSelection(
            view.state.doc.length,
            sourceAnchorFrom,
            sourcePos,
            blockBoundsBySourceFrom
          )
        : null;
      const preferredSelection = Number.isFinite(stickySelection)
        ? stickySelection
        : Number.isFinite(sourcePos) && (sourcePosInBounds || sourcePosNearFinalBlock)
          ? sourcePos
          : null;
      const allowCoordinateRemap = !Number.isFinite(preferredSelection);
      if (!blockBounds) {
        liveDebug.trace('block.activate.rendered-block-unbounded', {
          trigger,
          sourceFrom,
          sourcePos: Number.isFinite(sourcePos) ? sourcePos : null
        });
      } else if (blockBoundsBySourceFrom && blockBoundsBySourceFrom.from !== sourceFrom) {
        liveDebug.trace('block.activate.rebound', {
          trigger,
          sourceFrom,
          reboundFrom: blockBoundsBySourceFrom.from,
          reboundTo: blockBoundsBySourceFrom.to,
          sourcePos: Number.isFinite(sourcePos) ? sourcePos : null
        });
      }

      if (shouldReboundToSourcePosBlock) {
        liveDebug.trace('block.activate.rendered-rebound-source-pos-block', {
          trigger,
          sourceFrom,
          sourcePos,
          sourcePosOrigin,
          reboundFrom: blockBoundsBySourcePos?.from ?? null,
          reboundTo: blockBoundsBySourcePos?.to ?? null,
          sourceFromBlockFrom: blockBoundsBySourceFrom?.from ?? null,
          sourceFromBlockTo: blockBoundsBySourceFrom?.to ?? null
        });
      }

      if (preferDomAnchorForRenderedClick) {
        liveDebug.trace('block.activate.rendered-dom-anchor-sticky', {
          trigger,
          sourceFrom,
          sourcePos,
          sourcePosOrigin,
          sourcePosByCoordinates,
          sourcePosByDomTarget,
          sourcePosByDomBlock,
          sourcePosByStickyClamp,
          sourcePosByCoordinatesDistanceToSourceFromBlock,
          sourcePosByDomTargetDistanceToSourceFromBlock,
          sourcePosByDomBlockDistanceToSourceFromBlock,
          sourceFromBlockFrom: blockBoundsBySourceFrom?.from ?? null,
          sourceFromBlockTo: blockBoundsBySourceFrom?.to ?? null
        });
      }

      if (Number.isFinite(sourcePosBySourceRange)) {
        liveDebug.trace('block.activate.rendered-source-range', {
          trigger,
          sourceFrom,
          sourcePos,
          sourcePosOrigin,
          sourcePosBySourceRange,
          sourcePosByCoordinates,
          sourceRangeFrom: sourceRangeTarget?.range?.from ?? null,
          sourceRangeTo: sourceRangeTarget?.range?.to ?? null,
          sourceRangeSource: sourceRangeTarget?.range?.source ?? null,
          sourceRangeTagName: sourceRangeTarget?.element?.tagName ?? null,
          sourceRangeClassName:
            typeof sourceRangeTarget?.element?.className === 'string'
              ? normalizeLogString(sourceRangeTarget.element.className, 120)
              : null
        });
      }

      if (preferSourceFromForRenderedFencedClick) {
        liveDebug.trace('block.activate.rendered-fenced-source-sticky', {
          trigger,
          sourceFrom,
          sourcePos,
          targetTagName: targetElement?.tagName ?? null,
          sourcePosDistanceToSourceFromBlock,
          sourcePosLineDeltaAfterSourceFromBlock,
          stickySelection,
          sourceFromBlockFrom: blockBoundsBySourceFrom?.from ?? null,
          sourceFromBlockTo: blockBoundsBySourceFrom?.to ?? null
        });
      }

      if (preferSourceFromForRenderedBoundaryClick) {
        liveDebug.trace('block.activate.rendered-boundary-source-sticky', {
          trigger,
          sourceFrom,
          sourcePos,
          targetTagName: targetElement?.tagName ?? null,
          sourcePosDistanceToSourceFromBlock,
          sourcePosLineDeltaAfterSourceFromBlock,
          pointerDistanceToBlockBottom: pointerProbe?.pointer?.pointerDistanceToBlockBottom ?? null,
          pointerRatioY: pointerProbe?.pointer?.pointerRatioY ?? null,
          stickySelection,
          sourceFromBlockFrom: blockBoundsBySourceFrom?.from ?? null,
          sourceFromBlockTo: blockBoundsBySourceFrom?.to ?? null
        });
      }

      if (renderedBoundaryCrossingLikely) {
        liveDebug.warn('block.activate.rendered-boundary-crossing', {
          trigger,
          sourceFrom,
          sourcePos,
          targetTagName: targetElement?.tagName ?? null,
          sourcePosDistanceToSourceFromBlock,
          sourcePosLineDeltaAfterSourceFromBlock,
          sourceFromBlockFrom: blockBoundsBySourceFrom?.from ?? null,
          sourceFromBlockTo: blockBoundsBySourceFrom?.to ?? null,
          sourcePosBlockFrom: blockBoundsBySourcePos?.from ?? null,
          sourcePosBlockTo: blockBoundsBySourcePos?.to ?? null,
          finalBlockFrom: blockBounds?.from ?? null,
          finalBlockTo: blockBounds?.to ?? null,
          sourceFromBlockLineBounds,
          sourcePosBlockLineBounds,
          boundaryCrossingLineNumbers,
          boundaryEdgeLineNumbers,
          pointerOffsetY: pointerProbe?.pointer?.pointerOffsetY ?? null,
          pointerRatioY: pointerProbe?.pointer?.pointerRatioY ?? null,
          pointerDistanceToBlockBottom: pointerProbe?.pointer?.pointerDistanceToBlockBottom ?? null
        });
      }

      if (
        blockBounds &&
        Number.isFinite(sourcePos) &&
        !sourcePosInBounds
      ) {
        liveDebug.trace('block.activate.rendered-source-pos-outside-block', {
          trigger,
          sourceFrom,
          sourcePos,
          sourcePosOrigin,
          sourcePosByCoordinates,
          sourcePosBySourceRange,
          sourcePosByDomTarget,
          sourcePosByDomBlock,
          sourcePosByStickyClamp,
          sourcePosByCoordinatesDistanceToSourceFromBlock,
          sourcePosBySourceRangeDistanceToSourceFromBlock,
          sourcePosByDomTargetDistanceToSourceFromBlock,
          sourcePosByDomBlockDistanceToSourceFromBlock,
          sourceRangeFrom: sourceRangeTarget?.range?.from ?? null,
          sourceRangeTo: sourceRangeTarget?.range?.to ?? null,
          sourceRangeSource: sourceRangeTarget?.range?.source ?? null,
          allowHeuristicSticky,
          preferDomAnchorForRenderedClick,
          preferSourceFromForRenderedFencedClick,
          preferSourceFromForRenderedBoundaryClick,
          targetTagName: targetElement?.tagName ?? null,
          sourceFromBlockLineBounds,
          sourcePosBlockLineBounds,
          sourcePosDistanceToSourceFromBlock,
          sourcePosLineDeltaAfterSourceFromBlock,
          boundaryCrossingLineNumbers,
          boundaryEdgeLineNumbers,
          blockFrom: blockBounds.from,
          blockTo: blockBounds.to
        });
      }

      liveDebug.trace('block.activate.rendered-pointer-probe', {
        trigger,
        sourceFrom,
        sourcePos: Number.isFinite(sourcePos) ? sourcePos : null,
        blockFrom: blockBounds?.from ?? null,
        blockTo: blockBounds?.to ?? null,
        sourcePosInBounds,
        sourcePosDistanceToFinalBlock,
        sourcePosNearFinalBlock,
        sourcePosOrigin,
        sourcePosByCoordinates,
        sourcePosBySourceRange,
        sourcePosBySourceMap,
        sourcePosByDomTarget,
        sourcePosByDomBlock,
        sourcePosByStickyClamp,
        sourcePosByCoordinatesDistanceToSourceFromBlock,
        sourcePosBySourceRangeDistanceToSourceFromBlock,
        sourcePosByDomTargetDistanceToSourceFromBlock,
        sourcePosByDomBlockDistanceToSourceFromBlock,
        sourceRangeFrom: sourceRangeTarget?.range?.from ?? null,
        sourceRangeTo: sourceRangeTarget?.range?.to ?? null,
        sourceRangeSource: sourceRangeTarget?.range?.source ?? null,
        allowHeuristicSticky,
        preferDomAnchorForRenderedClick,
        sourcePosDistanceToSourceFromBlock,
        sourcePosLineDeltaAfterSourceFromBlock,
        sourceFromBlockIsFencedCode,
        preferSourceFromForRenderedFencedClick,
        preferSourceFromForRenderedBoundaryClick,
        stickySelection,
        preferredSelection,
        allowCoordinateRemap,
        reboundToSourcePosBlock: shouldReboundToSourcePosBlock,
        sourceMapMatch: sourceMapContext.match,
        pointerProbe
      });

      return {
        sourceFrom: blockBounds?.from ?? sourceAnchorFrom,
        sourcePos: preferredSelection,
        rawSourcePos: Number.isFinite(sourcePosByCoordinates) ? sourcePosByCoordinates : null,
        sourcePosOrigin,
        blockBounds,
        strategy: 'rendered-block',
        match: sourceMapContext.match,
        allowCoordinateRemap,
        pointerProbe
      };
    }
    liveDebug.trace('block.activate.pass-through-native', {
      trigger,
      reason: 'not-rendered-block-target',
      tagName: targetElement.tagName,
      className: typeof targetElement.className === 'string' ? targetElement.className : ''
    });
    return null;
  }

  function activateLiveBlock(
    view,
    sourceFrom,
    coordinates = null,
    trigger = 'unknown',
    blockBounds = null,
    preferredSelection = null,
    allowCoordinateRemap = true,
    strategy = null
  ) {
    const docLength = view.state.doc.length;
    const preferredPos = Number.isFinite(preferredSelection) ? preferredSelection : sourceFrom;
    const baseSelection = resolveLiveBlockSelection(docLength, sourceFrom, preferredPos, blockBounds);
    const baseSelectionLineInfo = readLineInfoForPosition(view.state.doc, baseSelection);

    try {
      view.dispatch({
        selection: { anchor: baseSelection },
        scrollIntoView: true
      });
      view.focus();
    } catch (error) {
      liveDebug.error('block.activate.dispatch-failed', {
        trigger,
        sourceFrom,
        selection: baseSelection,
        message: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
    liveDebug.trace('block.activated', {
      trigger,
      sourceFrom,
      selection: baseSelection,
      preferredSelection: Number.isFinite(preferredSelection) ? preferredSelection : null,
      baseSelectionLineInfo,
      allowCoordinateRemap,
      strategy: strategy ?? null,
      blockFrom: blockBounds?.from ?? null,
      blockTo: blockBounds?.to ?? null
    });

    if (!coordinates || !allowCoordinateRemap) {
      liveDebug.trace('block.position.mapped.skipped', {
        trigger,
        sourceFrom,
        selection: baseSelection,
        allowCoordinateRemap,
        reason: !coordinates ? 'missing-coordinates' : 'disabled-for-strategy',
        strategy: strategy ?? null,
        blockFrom: blockBounds?.from ?? null,
        blockTo: blockBounds?.to ?? null
      });
      return;
    }

    requestAnimationFrameFn(() => {
      const mappedPos = view.posAtCoords(coordinates);
      const docLengthAfterFrame = view.state.doc.length;
      const mappedPosLooksLikeDocEndDrift =
        !blockBounds &&
        Number.isFinite(mappedPos) &&
        mappedPos === docLengthAfterFrame &&
        sourceFrom < docLengthAfterFrame;
      const useMappedPosition =
        Number.isFinite(mappedPos) && !mappedPosLooksLikeDocEndDrift;
      const fallbackSelection = useMappedPosition ? sourceFrom : baseSelection;
      const nextMappedPos = useMappedPosition ? mappedPos : Number.NaN;
      const unboundedPos = resolveLiveBlockSelection(
        docLengthAfterFrame,
        fallbackSelection,
        nextMappedPos
      );
      const resolvedPos = resolveLiveBlockSelection(
        docLengthAfterFrame,
        fallbackSelection,
        nextMappedPos,
        blockBounds
      );
      const clampedByBlock = resolvedPos !== unboundedPos;
      const mappedLineInfo = readLineInfoForPosition(view.state.doc, mappedPos);
      const resolvedLineInfo = readLineInfoForPosition(view.state.doc, resolvedPos);
      const positionDeltaFromBase = Math.abs(resolvedPos - baseSelection);
      const lineDeltaFromBase =
        Number.isFinite(resolvedLineInfo?.lineNumber) && Number.isFinite(baseSelectionLineInfo?.lineNumber)
          ? Math.abs(resolvedLineInfo.lineNumber - baseSelectionLineInfo.lineNumber)
          : null;
      const largeDeltaDetected =
        Number.isFinite(positionDeltaFromBase) &&
        positionDeltaFromBase >= liveDebugBlockMapLargeDeltaPos &&
        Number.isFinite(lineDeltaFromBase) &&
        lineDeltaFromBase >= liveDebugBlockMapLargeDeltaLines;
      const rejectMappedSelection =
        largeDeltaDetected &&
        strategy === 'rendered-block' &&
        Number.isFinite(preferredSelection);

      liveDebug.trace('block.position.mapped', {
        trigger,
        sourceFrom,
        mappedPos,
        mappedAccepted: useMappedPosition,
        mappedPosLooksLikeDocEndDrift,
        unboundedPos,
        resolvedPos,
        baseSelection,
        baseSelectionLineInfo,
        mappedLineInfo,
        resolvedLineInfo,
        positionDeltaFromBase,
        lineDeltaFromBase,
        largeDeltaDetected,
        rejectMappedSelection,
        clampedByBlock,
        blockFrom: blockBounds?.from ?? null,
        blockTo: blockBounds?.to ?? null,
        x: coordinates.x,
        y: coordinates.y
      });

      if (
        Number.isFinite(positionDeltaFromBase) &&
        positionDeltaFromBase >= liveDebugBlockMapLargeDeltaPos &&
        Number.isFinite(lineDeltaFromBase) &&
        lineDeltaFromBase >= liveDebugBlockMapLargeDeltaLines
      ) {
        liveDebug.warn('block.position.mapped.large-delta', {
          trigger,
          sourceFrom,
          baseSelection,
          resolvedPos,
          positionDeltaFromBase,
          lineDeltaFromBase,
          mappedPos,
          mappedAccepted: useMappedPosition,
          blockFrom: blockBounds?.from ?? null,
          blockTo: blockBounds?.to ?? null,
          strategy: strategy ?? null,
          x: coordinates.x,
          y: coordinates.y
        });
      }

      if (rejectMappedSelection) {
        liveDebug.warn('block.position.mapped.rejected-large-delta', {
          trigger,
          sourceFrom,
          strategy,
          baseSelection,
          resolvedPos,
          mappedPos,
          positionDeltaFromBase,
          lineDeltaFromBase,
          preferredSelection,
          blockFrom: blockBounds?.from ?? null,
          blockTo: blockBounds?.to ?? null,
          x: coordinates.x,
          y: coordinates.y
        });
        return;
      }

      if (resolvedPos !== baseSelection) {
        view.dispatch({
          selection: { anchor: resolvedPos },
          scrollIntoView: true
        });
      }
    });
  }

  function handleLivePointerActivation(view, event, trigger) {
    const targetElement = normalizePointerTarget(event.target);
    const coordinates = readPointerCoordinates(event);
    const targetSummary = describeElementForLog(targetElement);

    if (app.viewMode === 'live') {
      const pointerSignal = recordInputSignal('pointer', {
        trigger,
        x: coordinates?.x ?? null,
        y: coordinates?.y ?? null,
        targetTag: targetSummary?.tagName ?? null,
        targetClassName: targetSummary?.className ?? null,
        sourceFrom: targetSummary?.sourceFrom ?? null
      });
      liveDebug.trace('input.pointer', {
        ...pointerSignal,
        target: targetSummary
      });
    }

    if (app.viewMode !== 'live') {
      return false;
    }

    if (!targetElement) {
      liveDebug.trace('block.activate.miss', {
        trigger,
        reason: 'no-element-target'
      });
      return false;
    }

    if (sourceFirstMode) {
      const rawMappedPosition = resolvePointerPosition(view, targetElement, coordinates);
      const truncatedMappedPosition = Number.isFinite(rawMappedPosition)
        ? Math.trunc(rawMappedPosition)
        : null;
      const mappedPosition = Number.isFinite(truncatedMappedPosition)
        ? Math.max(0, Math.min(view.state.doc.length, truncatedMappedPosition))
        : null;
      const clamped = (
        Number.isFinite(rawMappedPosition) &&
        Number.isFinite(mappedPosition) &&
        mappedPosition !== rawMappedPosition
      );
      const lineInfo = readLineInfoForPosition(view.state.doc, mappedPosition);
      const mappedBlock = resolveActivationBlockBounds(
        liveBlocksForView(view),
        mappedPosition,
        mappedPosition
      );
      liveDebug.trace('pointer.map.native', {
        trigger,
        x: coordinates?.x ?? null,
        y: coordinates?.y ?? null,
        rawMappedPosition: Number.isFinite(rawMappedPosition) ? rawMappedPosition : null,
        mappedPosition,
        lineInfo,
        blockFrom: mappedBlock?.from ?? null,
        blockTo: mappedBlock?.to ?? null,
        blockLineBounds: readBlockLineBoundsForLog(view.state.doc, mappedBlock),
        targetTagName: targetElement.tagName,
        targetClassName: typeof targetElement.className === 'string' ? targetElement.className : ''
      });
      if (clamped) {
        liveDebug.warn('pointer.map.clamped', {
          trigger,
          rawMappedPosition,
          mappedPosition,
          docLength: view.state.doc.length,
          targetTagName: targetElement.tagName
        });
      }

      return false;
    }

    const renderedBlockTarget = targetElement.closest('.cm-rendered-block');
    if (!renderedBlockTarget) {
      liveDebug.trace('block.activate.pass-through-native', {
        trigger,
        reason: 'not-rendered-block-target',
        tagName: targetElement.tagName,
        className: typeof targetElement.className === 'string' ? targetElement.className : ''
      });
      return false;
    }

    const activation = resolveLiveActivationContext(view, targetElement, coordinates, trigger);
    if (!activation) {
      return false;
    }

    liveDebug.trace('block.activate.request', {
      trigger,
      sourceFrom: activation.sourceFrom,
      sourcePos: activation.sourcePos,
      rawSourcePos: activation.rawSourcePos ?? null,
      sourcePosOrigin: activation.sourcePosOrigin ?? null,
      strategy: activation.strategy,
      match: activation.match ?? null,
      allowCoordinateRemap: activation.allowCoordinateRemap !== false,
      blockFrom: activation.blockBounds?.from ?? null,
      blockTo: activation.blockBounds?.to ?? null,
      pointerProbe: activation.pointerProbe ?? null,
      x: coordinates?.x ?? null,
      y: coordinates?.y ?? null
    });

    if (typeof event.preventDefault === 'function') {
      event.preventDefault();
    }

    try {
      activateLiveBlock(
        view,
        activation.sourceFrom,
        coordinates,
        trigger,
        activation.blockBounds,
        activation.sourcePos,
        activation.allowCoordinateRemap !== false,
        activation.strategy
      );
      return true;
    } catch (error) {
      liveDebug.error('block.activate.failed', {
        trigger,
        message: error instanceof Error ? error.message : String(error),
        sourceFrom: activation.sourceFrom,
        sourcePos: activation.sourcePos
      });
      return false;
    }
  }

  return {
    resolveLiveActivationContext,
    handleLivePointerActivation,
    activateLiveBlock
  };
}
