import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const projectRoot = process.cwd();
const logsDir = path.join(projectRoot, 'logs');

function parseCliArguments(argv) {
  const args = {
    explicitFileArg: null,
    maxSelectionJumps: 0,
    maxCursorSuspects: 0,
    maxGutterHidden: 0,
    maxPointerClamped: 0,
    minPointerNative: 1
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const nextValue = Number(argv[index + 1]);
    if (arg === '--max-selection-jumps' && Number.isInteger(nextValue)) {
      args.maxSelectionJumps = Math.max(0, nextValue);
      index += 1;
      continue;
    }
    if (arg === '--max-cursor-suspects' && Number.isInteger(nextValue)) {
      args.maxCursorSuspects = Math.max(0, nextValue);
      index += 1;
      continue;
    }
    if (arg === '--max-gutter-hidden' && Number.isInteger(nextValue)) {
      args.maxGutterHidden = Math.max(0, nextValue);
      index += 1;
      continue;
    }
    if (arg === '--max-pointer-clamped' && Number.isInteger(nextValue)) {
      args.maxPointerClamped = Math.max(0, nextValue);
      index += 1;
      continue;
    }
    if (arg === '--min-pointer-native' && Number.isInteger(nextValue)) {
      args.minPointerNative = Math.max(0, nextValue);
      index += 1;
      continue;
    }

    if (!arg.startsWith('--') && !args.explicitFileArg) {
      args.explicitFileArg = arg;
    }
  }

  return args;
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

function countKeyEvents(records) {
  const summary = {
    selectionJumpDetected: 0,
    cursorVisibilitySuspect: 0,
    gutterVisibilityHidden: 0,
    pointerMapNative: 0,
    pointerMapClamped: 0,
    fenceVisibilityState: 0,
    fenceInsideCount: 0
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
    if (eventName === 'cursor.visibility.suspect') {
      summary.cursorVisibilitySuspect += 1;
    }
    if (eventName === 'gutter.visibility.hidden') {
      summary.gutterVisibilityHidden += 1;
    }
    if (eventName === 'pointer.map.native') {
      summary.pointerMapNative += 1;
    }
    if (eventName === 'pointer.map.clamped') {
      summary.pointerMapClamped += 1;
    }
    if (eventName === 'fence.visibility.state') {
      summary.fenceVisibilityState += 1;
      if (data.insideFence === true) {
        summary.fenceInsideCount += 1;
      }
    }
  }

  return summary;
}

async function main() {
  const options = parseCliArguments(process.argv);
  const logFilePath = options.explicitFileArg
    ? (path.isAbsolute(options.explicitFileArg)
      ? options.explicitFileArg
      : path.join(projectRoot, options.explicitFileArg))
    : await findLatestLogFile();

  if (!logFilePath) {
    console.error('No live debug log found. Run `npm run launch` and reproduce first.');
    process.exit(1);
  }

  const content = await readFile(logFilePath, 'utf8');
  const records = parseJsonLines(content);
  const summary = countKeyEvents(records);

  console.log(`Live debug verify log: ${logFilePath}`);
  console.log(`Total records: ${records.length}`);
  console.log(`- selection.jump.detected: ${summary.selectionJumpDetected}`);
  console.log(`- cursor.visibility.suspect: ${summary.cursorVisibilitySuspect}`);
  console.log(`- gutter.visibility.hidden: ${summary.gutterVisibilityHidden}`);
  console.log(`- pointer.map.native: ${summary.pointerMapNative}`);
  console.log(`- pointer.map.clamped: ${summary.pointerMapClamped}`);
  console.log(`- fence.visibility.state: ${summary.fenceVisibilityState}`);
  console.log(`- fence.visibility.state (insideFence=true): ${summary.fenceInsideCount}`);

  const failures = [];
  if (summary.selectionJumpDetected > options.maxSelectionJumps) {
    failures.push(
      `selection.jump.detected (${summary.selectionJumpDetected}) > max (${options.maxSelectionJumps})`
    );
  }
  if (summary.cursorVisibilitySuspect > options.maxCursorSuspects) {
    failures.push(
      `cursor.visibility.suspect (${summary.cursorVisibilitySuspect}) > max (${options.maxCursorSuspects})`
    );
  }
  if (summary.gutterVisibilityHidden > options.maxGutterHidden) {
    failures.push(
      `gutter.visibility.hidden (${summary.gutterVisibilityHidden}) > max (${options.maxGutterHidden})`
    );
  }
  if (summary.pointerMapClamped > options.maxPointerClamped) {
    failures.push(
      `pointer.map.clamped (${summary.pointerMapClamped}) > max (${options.maxPointerClamped})`
    );
  }
  if (summary.pointerMapNative < options.minPointerNative) {
    failures.push(
      `pointer.map.native (${summary.pointerMapNative}) < min (${options.minPointerNative})`
    );
  }

  if (failures.length > 0) {
    console.error('Verification failed:');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('Verification passed.');
}

main().catch((error) => {
  console.error('Failed to verify live debug log:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
