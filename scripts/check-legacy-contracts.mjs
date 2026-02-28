import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC_ROOT = join(ROOT, 'src');

async function walkFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue;
    }
    const absolutePath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(absolutePath)));
      continue;
    }
    files.push(absolutePath);
  }
  return files;
}

function isCheckedSourceFile(path) {
  const extension = extname(path);
  return extension === '.js' || extension === '.css' || extension === '.html';
}

const forbiddenPatterns = [
  /model\.inline\b/g,
  /data-fragment-from/g,
  /data-source-from/g,
  /\.cm-rendered-block\b/g,
  /BlockRangeCollector/g,
  /livePreviewBridge/g,
  /#mode-raw/g,
  /#mode-preview/g,
  /createPreviewRenderer/g
];

const sourceFiles = (await walkFiles(SRC_ROOT)).filter(isCheckedSourceFile);
const failures = [];

for (const filePath of sourceFiles) {
  const content = await readFile(filePath, 'utf8');
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(content)) {
      failures.push({
        filePath,
        pattern: pattern.toString()
      });
    }
  }
}

if (failures.length > 0) {
  console.error('Legacy contract check failed:');
  for (const failure of failures) {
    console.error(`- ${failure.filePath} matched ${failure.pattern}`);
  }
  process.exit(1);
}

console.log(`Legacy contract check passed for ${sourceFiles.length} source files.`);
