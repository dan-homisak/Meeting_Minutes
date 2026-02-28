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

function readEventName(record) {
  if (typeof record?.entry?.event === 'string') {
    return record.entry.event;
  }
  if (typeof record?.event === 'string') {
    return record.event;
  }
  return 'unknown';
}

function readEventData(record) {
  if (record && typeof record === 'object' && record.entry && typeof record.entry.data === 'object') {
    return record.entry.data;
  }
  return {};
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

function summarizeTopEvents(records) {
  const counts = new Map();
  for (const record of records) {
    const eventName = readEventName(record);
    counts.set(eventName, (counts.get(eventName) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
}

function isInitialPointerSelectionJump(data) {
  if (!data || typeof data !== 'object') {
    return false;
  }

  return (
    data.recentInputKind === 'pointer' &&
    Number.isFinite(data.previousHead) &&
    data.previousHead === 0 &&
    Number.isFinite(data.previousLineNumber) &&
    data.previousLineNumber === 1 &&
    Number.isFinite(data.currentHead) &&
    data.currentHead > 0
  );
}

function summarizeAnomalies(records) {
  const summary = {
    selectionJumpDetected: 0,
    selectionJumpIgnoredInitialPointer: 0,
    selectionJumpSuppressed: 0,
    slowDecorations: 0,
    longTasks: 0,
    blockActivateMiss: 0,
    verticalInterceptApplied: 0,
    verticalInterceptMissed: 0,
    cursorVerticalMoves: 0,
    cursorVerticalSkips: 0,
    cursorVerticalBoundary: 0,
    cursorVerticalSourceMapClamped: 0,
    cursorVerticalAssocCorrections: 0,
    cursorActiveLineMissing: 0,
    cursorVisibilityTransientDeferred: 0,
    cursorRecoverDispatch: 0,
    cursorRecoverFailed: 0,
    domSelectionchange: 0,
    cursorVisibilityProbe: 0,
    cursorVisibilitySuspect: 0,
    maxCursorHeight: 0,
    maxCursorWidth: 0,
    gutterVisibilityProbe: 0,
    gutterVisibilityHidden: 0,
    maxVisibleGutterLineNumbers: 0,
    maxSelectionPositionDelta: 0,
    maxSelectionLineDelta: 0,
    markdownConfigEvents: 0,
    markdownBreaksEnabledEvents: 0,
    markdownBreaksDisabledEvents: 0,
    lastMarkdownBreaksEnabled: null,
    sourceFirstDecorationBuilt: 0,
    blockIndexRebuilt: 0,
    blockIndexDelta: 0,
    fenceVisibilityState: 0,
    fenceInsideCount: 0,
    inputPointerRoot: 0,
    inputPointer: 0,
    pointerMapNative: 0,
    pointerMapClamped: 0
  };

  for (const record of records) {
    const eventName = readEventName(record);
    const data = readEventData(record);

    if (eventName === 'selection.jump.detected') {
      if (isInitialPointerSelectionJump(data)) {
        summary.selectionJumpIgnoredInitialPointer += 1;
      } else {
        summary.selectionJumpDetected += 1;
      }
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

    if (eventName === 'block.activate.miss') {
      summary.blockActivateMiss += 1;
    }

    if (eventName === 'input.keydown.vertical-intercept.applied') {
      summary.verticalInterceptApplied += 1;
    }

    if (eventName === 'input.keydown.vertical-intercept' && !data.handled) {
      summary.verticalInterceptMissed += 1;
    }

    if (eventName === 'cursor.move.vertical') {
      summary.cursorVerticalMoves += 1;
    }

    if (eventName === 'cursor.move.vertical.skipped') {
      summary.cursorVerticalSkips += 1;
    }

    if (eventName === 'cursor.move.vertical.boundary') {
      summary.cursorVerticalBoundary += 1;
    }

    if (eventName === 'cursor.move.vertical.source-map-clamped') {
      summary.cursorVerticalSourceMapClamped += 1;
    }

    if (eventName === 'cursor.move.vertical.corrected-assoc') {
      summary.cursorVerticalAssocCorrections += 1;
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

    if (eventName === 'dom.selectionchange') {
      summary.domSelectionchange += 1;
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

    if (eventName === 'cursor.visibility.suspect') {
      summary.cursorVisibilitySuspect += 1;
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

    if (eventName === 'input.pointer.root') {
      summary.inputPointerRoot += 1;
    }

    if (eventName === 'input.pointer') {
      summary.inputPointer += 1;
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
  const eventName = readEventName(record);
  const session = record?.sessionId ?? 'n/a';
  const viewMode = record?.viewMode ?? '';
  const currentPath = record?.currentPath ?? '';
  const data = readEventData(record);

  let details = '';
  if (eventName === 'selection.changed') {
    details = ` head=${data.head ?? ''} prev=${data.previousHead ?? ''} dPos=${data.positionDelta ?? ''} dLine=${data.lineDelta ?? ''} input=${data.recentInputKey ?? data.recentInputKind ?? ''}`;
  } else if (eventName === 'selection.jump.detected') {
    details = ` prev=${data.previousHead ?? ''} next=${data.currentHead ?? ''} dPos=${data.positionDelta ?? ''} dLine=${data.lineDelta ?? ''} input=${data.recentInputKey ?? data.recentInputKind ?? ''}`;
  } else if (eventName === 'selection.jump.suppressed') {
    details = ` prev=${data.previousHead ?? ''} next=${data.currentHead ?? ''} dPos=${data.positionDelta ?? ''} dLine=${data.lineDelta ?? ''} docChanged=${String(Boolean(data.docChanged))} loading=${String(Boolean(data.appIsLoadingFile))}`;
  } else if (eventName === 'input.pointer.root') {
    details = ` target=${data.target?.tagName ?? ''} sourceFrom=${data.target?.sourceFrom ?? ''}`;
  } else if (eventName === 'input.pointer') {
    details = ` trigger=${data.trigger ?? ''} x=${data.x ?? ''} y=${data.y ?? ''} target=${data.target?.tagName ?? ''}`;
  } else if (eventName === 'block.activate.miss') {
    details = ` trigger=${data.trigger ?? ''} reason=${data.reason ?? ''}`;
  } else if (eventName === 'input.keydown.root') {
    details = ` key=${data.key ?? ''} head=${data.selectionHead ?? ''} mode=${data.mode ?? ''}`;
  } else if (eventName === 'input.keydown.vertical-intercept') {
    details = ` key=${data.key ?? ''} handled=${String(Boolean(data.handled))} before=${data.beforeHead ?? ''} after=${data.afterHead ?? ''}`;
  } else if (eventName === 'input.keydown.vertical-intercept.applied') {
    details = ` key=${data.key ?? ''} after=${data.afterHead ?? ''}`;
  } else if (eventName === 'cursor.move.vertical') {
    details = ` trigger=${data.trigger ?? ''} from=${data.from ?? ''} to=${data.to ?? ''} lines=${data.fromLine ?? ''}->${data.toLine ?? ''}`;
  } else if (eventName === 'cursor.move.vertical.source-map-clamped') {
    details = ` trigger=${data.trigger ?? ''} from=${data.from ?? ''} raw=${data.rawTargetPos ?? ''} to=${data.targetPos ?? ''} block=${data.sourceMapTargetFrom ?? ''}-${data.sourceMapTargetTo ?? ''}`;
  } else if (eventName === 'cursor.move.vertical.skipped') {
    details = ` trigger=${data.trigger ?? ''} reason=${data.reason ?? ''} anchor=${data.anchor ?? ''} head=${data.head ?? ''}`;
  } else if (eventName === 'cursor.move.vertical.boundary') {
    details = ` trigger=${data.trigger ?? ''} from=${data.from ?? ''} line=${data.fromLine ?? ''}`;
  } else if (eventName === 'cursor.move.vertical.corrected-assoc') {
    details = ` trigger=${data.trigger ?? ''} pos=${data.targetPos ?? ''} assoc=${data.previousAssoc ?? ''}->${data.nextAssoc ?? ''}`;
  } else if (eventName === 'cursor.active-line.missing') {
    details = ` reason=${data.reason ?? ''} head=${data.selectionHead ?? ''} line=${data.selectionLineNumber ?? ''} lineLen=${data.selectionLineLength ?? ''}`;
  } else if (eventName === 'cursor.visibility.defer-transient-drift') {
    details = ` reason=${data.reason ?? ''} head=${data.selectionHead ?? ''}`;
  } else if (eventName === 'cursor.recover.dispatch') {
    details = ` reason=${data.reason ?? ''} step=${data.step ?? ''} assoc=${data.assoc ?? ''} head=${data.selectionHead ?? ''}`;
  } else if (eventName === 'cursor.recover.failed') {
    details = ` reason=${data.reason ?? ''} step=${data.step ?? ''} head=${data.selectionHead ?? ''} msg=${data.message ?? ''}`;
  } else if (eventName === 'dom.selectionchange') {
    details = ` head=${data.selectionHead ?? ''} focused=${String(Boolean(data.viewHasFocus))}`;
  } else if (eventName === 'cursor.visibility.probe') {
    details = ` reason=${data.reason ?? ''} focus=${String(Boolean(data.hasFocus))} suspect=${String(Boolean(data.suspectCursorVisibility))} head=${data.selectionHead ?? ''} lineLen=${data.selectionLineLength ?? ''}`;
  } else if (eventName === 'cursor.visibility.suspect') {
    details = ` reason=${data.reason ?? ''} head=${data.selectionHead ?? ''}`;
  } else if (eventName === 'gutter.visibility.probe') {
    details = ` reason=${data.reason ?? ''} display=${data.gutterState?.display ?? ''} visible=${data.gutterState?.visibleLineNumberCount ?? ''}/${data.gutterState?.totalLineNumberCount ?? ''}`;
  } else if (eventName === 'gutter.visibility.hidden') {
    details = ` reason=${data.reason ?? ''} display=${data.gutterState?.display ?? ''}`;
  } else if (eventName === 'snapshot.editor') {
    details = ` reason=${data.reason ?? ''} sel=${data.selectionHead ?? ''} line=${data.selectionLineNumber ?? ''}`;
  } else if (eventName === 'live.mode.architecture') {
    details = ` sourceFirst=${String(Boolean(data.sourceFirst))} queryOverride=${data.queryOverride ?? ''} storedOverride=${data.storedOverride ?? ''}`;
  } else if (eventName === 'decorations.source-first-built') {
    details = ` line=${data.activeLineNumber ?? ''} lineLen=${data.activeLineLength ?? ''} blocks=${data.blockCount ?? ''} lineDecos=${data.lineDecorationCount ?? ''} tokenDecos=${data.tokenDecorationCount ?? ''}`;
  } else if (eventName === 'block.index.rebuilt') {
    details = ` reason=${data.reason ?? ''} blocks=${data.blockCount ?? ''} index=${data.indexCount ?? ''}`;
  } else if (eventName === 'block.index.delta') {
    details = ` prev=${data.previousCount ?? ''} next=${data.nextCount ?? ''} added=${data.addedCount ?? ''} removed=${data.removedCount ?? ''}`;
  } else if (eventName === 'fence.visibility.state') {
    details = ` reason=${data.reason ?? ''} head=${data.selectionHead ?? ''} inside=${String(Boolean(data.insideFence))} line=${data.activeLineNumber ?? ''} block=${data.blockFrom ?? ''}-${data.blockTo ?? ''}`;
  } else if (eventName === 'pointer.map.native') {
    details = ` trigger=${data.trigger ?? ''} mapped=${data.mappedPosition ?? ''} raw=${data.rawMappedPosition ?? ''} line=${data.lineInfo?.lineNumber ?? ''} block=${data.blockFrom ?? ''}-${data.blockTo ?? ''} target=${data.targetTagName ?? ''}`;
  } else if (eventName === 'pointer.map.clamped') {
    details = ` trigger=${data.trigger ?? ''} raw=${data.rawMappedPosition ?? ''} mapped=${data.mappedPosition ?? ''} docLen=${data.docLength ?? ''}`;
  } else if (eventName === 'markdown.engine.config') {
    details = ` breaks=${String(Boolean(data.breaks))} html=${String(Boolean(data.html))} linkify=${String(Boolean(data.linkify))}`;
  } else if (eventName === 'plugin.update') {
    details = ` docChanged=${String(Boolean(data.docChanged))} selectionSet=${String(Boolean(data.selectionSet))} refresh=${String(Boolean(data.refreshRequested))}`;
  } else if (eventName === 'refresh.requested') {
    details = ` reason=${data.reason ?? ''} mode=${data.mode ?? ''}`;
  } else if (eventName === 'blocks.collected') {
    details = ` blocks=${data.blockCount ?? ''} parser=${data.strategy ?? ''} elapsedMs=${data.elapsedMs ?? ''}`;
  } else if (eventName === 'document.changed') {
    details = ` mode=${data.mode ?? ''} length=${data.length ?? ''}`;
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

  const topEvents = summarizeTopEvents(records);
  if (topEvents.length > 0) {
    console.log('Top events:');
    for (const [eventName, count] of topEvents) {
      console.log(`- ${eventName}: ${count}`);
    }
  }

  const anomalies = summarizeAnomalies(records);
  console.log('Anomalies:');
  console.log(`- selection.jump.detected: ${anomalies.selectionJumpDetected}`);
  console.log(
    `- selection.jump.detected (ignored initial pointer jump): ${anomalies.selectionJumpIgnoredInitialPointer}`
  );
  console.log(`- selection.jump.suppressed: ${anomalies.selectionJumpSuppressed}`);
  console.log(`- decorations.slow: ${anomalies.slowDecorations}`);
  console.log(`- perf.longtask: ${anomalies.longTasks}`);
  console.log(`- block.activate.miss: ${anomalies.blockActivateMiss}`);
  console.log(`- input.keydown.vertical-intercept.applied: ${anomalies.verticalInterceptApplied}`);
  console.log(`- input.keydown.vertical-intercept (handled=false): ${anomalies.verticalInterceptMissed}`);
  console.log(`- cursor.move.vertical: ${anomalies.cursorVerticalMoves}`);
  console.log(`- cursor.move.vertical.skipped: ${anomalies.cursorVerticalSkips}`);
  console.log(`- cursor.move.vertical.boundary: ${anomalies.cursorVerticalBoundary}`);
  console.log(`- cursor.move.vertical.source-map-clamped: ${anomalies.cursorVerticalSourceMapClamped}`);
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
  console.log(`- max visible gutter line numbers: ${anomalies.maxVisibleGutterLineNumbers}`);
  console.log(`- max selection position delta: ${anomalies.maxSelectionPositionDelta}`);
  console.log(`- max selection line delta: ${anomalies.maxSelectionLineDelta}`);
  console.log(`- markdown.engine.config: ${anomalies.markdownConfigEvents}`);
  console.log(`- markdown.engine.config (breaks=true): ${anomalies.markdownBreaksEnabledEvents}`);
  console.log(`- markdown.engine.config (breaks=false): ${anomalies.markdownBreaksDisabledEvents}`);
  console.log(`- markdown breaks currently enabled: ${String(anomalies.lastMarkdownBreaksEnabled)}`);
  console.log(`- decorations.source-first-built: ${anomalies.sourceFirstDecorationBuilt}`);
  console.log(`- block.index.rebuilt: ${anomalies.blockIndexRebuilt}`);
  console.log(`- block.index.delta: ${anomalies.blockIndexDelta}`);
  console.log(`- fence.visibility.state: ${anomalies.fenceVisibilityState}`);
  console.log(`- fence.visibility.state (insideFence=true): ${anomalies.fenceInsideCount}`);
  console.log(`- input.pointer.root: ${anomalies.inputPointerRoot}`);
  console.log(`- input.pointer: ${anomalies.inputPointer}`);
  console.log(`- pointer.map.native: ${anomalies.pointerMapNative}`);
  console.log(`- pointer.map.clamped: ${anomalies.pointerMapClamped}`);

  const tail = records.slice(-maxLines);
  console.log(`Last ${tail.length} records:`);
  for (const record of tail) {
    console.log(formatRecord(record));
  }
}

main().catch((error) => {
  console.error('Failed to summarize live debug logs:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
