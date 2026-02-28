import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

test('live-v4 probe runner is wired and probe API is exposed for automation', async () => {
  const packagePath = join(ROOT, 'package.json');
  const createLiveAppPath = join(ROOT, 'src/live-v4/createLiveApp.js');
  const probeRunnerPath = join(ROOT, 'scripts/live-v4-probe-runner.mjs');

  const [packageContent, createLiveAppContent, probeRunnerContent] = await Promise.all([
    readFile(packagePath, 'utf8'),
    readFile(createLiveAppPath, 'utf8'),
    readFile(probeRunnerPath, 'utf8')
  ]);

  const packageJson = JSON.parse(packageContent);
  assert.equal(packageJson.scripts['probe:live-v4'], 'node scripts/live-v4-probe-runner.mjs');

  assert.match(createLiveAppContent, /__MM_LIVE_V4_PROBE__/);
  assert.match(createLiveAppContent, /setCursorByLineColumn/);
  assert.match(createLiveAppContent, /gutterLines/);
  assert.match(probeRunnerContent, /--fixture/);
  assert.match(probeRunnerContent, /click-checkbox/);
  assert.match(probeRunnerContent, /click-source-11-60-right/);
  assert.match(probeRunnerContent, /important-events\.json/);
});
