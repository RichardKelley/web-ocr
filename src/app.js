import { openDatabase } from './storage.js';
import { BrowserLibrary } from './library.js';

function pickFiles(library) {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,application/pdf';
    input.multiple = true;
    input.hidden = true;
    document.body.append(input);
    input.addEventListener('cancel', () => { input.remove(); resolve({ canceled: true, errors: [] }); }, { once: true });
    input.addEventListener('change', () => {
      const files = Array.from(input.files);
      input.remove();
      library.addFiles(files).then(resolve, reject);
    }, { once: true });
    input.click();
  });
}

try {
  let releaseLock;
  if (navigator.locks) {
    await new Promise((resolve, reject) => {
      navigator.locks.request('testocr-workspace', { ifAvailable: true }, async (lock) => {
        if (!lock) { reject(new Error('TestOCR is already open in another tab. Use that tab or close it first.')); return; }
        await new Promise((release) => { releaseLock = release; resolve(); });
      }).catch(reject);
    });
    window.addEventListener('pagehide', () => releaseLock?.(), { once: true });
  }
  const library = new BrowserLibrary(await openDatabase());
  await library.initialize();
  const subscribe = (set, callback) => { set.add(callback); return () => set.delete(callback); };
  window.pdfLibrary = {
    list: async () => library.list(),
    pickFiles: () => pickFiles(library),
    addFiles: (files) => library.addFiles(Array.from(files)),
    remove: (id) => library.remove(id),
    search: async (query) => library.search(query),
    preview: (id, page) => library.preview(id, page),
    onChanged: (callback) => subscribe(library.listeners, callback),
    indexes: {
      list: () => library.state(),
      save: (name, overwriteId) => library.save(name, overwriteId),
      load: (id) => library.switchIndex(id),
      create: () => library.switchIndex(),
      delete: (id) => library.deleteIndex(id),
      onChanged: (callback) => subscribe(library.indexListeners, callback),
    },
  };
  await import('./renderer.js');
  void library.drain();
  navigator.storage?.persist?.().catch(() => {});
} catch (error) {
  const message = document.querySelector('#index-message');
  message.setAttribute('role', 'alert');
  message.textContent = `Unable to open browser storage: ${error.message}`;
  document.querySelectorAll('button, input, select').forEach((control) => { control.disabled = true; });
}
