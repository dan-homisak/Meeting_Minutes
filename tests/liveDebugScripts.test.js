import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const verifyScriptPath = fileURLToPath(
  new URL('../scripts/live-debug-verify.mjs', import.meta.url)
);
const reportScriptPath = fileURLToPath(
  new URL('../scripts/live-debug-report.mjs', import.meta.url)
);

function runScript(scriptPath, args = []) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: 'utf8'
  });
}

async function withTempLog(records, run) {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'meeting-minutes-live-debug-'));
  const logPath = path.join(tempDir, 'live-debug-fixture.jsonl');

  try {
    const lines = records.map((record) => JSON.stringify(record));
    await writeFile(logPath, `${lines.join('\n')}\n`, 'utf8');
    await run(logPath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function initialPointerJumpRecord() {
  return {
    entry: {
      event: 'selection.jump.detected',
      data: {
        previousHead: 0,
        currentHead: 128,
        previousLineNumber: 1,
        recentInputKind: 'pointer'
      }
    }
  };
}

test('live-debug-verify ignores initial pointer selection jump from document start', async () => {
  await withTempLog(
    [
      initialPointerJumpRecord(),
      {
        entry: {
          event: 'pointer.map.native',
          data: {
            trigger: 'mousedown'
          }
        }
      }
    ],
    async (logPath) => {
      const result = runScript(verifyScriptPath, [logPath]);
      assert.equal(result.status, 0);
      assert.match(result.stdout, /selection\.jump\.detected: 0/);
      assert.match(
        result.stdout,
        /selection\.jump\.detected \(ignored initial pointer jump\): 1/
      );
      assert.match(result.stdout, /plugin\.update\.selection-skipped \(line mismatch\): 0/);
      assert.match(result.stdout, /Verification passed\./);
    }
  );
});

test('live-debug-verify fails when selection jump is not the initial pointer baseline jump', async () => {
  await withTempLog(
    [
      {
        entry: {
          event: 'selection.jump.detected',
          data: {
            previousHead: 17,
            currentHead: 200,
            previousLineNumber: 3,
            recentInputKind: 'pointer'
          }
        }
      },
      {
        entry: {
          event: 'pointer.map.native',
          data: {
            trigger: 'mousedown'
          }
        }
      }
    ],
    async (logPath) => {
      const result = runScript(verifyScriptPath, [logPath]);
      assert.equal(result.status, 1);
      assert.match(
        result.stderr,
        /selection\.jump\.detected \(1\) > max \(0\)/
      );
    }
  );
});

test('live-debug-report summarizes hybrid anomalies and omits removed rendered-era counters', async () => {
  await withTempLog(
    [
      initialPointerJumpRecord(),
      {
        entry: {
          event: 'block.activate.miss',
          data: {
            trigger: 'mousedown',
            reason: 'no-element-target'
          }
        }
      },
      {
        entry: {
          event: 'pointer.map.native',
          data: {
            trigger: 'mousedown'
          }
        }
      },
      {
        entry: {
          event: 'fence.visibility.state',
          data: {
            insideFence: true
          }
        }
      }
    ],
    async (logPath) => {
      const result = runScript(reportScriptPath, [logPath, '--last', '2']);
      assert.equal(result.status, 0);
      assert.match(result.stdout, /selection\.jump\.detected: 0/);
      assert.match(
        result.stdout,
        /selection\.jump\.detected \(ignored initial pointer jump\): 1/
      );
      assert.match(result.stdout, /plugin\.update\.selection-skipped: 0/);
      assert.match(result.stdout, /plugin\.update\.selection-skipped \(line mismatch\): 0/);
      assert.match(result.stdout, /block\.activate\.miss: 1/);
      assert.match(result.stdout, /decorations\.hybrid-built: 0/);
      assert.doesNotMatch(result.stdout, /block\.activate\.rendered-block-unbounded/);
    }
  );
});

test('live-debug-verify fails when selection-skipped event reports line mismatch', async () => {
  await withTempLog(
    [
      {
        entry: {
          event: 'plugin.update.selection-skipped',
          data: {
            previousSelectionLineFrom: 120,
            currentSelectionLineFrom: 140
          }
        }
      },
      {
        entry: {
          event: 'pointer.map.native',
          data: {
            trigger: 'mousedown'
          }
        }
      }
    ],
    async (logPath) => {
      const result = runScript(verifyScriptPath, [logPath]);
      assert.equal(result.status, 1);
      assert.match(
        result.stderr,
        /plugin\.update\.selection-skipped line mismatch \(1\) > max \(0\)/
      );
    }
  );
});
