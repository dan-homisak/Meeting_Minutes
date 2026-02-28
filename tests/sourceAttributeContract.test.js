import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

function resolvePath(relativePath) {
  return fileURLToPath(new URL(`../${relativePath}`, import.meta.url));
}

test('live preview mapping contract uses data-src-* attributes only', async () => {
  const files = [
    'src/core/render/LiveHybridRenderer.js',
    'src/core/selection/SelectionPolicy.js',
    'src/live/liveDiagnosticsLogHelpers.js'
  ];

  for (const relativePath of files) {
    const content = await readFile(resolvePath(relativePath), 'utf8');
    assert.match(content, /data-src-from/);
    assert.doesNotMatch(content, /data-source-from/);
  }
});
