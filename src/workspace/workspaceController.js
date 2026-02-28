export function createWorkspaceController({
  app,
  windowObject = window,
  walkDirectory,
  ensureReadWritePermission,
  isMarkdownFile,
  readWorkspaceFromDb,
  writeWorkspaceToDb,
  setStatus,
  updateActionButtons,
  renderFileList,
  getEditorText,
  setEditorText,
  liveDebug
} = {}) {
  async function persistWorkspaceState() {
    if (!app.folderHandle) {
      return;
    }

    try {
      await writeWorkspaceToDb({
        folderHandle: app.folderHandle,
        currentPath: app.currentPath
      });
    } catch (error) {
      console.warn('Unable to persist workspace state:', error);
    }
  }

  async function saveCurrentFile(force = false) {
    if (!app.currentFileHandle) {
      return;
    }

    if (!force && !app.hasUnsavedChanges) {
      return;
    }

    const permitted = await ensureReadWritePermission(app.currentFileHandle);
    if (!permitted) {
      setStatus('Write permission was denied for this file.', true);
      return;
    }

    const markdownText = getEditorText();
    const writable = await app.currentFileHandle.createWritable();
    await writable.write(markdownText);
    await writable.close();

    app.lastSavedText = markdownText;
    app.hasUnsavedChanges = false;
    updateActionButtons();
    setStatus(`Saved ${app.currentPath}`);
  }

  function scheduleAutosave() {
    if (app.autosaveTimer) {
      windowObject.clearTimeout(app.autosaveTimer);
    }

    app.autosaveTimer = windowObject.setTimeout(() => {
      void saveCurrentFile().catch((error) => {
        console.error(error);
        setStatus(`Autosave failed: ${error.message}`, true);
      });
    }, 700);
  }

  async function openFile(path) {
    const handle = app.fileHandles.get(path);
    if (!handle) {
      return;
    }

    const file = await handle.getFile();
    const markdownText = await file.text();
    liveDebug.info('file.open.read', {
      path,
      byteLength: file.size,
      textLength: markdownText.length
    });

    app.currentPath = path;
    app.currentFileHandle = handle;
    app.lastSavedText = markdownText;
    app.hasUnsavedChanges = false;

    setEditorText(markdownText);
    renderFileList();
    updateActionButtons();

    await persistWorkspaceState();
    setStatus(`Editing ${path}`);
  }

  async function loadWorkspace(folderHandle, preferredPath = null) {
    app.folderHandle = folderHandle;
    app.fileHandles = await walkDirectory(folderHandle);
    renderFileList();
    updateActionButtons();

    if (app.fileHandles.size === 0) {
      app.currentPath = null;
      app.currentFileHandle = null;
      app.lastSavedText = getEditorText();
      app.hasUnsavedChanges = false;
      updateActionButtons();

      setStatus(
        `Folder "${folderHandle.name}" has no markdown files. Use New Note to create one.`
      );
      await persistWorkspaceState();
      return;
    }

    const firstPath = app.fileHandles.keys().next().value;
    const initialPath = preferredPath && app.fileHandles.has(preferredPath)
      ? preferredPath
      : firstPath;

    await openFile(initialPath);
  }

  async function restoreWorkspaceState() {
    try {
      const savedState = await readWorkspaceFromDb();

      if (!savedState?.folderHandle) {
        return;
      }

      const permission = await savedState.folderHandle.queryPermission({ mode: 'readwrite' });
      if (permission !== 'granted') {
        setStatus('Re-open your folder to continue editing local markdown files.');
        return;
      }

      await loadWorkspace(savedState.folderHandle, savedState.currentPath ?? null);
      setStatus(`Restored folder "${savedState.folderHandle.name}".`);
    } catch (error) {
      console.warn('Could not restore workspace:', error);
    }
  }

  async function pickFolder() {
    if (!('showDirectoryPicker' in windowObject)) {
      setStatus('This browser does not support local folder editing. Use Chrome or Edge desktop.', true);
      return;
    }

    try {
      const folderHandle = await windowObject.showDirectoryPicker({ mode: 'readwrite' });
      const permitted = await ensureReadWritePermission(folderHandle);

      if (!permitted) {
        setStatus('Folder permission was not granted.', true);
        return;
      }

      await loadWorkspace(folderHandle);
      await persistWorkspaceState();

      setStatus(`Opened "${folderHandle.name}".`);
    } catch (error) {
      if (error.name === 'AbortError') {
        setStatus('Folder selection cancelled.');
        return;
      }

      setStatus(`Unable to open folder: ${error.message}`, true);
    }
  }

  async function createNewNote() {
    if (!app.folderHandle) {
      setStatus('Open a folder first.', true);
      return;
    }

    const rawInput = windowObject.prompt(
      'Name the new markdown file (you can include subfolders):',
      'notes/new-note.md'
    );
    if (!rawInput) {
      return;
    }

    const trimmed = rawInput.trim().replace(/^\/+/, '').replace(/\/+$/, '');
    if (!trimmed) {
      setStatus('File name cannot be empty.', true);
      return;
    }

    const pathSegments = trimmed.split('/').filter(Boolean);
    if (pathSegments.length === 0) {
      setStatus('File name cannot be empty.', true);
      return;
    }

    let filename = pathSegments.pop();
    if (!isMarkdownFile(filename)) {
      filename = `${filename}.md`;
    }

    try {
      let targetDirectory = app.folderHandle;
      for (const segment of pathSegments) {
        targetDirectory = await targetDirectory.getDirectoryHandle(segment, { create: true });
      }

      const fileHandle = await targetDirectory.getFileHandle(filename, { create: true });
      const fullPath = [...pathSegments, filename].join('/');
      const existingFile = await fileHandle.getFile();

      if (existingFile.size === 0) {
        const starterTitle = filename.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
        const initialText = `# ${starterTitle}\n\n`;
        const writable = await fileHandle.createWritable();
        await writable.write(initialText);
        await writable.close();
      }

      await loadWorkspace(app.folderHandle, fullPath);
      setStatus(`Created ${fullPath}`);
    } catch (error) {
      setStatus(`Could not create note: ${error.message}`, true);
    }
  }

  return {
    persistWorkspaceState,
    saveCurrentFile,
    scheduleAutosave,
    openFile,
    loadWorkspace,
    restoreWorkspaceState,
    pickFolder,
    createNewNote
  };
}
