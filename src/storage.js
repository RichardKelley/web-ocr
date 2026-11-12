export async function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('testocr-web-v1', 1);
    request.onupgradeneeded = () => {
      for (const name of ['workspace', 'indexes', 'files']) request.result.createObjectStore(name);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close other TestOCR tabs and try again.'));
  });
}

export function transaction(database, names, action, mode = 'readwrite') {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(names, mode);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('Browser storage could not be updated.'));
    try {
      const request = action(tx);
      if (request) request.onsuccess = () => { result = request.result; };
    } catch (error) {
      tx.abort();
      reject(error);
    }
  });
}

export const read = (db, store, key) => transaction(db, [store], (tx) => tx.objectStore(store).get(key), 'readonly');
export const readAll = (db, store) => transaction(db, [store], (tx) => tx.objectStore(store).getAll(), 'readonly');
