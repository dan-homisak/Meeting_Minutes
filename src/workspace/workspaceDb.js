const DB_NAME = 'meeting-minutes-mvp';
const DB_VERSION = 1;
const DB_STORE = 'workspace';
const WORKSPACE_KEY = 'active-workspace';

async function openDatabase(indexedDb) {
  return new Promise((resolve, reject) => {
    const request = indexedDb.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE);
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

export async function readWorkspaceFromDb(targetWindow = window) {
  if (!('indexedDB' in targetWindow)) {
    return null;
  }

  const db = await openDatabase(targetWindow.indexedDB);

  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const store = tx.objectStore(DB_STORE);
    const request = store.get(WORKSPACE_KEY);

    request.onsuccess = () => {
      resolve(request.result ?? null);
    };

    request.onerror = () => {
      reject(request.error);
    };

    tx.oncomplete = () => {
      db.close();
    };

    tx.onerror = () => {
      reject(tx.error);
    };
  });
}

export async function writeWorkspaceToDb(payload, targetWindow = window) {
  if (!('indexedDB' in targetWindow)) {
    return;
  }

  const db = await openDatabase(targetWindow.indexedDB);

  await new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    const store = tx.objectStore(DB_STORE);
    const request = store.put(payload, WORKSPACE_KEY);

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(request.error);
    };

    tx.oncomplete = () => {
      db.close();
    };

    tx.onerror = () => {
      reject(tx.error);
    };
  });
}
