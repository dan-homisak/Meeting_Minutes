import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

async function exists(path) {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

test('live-v3 is the runtime entrypoint and mode controls are removed from shell', async () => {
  const mainPath = join(ROOT, 'src/main.js');
  const htmlPath = join(ROOT, 'index.html');

  const [mainContent, htmlContent] = await Promise.all([
    readFile(mainPath, 'utf8'),
    readFile(htmlPath, 'utf8')
  ]);

  assert.match(mainContent, /createLiveApp/);
  assert.doesNotMatch(mainContent, /createApp\s*\(/);

  assert.doesNotMatch(htmlContent, /id="mode-raw"/);
  assert.doesNotMatch(htmlContent, /id="mode-preview"/);
  assert.doesNotMatch(htmlContent, /id="preview"/);
  assert.match(htmlContent, /Live Preview/);
});

test('legacy mode and preview runtime modules are removed', async () => {
  const modeControllerPath = join(ROOT, 'src/ui/modeController.js');
  const previewRendererPath = join(ROOT, 'src/core/render/PreviewRenderer.js');

  assert.equal(await exists(modeControllerPath), false);
  assert.equal(await exists(previewRendererPath), false);
});
