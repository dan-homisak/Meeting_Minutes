import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {
  findLatestLogFile,
  parseJsonLines,
  readEventData,
  readEventName
} from './live-debug-log-utils.mjs';

const projectRoot = process.cwd();
const logsDir = path.join(projectRoot, 'logs');

function parseCliArguments(argv) {
  let explicitFileArg = null;
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--') && !explicitFileArg) {
      explicitFileArg = arg;
    }
  }
  return {
    explicitFileArg
  };
}

function toNumber(value) {
  return Number.isFinite(value) ? Number(value) : null;
}

function summarize(records) {
  const counters = new Map();
  const activeBlockLengths = [];
  const lineHeights = [];
  const cursorHeights = [];
  const selectionDeltas = {
    maxPositionDelta: 0,
    maxLineDelta: 0
  };
  const gutterDisplays = new Map();

  for (const record of records) {
    const eventName = readEventName(record);
    counters.set(eventName, (counters.get(eventName) ?? 0) + 1);

    const data = readEventData(record);
    if (eventName === 'live-v4.active-block.large' && Number.isFinite(data.activeBlockLength)) {
      activeBlockLengths.push(data.activeBlockLength);
    }

    if (eventName === 'live-v4.layout.metrics') {
      const lineHeight = Number.parseFloat(data.lineHeightPx);
      const cursorHeight = Number.parseFloat(data.cursorHeightPx);
      if (Number.isFinite(lineHeight)) {
        lineHeights.push(lineHeight);
      }
      if (Number.isFinite(cursorHeight)) {
        cursorHeights.push(cursorHeight);
      }
    }

    if (eventName === 'selection.changed') {
      if (Number.isFinite(data.positionDelta)) {
        selectionDeltas.maxPositionDelta = Math.max(selectionDeltas.maxPositionDelta, data.positionDelta);
      }
      if (Number.isFinite(data.lineDelta)) {
        selectionDeltas.maxLineDelta = Math.max(selectionDeltas.maxLineDelta, data.lineDelta);
      }
    }

    if (eventName === 'gutter.visibility.probe') {
      const display = data.gutterState?.display ?? 'unknown';
      gutterDisplays.set(display, (gutterDisplays.get(display) ?? 0) + 1);
    }
  }

  return {
    counters,
    activeBlockLengths,
    lineHeights,
    cursorHeights,
    selectionDeltas,
    gutterDisplays
  };
}

function minMax(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return {
      min: null,
      max: null
    };
  }
  return {
    min: Math.min(...values),
    max: Math.max(...values)
  };
}

async function main() {
  const { explicitFileArg } = parseCliArguments(process.argv);
  const logFilePath = explicitFileArg
    ? (path.isAbsolute(explicitFileArg)
      ? explicitFileArg
      : path.join(projectRoot, explicitFileArg))
    : await findLatestLogFile(logsDir);

  if (!logFilePath) {
    console.log('No live debug logs found in logs/. Start the app with: npm run launch');
    return;
  }

  const content = await readFile(logFilePath, 'utf8');
  const records = parseJsonLines(content);
  const summary = summarize(records);

  const readCount = (name) => summary.counters.get(name) ?? 0;

  console.log(`Live-v4 troubleshoot log: ${logFilePath}`);
  console.log(`Total records: ${records.length}`);
  console.log('Key counts:');
  console.log(`- input.pointer.root: ${readCount('input.pointer.root')}`);
  console.log(`- pointer.map.fragment: ${readCount('pointer.map.fragment')}`);
  console.log(`- pointer.map.fragment-miss: ${readCount('pointer.map.fragment-miss')}`);
  console.log(`- pointer.map.native: ${readCount('pointer.map.native')}`);
  console.log(`- pointer.map.clamped: ${readCount('pointer.map.clamped')}`);
  console.log(`- block.activate.miss: ${readCount('block.activate.miss')}`);
  console.log(`- live-v4.pointer.activate: ${readCount('live-v4.pointer.activate')}`);
  console.log(`- live-v4.active-block.large: ${readCount('live-v4.active-block.large')}`);
  console.log(`- cursor.move.vertical: ${readCount('cursor.move.vertical')}`);
  console.log(`- cursor.move.vertical.skipped: ${readCount('cursor.move.vertical.skipped')}`);
  console.log(`- cursor.move.vertical.boundary: ${readCount('cursor.move.vertical.boundary')}`);

  const lineHeightRange = minMax(summary.lineHeights);
  const cursorHeightRange = minMax(summary.cursorHeights);
  const activeBlockRange = minMax(summary.activeBlockLengths);

  console.log('Geometry ranges:');
  console.log(`- lineHeightPx min/max: ${toNumber(lineHeightRange.min) ?? 'n/a'} / ${toNumber(lineHeightRange.max) ?? 'n/a'}`);
  console.log(`- cursorHeightPx min/max: ${toNumber(cursorHeightRange.min) ?? 'n/a'} / ${toNumber(cursorHeightRange.max) ?? 'n/a'}`);
  console.log(`- activeBlockLength min/max: ${toNumber(activeBlockRange.min) ?? 'n/a'} / ${toNumber(activeBlockRange.max) ?? 'n/a'}`);

  console.log('Selection deltas:');
  console.log(`- max position delta: ${summary.selectionDeltas.maxPositionDelta}`);
  console.log(`- max line delta: ${summary.selectionDeltas.maxLineDelta}`);

  console.log('Gutter display states:');
  if (summary.gutterDisplays.size === 0) {
    console.log('- none');
  } else {
    for (const [display, count] of summary.gutterDisplays.entries()) {
      console.log(`- ${display}: ${count}`);
    }
  }
}

main().catch((error) => {
  console.error('Failed to run live-v4 troubleshoot:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
