export function createWorkspaceView({
  statusElement,
  fileCountElement,
  fileListElement,
  newNoteButton,
  saveNowButton
} = {}) {
  function setStatus(message, asError = false) {
    if (statusElement) {
      statusElement.textContent = message;
      statusElement.classList.toggle('error', asError);
    }
  }

  function updateActionButtons({ folderHandle = null, currentFileHandle = null } = {}) {
    const hasFolder = Boolean(folderHandle);
    if (newNoteButton) {
      newNoteButton.disabled = !hasFolder;
    }
    if (saveNowButton) {
      saveNowButton.disabled = !currentFileHandle;
    }
  }

  function renderFileList({
    fileHandles = new Map(),
    currentPath = null,
    onOpenFile = null
  } = {}) {
    if (!(fileListElement instanceof HTMLElement)) {
      return;
    }

    fileListElement.innerHTML = '';

    const paths = [...fileHandles.keys()];
    if (fileCountElement) {
      fileCountElement.textContent = String(paths.length);
    }

    if (paths.length === 0) {
      const empty = document.createElement('li');
      empty.textContent = 'No markdown files yet.';
      empty.className = 'hint';
      fileListElement.append(empty);
      return;
    }

    for (const path of paths) {
      const item = document.createElement('li');
      const button = document.createElement('button');

      button.type = 'button';
      button.className = 'file-button';
      button.textContent = path;
      button.title = path;
      button.classList.toggle('active', path === currentPath);
      button.addEventListener('click', () => {
        if (typeof onOpenFile === 'function') {
          void onOpenFile(path);
        }
      });

      item.append(button);
      fileListElement.append(item);
    }
  }

  return {
    setStatus,
    updateActionButtons,
    renderFileList
  };
}
