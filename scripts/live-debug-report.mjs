import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const projectRoot = process.cwd();
const logsDir = path.join(projectRoot, 'logs');

function parseCliArguments(argv) {
  let maxLines = 60;
  let explicitFileArg = null;

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--last') {
      const nextValue = Number(argv[index + 1]);
      if (Number.isInteger(nextValue)) {
        maxLines = Math.max(1, nextValue);
        index += 1;
      }
      continue;
    }

    if (arg.startsWith('--')) {
      continue;
    }

    if (!explicitFileArg) {
      explicitFileArg = arg;
    }
  }

  return {
    maxLines,
    explicitFileArg
  };
}

const { maxLines, explicitFileArg } = parseCliArguments(process.argv);

async function findLatestLogFile() {
  let entries;
  try {
    entries = await readdir(logsDir);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
  const candidatePaths = entries
    .filter((name) => name.startsWith('live-debug-') && name.endsWith('.jsonl'))
    .map((name) => path.join(logsDir, name));

  if (candidatePaths.length === 0) {
    return null;
  }

  const withStats = await Promise.all(
    candidatePaths.map(async (filePath) => ({
      filePath,
      stats: await stat(filePath)
    }))
  );

  withStats.sort((a, b) => b.stats.mtimeMs - a.stats.mtimeMs);
  return withStats[0].filePath;
}

function parseJsonLines(content) {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function summarize(records) {
  const counts = new Map();

  for (const record of records) {
    const eventName =
      typeof record?.entry?.event === 'string'
        ? record.entry.event
        : typeof record?.event === 'string'
          ? record.event
          : 'unknown';

    counts.set(eventName, (counts.get(eventName) ?? 0) + 1);
  }

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return sorted.slice(0, 12);
}

function summarizeAnomalies(records) {
  const summary = {
    selectionJumpDetected: 0,
    selectionJumpSuppressed: 0,
    slowDecorations: 0,
    longTasks: 0,
    renderedBlockUnbounded: 0,
    renderedSourcePosOutsideBlock: 0,
    renderedReboundSourcePosBlock: 0,
    renderedDomAnchorSticky: 0,
    renderedSourceRange: 0,
    renderedFencedSourceSticky: 0,
    renderedBoundarySourceSticky: 0,
    renderedBoundaryCrossing: 0,
    renderedPointerProbe: 0,
    lineSourceClamped: 0,
    passThroughNative: 0,
    blockPositionMappedSkipped: 0,
    blockPositionMappedLargeDelta: 0,
    blockPositionMappedRejectedLargeDelta: 0,
    blockFallbackRemapDisabled: 0,
    skippedEmptyActiveLineBlocks: 0,
    skippedEmptyLineBoundaryBlocks: 0,
    skippedActiveFencedCodeBlocks: 0,
    renderedFencedCodeTrailingBoundaryBlocks: 0,
    verticalInterceptApplied: 0,
    verticalInterceptMissed: 0,
    cursorVerticalMoves: 0,
    cursorVerticalSkips: 0,
    cursorVerticalAssocCorrections: 0,
    cursorVerticalBoundary: 0,
    cursorActiveLineMissing: 0,
    cursorVisibilityTransientDeferred: 0,
    cursorRecoverDispatch: 0,
    cursorRecoverFailed: 0,
    cursorVisibilitySuspect: 0,
    cursorVisibilityProbe: 0,
    gutterVisibilityProbe: 0,
    gutterVisibilityHidden: 0,
    gutterVisibilityUnexpected: 0,
    domSelectionchange: 0,
    maxCursorHeight: 0,
    maxCursorWidth: 0,
    maxVisibleGutterLineNumbers: 0,
    maxSelectionPositionDelta: 0,
    maxSelectionLineDelta: 0,
    markdownConfigEvents: 0,
    markdownBreaksEnabledEvents: 0,
    markdownBreaksDisabledEvents: 0,
    lastMarkdownBreaksEnabled: null,
    sourceFirstDecorationPassThrough: 0,
    sourceFirstDecorationBuilt: 0,
    blockIndexRebuilt: 0,
    blockIndexDelta: 0,
    fenceVisibilityState: 0,
    fenceInsideCount: 0,
    pointerMapNative: 0,
    pointerMapClamped: 0
  };

  for (const record of records) {
    const eventName =
      typeof record?.entry?.event === 'string'
        ? record.entry.event
        : typeof record?.event === 'string'
          ? record.event
          : '';
    const data = record?.entry?.data ?? {};

    if (eventName === 'selection.jump.detected') {
      summary.selectionJumpDetected += 1;
    }

    if (eventName === 'selection.jump.suppressed') {
      summary.selectionJumpSuppressed += 1;
    }

    if (eventName === 'decorations.slow') {
      summary.slowDecorations += 1;
    }

    if (eventName === 'perf.longtask') {
      summary.longTasks += 1;
    }

    if (eventName === 'block.activate.rendered-block-unbounded') {
      summary.renderedBlockUnbounded += 1;
    }

    if (eventName === 'block.activate.rendered-source-pos-outside-block') {
      summary.renderedSourcePosOutsideBlock += 1;
    }

    if (eventName === 'block.activate.rendered-rebound-source-pos-block') {
      summary.renderedReboundSourcePosBlock += 1;
    }

    if (eventName === 'block.activate.rendered-dom-anchor-sticky') {
      summary.renderedDomAnchorSticky += 1;
    }

    if (eventName === 'block.activate.rendered-source-range') {
      summary.renderedSourceRange += 1;
    }

    if (eventName === 'block.activate.rendered-fenced-source-sticky') {
      summary.renderedFencedSourceSticky += 1;
    }

    if (eventName === 'block.activate.rendered-boundary-source-sticky') {
      summary.renderedBoundarySourceSticky += 1;
    }

    if (eventName === 'block.activate.rendered-boundary-crossing') {
      summary.renderedBoundaryCrossing += 1;
    }

    if (eventName === 'block.activate.rendered-pointer-probe') {
      summary.renderedPointerProbe += 1;
    }

    if (eventName === 'block.activate.line-source-clamped') {
      summary.lineSourceClamped += 1;
    }

    if (eventName === 'block.activate.pass-through-native') {
      summary.passThroughNative += 1;
    }

    if (eventName === 'block.position.mapped.skipped') {
      summary.blockPositionMappedSkipped += 1;
    }

    if (eventName === 'block.position.mapped.large-delta') {
      summary.blockPositionMappedLargeDelta += 1;
    }

    if (eventName === 'block.position.mapped.rejected-large-delta') {
      summary.blockPositionMappedRejectedLargeDelta += 1;
    }

    if (eventName === 'block.activate.fallback' && data.allowCoordinateRemap === false) {
      summary.blockFallbackRemapDisabled += 1;
    }

    if (eventName === 'decorations.block.skipped-empty-active-line') {
      summary.skippedEmptyActiveLineBlocks += 1;
    }

    if (eventName === 'decorations.block.skipped-empty-line-boundary') {
      summary.skippedEmptyLineBoundaryBlocks += 1;
    }

    if (eventName === 'decorations.block.skipped-active-fenced-code') {
      summary.skippedActiveFencedCodeBlocks += 1;
    }

    if (eventName === 'decorations.block.trailing-boundary-fenced-code-render') {
      summary.renderedFencedCodeTrailingBoundaryBlocks += 1;
    }

    if (eventName === 'input.keydown.vertical-intercept.applied') {
      summary.verticalInterceptApplied += 1;
    }

    if (eventName === 'input.keydown.vertical-intercept') {
      if (!data.handled) {
        summary.verticalInterceptMissed += 1;
      }
    }

    if (eventName === 'cursor.move.vertical') {
      summary.cursorVerticalMoves += 1;
    }

    if (eventName === 'cursor.move.vertical.skipped') {
      summary.cursorVerticalSkips += 1;
    }

    if (eventName === 'cursor.move.vertical.corrected-assoc') {
      summary.cursorVerticalAssocCorrections += 1;
    }

    if (eventName === 'cursor.move.vertical.boundary') {
      summary.cursorVerticalBoundary += 1;
    }

    if (eventName === 'cursor.active-line.missing') {
      summary.cursorActiveLineMissing += 1;
    }

    if (eventName === 'cursor.visibility.defer-transient-drift') {
      summary.cursorVisibilityTransientDeferred += 1;
    }

    if (eventName === 'cursor.recover.dispatch') {
      summary.cursorRecoverDispatch += 1;
    }

    if (eventName === 'cursor.recover.failed') {
      summary.cursorRecoverFailed += 1;
    }

    if (eventName === 'cursor.visibility.suspect') {
      summary.cursorVisibilitySuspect += 1;
    }

    if (eventName === 'cursor.visibility.probe') {
      summary.cursorVisibilityProbe += 1;
      if (Number.isFinite(data?.cursorState?.cursorHeight)) {
        summary.maxCursorHeight = Math.max(summary.maxCursorHeight, data.cursorState.cursorHeight);
      }
      if (Number.isFinite(data?.cursorState?.cursorWidth)) {
        summary.maxCursorWidth = Math.max(summary.maxCursorWidth, data.cursorState.cursorWidth);
      }
    }

    if (eventName === 'gutter.visibility.probe') {
      summary.gutterVisibilityProbe += 1;
      if (Number.isFinite(data?.gutterState?.visibleLineNumberCount)) {
        summary.maxVisibleGutterLineNumbers = Math.max(
          summary.maxVisibleGutterLineNumbers,
          data.gutterState.visibleLineNumberCount
        );
      }
    }

    if (eventName === 'gutter.visibility.hidden') {
      summary.gutterVisibilityHidden += 1;
    }

    if (eventName === 'gutter.visibility.unexpected') {
      summary.gutterVisibilityUnexpected += 1;
    }

    if (eventName === 'dom.selectionchange') {
      summary.domSelectionchange += 1;
    }

    if (eventName === 'selection.changed') {
      if (Number.isFinite(data.positionDelta)) {
        summary.maxSelectionPositionDelta = Math.max(
          summary.maxSelectionPositionDelta,
          data.positionDelta
        );
      }
      if (Number.isFinite(data.lineDelta)) {
        summary.maxSelectionLineDelta = Math.max(
          summary.maxSelectionLineDelta,
          data.lineDelta
        );
      }
    }

    if (eventName === 'markdown.engine.config') {
      summary.markdownConfigEvents += 1;
      if (data.breaks === true) {
        summary.markdownBreaksEnabledEvents += 1;
        summary.lastMarkdownBreaksEnabled = true;
      } else if (data.breaks === false) {
        summary.markdownBreaksDisabledEvents += 1;
        summary.lastMarkdownBreaksEnabled = false;
      }
    }

    if (eventName === 'decorations.source-first-pass-through') {
      summary.sourceFirstDecorationPassThrough += 1;
    }

    if (eventName === 'decorations.source-first-built') {
      summary.sourceFirstDecorationBuilt += 1;
    }

    if (eventName === 'block.index.rebuilt') {
      summary.blockIndexRebuilt += 1;
    }

    if (eventName === 'block.index.delta') {
      summary.blockIndexDelta += 1;
    }

    if (eventName === 'fence.visibility.state') {
      summary.fenceVisibilityState += 1;
      if (data.insideFence === true) {
        summary.fenceInsideCount += 1;
      }
    }

    if (eventName === 'pointer.map.native') {
      summary.pointerMapNative += 1;
    }

    if (eventName === 'pointer.map.clamped') {
      summary.pointerMapClamped += 1;
    }
  }

  return summary;
}

function formatRecord(record) {
  const at = record?.entry?.at ?? record?.receivedAt ?? '';
  const eventName =
    typeof record?.entry?.event === 'string'
      ? record.entry.event
      : typeof record?.event === 'string'
        ? record.event
        : 'unknown';
  const session = record?.sessionId ?? 'n/a';
  const viewMode = record?.viewMode ?? '';
  const currentPath = record?.currentPath ?? '';
  const data = record?.entry?.data ?? {};

  let details = '';
  if (eventName === 'selection.changed') {
    details = ` head=${data.head ?? ''} prev=${data.previousHead ?? ''} dPos=${data.positionDelta ?? ''} dLine=${data.lineDelta ?? ''} input=${data.recentInputKey ?? data.recentInputKind ?? ''}`;
  } else if (eventName === 'selection.jump.detected') {
    details = ` prev=${data.previousHead ?? ''} next=${data.currentHead ?? ''} dPos=${data.positionDelta ?? ''} dLine=${data.lineDelta ?? ''} input=${data.recentInputKey ?? data.recentInputKind ?? ''}`;
  } else if (eventName === 'selection.jump.suppressed') {
    details = ` prev=${data.previousHead ?? ''} next=${data.currentHead ?? ''} dPos=${data.positionDelta ?? ''} dLine=${data.lineDelta ?? ''} docChanged=${String(Boolean(data.docChanged))} loading=${String(Boolean(data.appIsLoadingFile))}`;
  } else if (eventName === 'block.activate.request') {
    details = ` src=${data.sourceFrom ?? ''} strategy=${data.strategy ?? ''} remap=${String(Boolean(data.allowCoordinateRemap))} srcPos=${data.sourcePos ?? ''} rawPos=${data.rawSourcePos ?? ''} origin=${data.sourcePosOrigin ?? ''} block=${data.blockFrom ?? ''}-${data.blockTo ?? ''}`;
  } else if (eventName === 'block.activate.fallback') {
    details = ` strategy=${data.strategy ?? ''} origin=${data.sourcePosOrigin ?? ''} match=${data.match ?? ''} remap=${String(Boolean(data.allowCoordinateRemap))} src=${data.sourceFrom ?? ''} pos=${data.sourcePos ?? ''} rawPos=${data.sourcePosByCoordinates ?? ''} line=${data.pointerProbe?.sourceLineInfo?.lineNumber ?? ''} distance=${data.boundaryDistance ?? ''}`;
  } else if (eventName === 'block.activate.rendered-pointer-probe') {
    details = ` src=${data.sourceFrom ?? ''} pos=${data.sourcePos ?? ''} origin=${data.sourcePosOrigin ?? ''} inBounds=${String(Boolean(data.sourcePosInBounds))} near=${String(Boolean(data.sourcePosNearFinalBlock))} remap=${String(Boolean(data.allowCoordinateRemap))} rebound=${String(Boolean(data.reboundToSourcePosBlock))} target=${data.pointerProbe?.targetTagName ?? ''} ratioY=${data.pointerProbe?.pointer?.pointerRatioY ?? ''} distBottom=${data.pointerProbe?.pointer?.pointerDistanceToBlockBottom ?? ''} dist=${data.sourcePosDistanceToSourceFromBlock ?? ''} lineDelta=${data.sourcePosLineDeltaAfterSourceFromBlock ?? ''} sourceRange=${data.sourceRangeFrom ?? ''}-${data.sourceRangeTo ?? ''} sourceRangeType=${data.sourceRangeSource ?? ''} heuristics=${String(Boolean(data.allowHeuristicSticky))} domSticky=${String(Boolean(data.preferDomAnchorForRenderedClick))} stickyClamp=${data.sourcePosByStickyClamp ?? ''} boundarySticky=${String(Boolean(data.preferSourceFromForRenderedBoundaryClick))} blockLines=${data.pointerProbe?.blockLineBounds?.startLineNumber ?? ''}-${data.pointerProbe?.blockLineBounds?.endLineNumber ?? ''} clickLine=${data.pointerProbe?.coordSamples?.find?.((s) => s.label === 'click')?.lineNumber ?? ''}`;
  } else if (eventName === 'block.activate.rendered-rebound-source-pos-block') {
    details = ` src=${data.sourceFrom ?? ''} pos=${data.sourcePos ?? ''} origin=${data.sourcePosOrigin ?? ''} rebound=${data.reboundFrom ?? ''}-${data.reboundTo ?? ''} fromBlock=${data.sourceFromBlockFrom ?? ''}-${data.sourceFromBlockTo ?? ''}`;
  } else if (eventName === 'block.activate.rendered-dom-anchor-sticky') {
    details = ` src=${data.sourceFrom ?? ''} pos=${data.sourcePos ?? ''} origin=${data.sourcePosOrigin ?? ''} coordPos=${data.sourcePosByCoordinates ?? ''} stickyClamp=${data.sourcePosByStickyClamp ?? ''} domTargetPos=${data.sourcePosByDomTarget ?? ''} domBlockPos=${data.sourcePosByDomBlock ?? ''} coordDist=${data.sourcePosByCoordinatesDistanceToSourceFromBlock ?? ''}`;
  } else if (eventName === 'block.activate.rendered-source-range') {
    details = ` src=${data.sourceFrom ?? ''} pos=${data.sourcePos ?? ''} origin=${data.sourcePosOrigin ?? ''} range=${data.sourceRangeFrom ?? ''}-${data.sourceRangeTo ?? ''} rangeType=${data.sourceRangeSource ?? ''} rangeTag=${data.sourceRangeTagName ?? ''} coordPos=${data.sourcePosByCoordinates ?? ''} rangePos=${data.sourcePosBySourceRange ?? ''}`;
  } else if (eventName === 'block.activate.line-source-clamped') {
    details = ` pos=${data.sourcePos ?? ''} rawPos=${data.sourcePosByCoordinates ?? ''} domPos=${data.sourcePosByDomLine ?? ''} line=${data.sourcePosByDomLineInfo?.lineNumber ?? ''} range=${data.lineFrom ?? ''}-${data.lineTo ?? ''}`;
  } else if (eventName === 'block.activate.pass-through-native') {
    details = ` reason=${data.reason ?? ''} tag=${data.tagName ?? ''} class=${data.className ?? ''}`;
  } else if (eventName === 'block.activate.rendered-fenced-source-sticky') {
    details = ` src=${data.sourceFrom ?? ''} pos=${data.sourcePos ?? ''} target=${data.targetTagName ?? ''} dist=${data.sourcePosDistanceToSourceFromBlock ?? ''} lineDelta=${data.sourcePosLineDeltaAfterSourceFromBlock ?? ''} selection=${data.stickySelection ?? ''}`;
  } else if (eventName === 'block.activate.rendered-boundary-source-sticky') {
    details = ` src=${data.sourceFrom ?? ''} pos=${data.sourcePos ?? ''} target=${data.targetTagName ?? ''} dist=${data.sourcePosDistanceToSourceFromBlock ?? ''} lineDelta=${data.sourcePosLineDeltaAfterSourceFromBlock ?? ''} distBottom=${data.pointerDistanceToBlockBottom ?? ''} ratioY=${data.pointerRatioY ?? ''} selection=${data.stickySelection ?? ''}`;
  } else if (eventName === 'block.activate.rendered-boundary-crossing') {
    details = ` src=${data.sourceFrom ?? ''} pos=${data.sourcePos ?? ''} target=${data.targetTagName ?? ''} dist=${data.sourcePosDistanceToSourceFromBlock ?? ''} lineDelta=${data.sourcePosLineDeltaAfterSourceFromBlock ?? ''} fromBlock=${data.sourceFromBlockFrom ?? ''}-${data.sourceFromBlockTo ?? ''} toBlock=${data.sourcePosBlockFrom ?? ''}-${data.sourcePosBlockTo ?? ''} lines=${Array.isArray(data.boundaryCrossingLineNumbers) ? data.boundaryCrossingLineNumbers.join(',') : ''}`;
  } else if (eventName === 'block.position.mapped') {
    details = ` src=${data.sourceFrom ?? ''} mapped=${data.mappedPos ?? ''} accepted=${String(Boolean(data.mappedAccepted))} resolved=${data.resolvedPos ?? ''}`;
  } else if (eventName === 'block.position.mapped.skipped') {
    details = ` src=${data.sourceFrom ?? ''} reason=${data.reason ?? ''} remap=${String(Boolean(data.allowCoordinateRemap))} strategy=${data.strategy ?? ''} selection=${data.selection ?? ''}`;
  } else if (eventName === 'block.position.mapped.large-delta') {
    details = ` src=${data.sourceFrom ?? ''} base=${data.baseSelection ?? ''} resolved=${data.resolvedPos ?? ''} dPos=${data.positionDeltaFromBase ?? ''} dLine=${data.lineDeltaFromBase ?? ''} strategy=${data.strategy ?? ''}`;
  } else if (eventName === 'block.position.mapped.rejected-large-delta') {
    details = ` src=${data.sourceFrom ?? ''} base=${data.baseSelection ?? ''} resolved=${data.resolvedPos ?? ''} dPos=${data.positionDeltaFromBase ?? ''} dLine=${data.lineDeltaFromBase ?? ''} strategy=${data.strategy ?? ''}`;
  } else if (eventName === 'decorations.block.skipped-empty-active-line') {
    details = ` activeLine=${data.activeLineNumber ?? ''} lineLen=${data.activeLineLength ?? ''} block=${data.blockFrom ?? ''}-${data.blockTo ?? ''}`;
  } else if (eventName === 'decorations.block.skipped-empty-line-boundary') {
    details = ` activeLine=${data.activeLineNumber ?? ''} lineLen=${data.activeLineLength ?? ''} block=${data.blockFrom ?? ''}-${data.blockTo ?? ''}`;
  } else if (eventName === 'decorations.block.skipped-active-fenced-code') {
    details = ` activeLine=${data.activeLineNumber ?? ''} lineLen=${data.activeLineLength ?? ''} block=${data.blockFrom ?? ''}-${data.blockTo ?? ''}`;
  } else if (eventName === 'decorations.block.trailing-boundary-fenced-code-render') {
    details = ` activeLine=${data.activeLineNumber ?? ''} lineLen=${data.activeLineLength ?? ''} block=${data.blockFrom ?? ''}-${data.blockTo ?? ''}`;
  } else if (eventName === 'decorations.slow') {
    details = ` elapsedMs=${data.elapsedMs ?? ''} blocks=${data.blockCount ?? ''} decos=${data.decorationCount ?? ''}`;
  } else if (eventName === 'perf.longtask') {
    details = ` duration=${data.duration ?? ''}`;
  } else if (eventName === 'input.keydown.root') {
    details = ` key=${data.key ?? ''} head=${data.selectionHead ?? ''} mode=${data.mode ?? ''}`;
  } else if (eventName === 'input.keydown.vertical-intercept') {
    details = ` key=${data.key ?? ''} handled=${String(Boolean(data.handled))} before=${data.beforeHead ?? ''} after=${data.afterHead ?? ''}`;
  } else if (eventName === 'input.keydown.vertical-intercept.applied') {
    details = ` key=${data.key ?? ''} after=${data.afterHead ?? ''}`;
  } else if (eventName === 'cursor.move.vertical') {
    details = ` trigger=${data.trigger ?? ''} from=${data.from ?? ''} to=${data.to ?? ''} lines=${data.fromLine ?? ''}->${data.toLine ?? ''} lineLen=${data.currentLineLength ?? ''}->${data.targetLineLength ?? ''}`;
  } else if (eventName === 'cursor.move.vertical.skipped') {
    details = ` trigger=${data.trigger ?? ''} reason=${data.reason ?? ''} anchor=${data.anchor ?? ''} head=${data.head ?? ''}`;
  } else if (eventName === 'cursor.move.vertical.boundary') {
    details = ` trigger=${data.trigger ?? ''} from=${data.from ?? ''} line=${data.fromLine ?? ''}`;
  } else if (eventName === 'cursor.move.vertical.corrected-assoc') {
    details = ` trigger=${data.trigger ?? ''} pos=${data.targetPos ?? ''} assoc=${data.previousAssoc ?? ''}->${data.nextAssoc ?? ''}`;
  } else if (eventName === 'cursor.active-line.missing') {
    details = ` reason=${data.reason ?? ''} head=${data.selectionHead ?? ''} line=${data.selectionLineNumber ?? ''} lineLen=${data.selectionLineLength ?? ''}`;
  } else if (eventName === 'cursor.visibility.defer-transient-drift') {
    details = ` reason=${data.reason ?? ''} head=${data.selectionHead ?? ''} line=${data.selectionLineNumber ?? ''} lineLen=${data.selectionLineLength ?? ''}`;
  } else if (eventName === 'cursor.recover.dispatch') {
    details = ` reason=${data.reason ?? ''} step=${data.step ?? ''} assoc=${data.assoc ?? ''} head=${data.selectionHead ?? ''}`;
  } else if (eventName === 'cursor.recover.failed') {
    details = ` reason=${data.reason ?? ''} step=${data.step ?? ''} head=${data.selectionHead ?? ''} msg=${data.message ?? ''}`;
  } else if (eventName === 'dom.selectionchange') {
    details = ` head=${data.selectionHead ?? ''} focused=${String(Boolean(data.viewHasFocus))}`;
  } else if (eventName === 'cursor.visibility.probe') {
    details = ` reason=${data.reason ?? ''} focus=${String(Boolean(data.hasFocus))} suspect=${String(Boolean(data.suspectCursorVisibility))} head=${data.selectionHead ?? ''} lineLen=${data.selectionLineLength ?? ''} h=${data.cursorState?.cursorHeight ?? ''} lh=${data.cursorState?.lineHeight ?? ''} lhSrc=${data.cursorState?.lineHeightSource ?? ''} rightEdge=${String(Boolean(data.cursorState?.nearRightEdge))} farRight=${String(Boolean(data.cursorState?.farRightFromScroller))} cLeft=${data.cursorState?.cursorLeft ?? ''} posLeft=${data.cursorState?.headCoordsLeft ?? ''}`;
  } else if (eventName === 'cursor.visibility.suspect') {
    details = ` reason=${data.reason ?? ''} focus=${String(Boolean(data.hasFocus))} head=${data.selectionHead ?? ''}`;
  } else if (eventName === 'gutter.visibility.probe') {
    details = ` reason=${data.reason ?? ''} display=${data.gutterState?.display ?? ''} visible=${data.gutterState?.visibleLineNumberCount ?? ''}/${data.gutterState?.totalLineNumberCount ?? ''} width=${data.gutterState?.width ?? ''}`;
  } else if (eventName === 'gutter.visibility.hidden') {
    details = ` reason=${data.reason ?? ''} display=${data.gutterState?.display ?? ''} visible=${data.gutterState?.visibleLineNumberCount ?? ''}/${data.gutterState?.totalLineNumberCount ?? ''}`;
  } else if (eventName === 'gutter.visibility.unexpected') {
    details = ` reason=${data.reason ?? ''} display=${data.gutterState?.display ?? ''} visible=${data.gutterState?.visibleLineNumberCount ?? ''}/${data.gutterState?.totalLineNumberCount ?? ''}`;
  } else if (eventName === 'snapshot.editor') {
    details = ` reason=${data.reason ?? ''} sel=${data.selectionHead ?? ''} line=${data.selectionLineNumber ?? ''} recentKey=${data.recentInputKey ?? ''}`;
  } else if (eventName === 'live.mode.architecture') {
    details = ` sourceFirst=${String(Boolean(data.sourceFirst))} queryOverride=${data.queryOverride ?? ''} storedOverride=${data.storedOverride ?? ''}`;
  } else if (eventName === 'decorations.source-first-pass-through') {
    details = ` line=${data.activeLineNumber ?? ''} lineLen=${data.activeLineLength ?? ''} blocks=${data.blockCount ?? ''}`;
  } else if (eventName === 'decorations.source-first-built') {
    details = ` line=${data.activeLineNumber ?? ''} lineLen=${data.activeLineLength ?? ''} blocks=${data.blockCount ?? ''} lineDecos=${data.lineDecorationCount ?? ''} tokenDecos=${data.tokenDecorationCount ?? ''} fenceLines=${data.fenceLineCount ?? ''} fenceMarkers=${data.fenceMarkerLineCount ?? ''}`;
  } else if (eventName === 'block.index.rebuilt') {
    details = ` reason=${data.reason ?? ''} blocks=${data.blockCount ?? ''} index=${data.indexCount ?? ''}`;
  } else if (eventName === 'block.index.delta') {
    details = ` prev=${data.previousCount ?? ''} next=${data.nextCount ?? ''} added=${data.addedCount ?? ''} removed=${data.removedCount ?? ''}`;
  } else if (eventName === 'fence.visibility.state') {
    details = ` reason=${data.reason ?? ''} head=${data.selectionHead ?? ''} inside=${String(Boolean(data.insideFence))} line=${data.activeLineNumber ?? ''} block=${data.blockFrom ?? ''}-${data.blockTo ?? ''} fence=${data.openingFenceLineNumber ?? ''}-${data.closingFenceLineNumber ?? ''} type=${data.indexedBlockType ?? ''}`;
  } else if (eventName === 'pointer.map.native') {
    details = ` trigger=${data.trigger ?? ''} mapped=${data.mappedPosition ?? ''} raw=${data.rawMappedPosition ?? ''} line=${data.lineInfo?.lineNumber ?? ''} col=${data.lineInfo?.column ?? ''} block=${data.blockFrom ?? ''}-${data.blockTo ?? ''} target=${data.targetTagName ?? ''}`;
  } else if (eventName === 'pointer.map.clamped') {
    details = ` trigger=${data.trigger ?? ''} raw=${data.rawMappedPosition ?? ''} mapped=${data.mappedPosition ?? ''} docLen=${data.docLength ?? ''} target=${data.targetTagName ?? ''}`;
  } else if (eventName === 'markdown.engine.config') {
    details = ` breaks=${String(Boolean(data.breaks))} html=${String(Boolean(data.html))} linkify=${String(Boolean(data.linkify))}`;
  }

  return `${at} ${eventName} session=${session} mode=${viewMode} path=${currentPath}${details}`.trim();
}

async function main() {
  let logFilePath = null;

  if (explicitFileArg) {
    logFilePath = path.isAbsolute(explicitFileArg)
      ? explicitFileArg
      : path.join(projectRoot, explicitFileArg);
  } else {
    try {
      logFilePath = await findLatestLogFile();
    } catch (error) {
      console.error('Could not read logs directory:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  }

  if (!logFilePath) {
    console.log('No live debug logs found in logs/. Start the app with: npm run launch');
    return;
  }

  const content = await readFile(logFilePath, 'utf8');
  const records = parseJsonLines(content);

  console.log(`Live debug log: ${logFilePath}`);
  console.log(`Total records: ${records.length}`);

  const byEvent = summarize(records);
  if (byEvent.length > 0) {
    console.log('Top events:');
    for (const [name, count] of byEvent) {
      console.log(`- ${name}: ${count}`);
    }
  }

  const anomalies = summarizeAnomalies(records);
  console.log('Anomalies:');
  console.log(`- selection.jump.detected: ${anomalies.selectionJumpDetected}`);
  console.log(`- selection.jump.suppressed: ${anomalies.selectionJumpSuppressed}`);
  console.log(`- decorations.slow: ${anomalies.slowDecorations}`);
  console.log(`- perf.longtask: ${anomalies.longTasks}`);
  console.log(`- block.activate.rendered-block-unbounded: ${anomalies.renderedBlockUnbounded}`);
  console.log(`- block.activate.rendered-source-pos-outside-block: ${anomalies.renderedSourcePosOutsideBlock}`);
  console.log(`- block.activate.rendered-rebound-source-pos-block: ${anomalies.renderedReboundSourcePosBlock}`);
  console.log(`- block.activate.rendered-dom-anchor-sticky: ${anomalies.renderedDomAnchorSticky}`);
  console.log(`- block.activate.rendered-source-range: ${anomalies.renderedSourceRange}`);
  console.log(`- block.activate.rendered-fenced-source-sticky: ${anomalies.renderedFencedSourceSticky}`);
  console.log(`- block.activate.rendered-boundary-source-sticky: ${anomalies.renderedBoundarySourceSticky}`);
  console.log(`- block.activate.rendered-boundary-crossing: ${anomalies.renderedBoundaryCrossing}`);
  console.log(`- block.activate.rendered-pointer-probe: ${anomalies.renderedPointerProbe}`);
  console.log(`- block.activate.line-source-clamped: ${anomalies.lineSourceClamped}`);
  console.log(`- block.activate.pass-through-native: ${anomalies.passThroughNative}`);
  console.log(`- block.position.mapped.skipped: ${anomalies.blockPositionMappedSkipped}`);
  console.log(`- block.position.mapped.large-delta: ${anomalies.blockPositionMappedLargeDelta}`);
  console.log(`- block.position.mapped.rejected-large-delta: ${anomalies.blockPositionMappedRejectedLargeDelta}`);
  console.log(`- block.activate.fallback (remap=false): ${anomalies.blockFallbackRemapDisabled}`);
  console.log(`- decorations.block.skipped-empty-active-line: ${anomalies.skippedEmptyActiveLineBlocks}`);
  console.log(`- decorations.block.skipped-empty-line-boundary: ${anomalies.skippedEmptyLineBoundaryBlocks}`);
  console.log(`- decorations.block.skipped-active-fenced-code: ${anomalies.skippedActiveFencedCodeBlocks}`);
  console.log(`- decorations.block.trailing-boundary-fenced-code-render: ${anomalies.renderedFencedCodeTrailingBoundaryBlocks}`);
  console.log(`- input.keydown.vertical-intercept.applied: ${anomalies.verticalInterceptApplied}`);
  console.log(`- input.keydown.vertical-intercept (handled=false): ${anomalies.verticalInterceptMissed}`);
  console.log(`- cursor.move.vertical: ${anomalies.cursorVerticalMoves}`);
  console.log(`- cursor.move.vertical.skipped: ${anomalies.cursorVerticalSkips}`);
  console.log(`- cursor.move.vertical.boundary: ${anomalies.cursorVerticalBoundary}`);
  console.log(`- cursor.move.vertical.corrected-assoc: ${anomalies.cursorVerticalAssocCorrections}`);
  console.log(`- cursor.active-line.missing: ${anomalies.cursorActiveLineMissing}`);
  console.log(`- cursor.visibility.defer-transient-drift: ${anomalies.cursorVisibilityTransientDeferred}`);
  console.log(`- cursor.recover.dispatch: ${anomalies.cursorRecoverDispatch}`);
  console.log(`- cursor.recover.failed: ${anomalies.cursorRecoverFailed}`);
  console.log(`- dom.selectionchange: ${anomalies.domSelectionchange}`);
  console.log(`- cursor.visibility.probe: ${anomalies.cursorVisibilityProbe}`);
  console.log(`- cursor.visibility.suspect: ${anomalies.cursorVisibilitySuspect}`);
  console.log(`- max cursor height: ${anomalies.maxCursorHeight}`);
  console.log(`- max cursor width: ${anomalies.maxCursorWidth}`);
  console.log(`- gutter.visibility.probe: ${anomalies.gutterVisibilityProbe}`);
  console.log(`- gutter.visibility.hidden: ${anomalies.gutterVisibilityHidden}`);
  console.log(`- gutter.visibility.unexpected: ${anomalies.gutterVisibilityUnexpected}`);
  console.log(`- max visible gutter line numbers: ${anomalies.maxVisibleGutterLineNumbers}`);
  console.log(`- max selection position delta: ${anomalies.maxSelectionPositionDelta}`);
  console.log(`- max selection line delta: ${anomalies.maxSelectionLineDelta}`);
  console.log(`- markdown.engine.config: ${anomalies.markdownConfigEvents}`);
  console.log(`- markdown.engine.config (breaks=true): ${anomalies.markdownBreaksEnabledEvents}`);
  console.log(`- markdown.engine.config (breaks=false): ${anomalies.markdownBreaksDisabledEvents}`);
  console.log(`- markdown breaks currently enabled: ${String(anomalies.lastMarkdownBreaksEnabled)}`);
  console.log(`- decorations.source-first-pass-through: ${anomalies.sourceFirstDecorationPassThrough}`);
  console.log(`- decorations.source-first-built: ${anomalies.sourceFirstDecorationBuilt}`);
  console.log(`- block.index.rebuilt: ${anomalies.blockIndexRebuilt}`);
  console.log(`- block.index.delta: ${anomalies.blockIndexDelta}`);
  console.log(`- fence.visibility.state: ${anomalies.fenceVisibilityState}`);
  console.log(`- fence.visibility.state (insideFence=true): ${anomalies.fenceInsideCount}`);
  console.log(`- pointer.map.native: ${anomalies.pointerMapNative}`);
  console.log(`- pointer.map.clamped: ${anomalies.pointerMapClamped}`);

  const tail = records.slice(-maxLines);
  console.log(`Last ${tail.length} records:`);
  for (const record of tail) {
    console.log(formatRecord(record));
  }
}

main().catch((error) => {
  console.error('Failed to generate live debug report:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
