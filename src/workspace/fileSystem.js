const MARKDOWN_FILE_PATTERN = /\.(md|markdown|mkd|mdown)$/i;

export function isMarkdownFile(name) {
  return MARKDOWN_FILE_PATTERN.test(name);
}

export function joinPath(basePath, segment) {
  return basePath ? `${basePath}/${segment}` : segment;
}

export async function walkDirectory(directoryHandle, currentPath = '') {
  const directories = [];
  const markdownFiles = [];

  for await (const [name, handle] of directoryHandle.entries()) {
    if (handle.kind === 'directory') {
      directories.push([name, handle]);
      continue;
    }

    if (handle.kind === 'file' && isMarkdownFile(name)) {
      markdownFiles.push([name, handle]);
    }
  }

  directories.sort(([a], [b]) => a.localeCompare(b));
  markdownFiles.sort(([a], [b]) => a.localeCompare(b));

  const results = new Map();

  for (const [name, handle] of directories) {
    const nested = await walkDirectory(handle, joinPath(currentPath, name));
    for (const [nestedPath, nestedHandle] of nested.entries()) {
      results.set(nestedPath, nestedHandle);
    }
  }

  for (const [name, handle] of markdownFiles) {
    results.set(joinPath(currentPath, name), handle);
  }

  return results;
}

export async function ensureReadWritePermission(handle) {
  const options = { mode: 'readwrite' };

  if ((await handle.queryPermission(options)) === 'granted') {
    return true;
  }

  return (await handle.requestPermission(options)) === 'granted';
}
