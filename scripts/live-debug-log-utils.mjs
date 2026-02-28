import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

export function readEventName(record) {
  if (typeof record?.entry?.event === 'string') {
    return record.entry.event;
  }
  if (typeof record?.event === 'string') {
    return record.event;
  }
  return 'unknown';
}

export function readEventData(record) {
  if (record && typeof record === 'object' && record.entry && typeof record.entry.data === 'object') {
    return record.entry.data;
  }
  return {};
}

export function parseJsonLines(content) {
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

export function isInitialPointerSelectionJump(data) {
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

export async function findLatestLogFile(logsDir) {
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
