import { tokenize, searchIndex } from './search.js';
import { read, readAll, transaction } from './storage.js';

export function buildIndex(documents) {
  const terms = Object.create(null);
  for (const document of Object.values(documents)) {
    for (const page of document.pages) {
      for (const [position, term] of tokenize(page.text).entries()) {
        const byDocument = terms[term] ||= Object.create(null);
        const byPage = byDocument[document.id] ||= Object.create(null);
        (byPage[page.number] ||= []).push(position);
      }
    }
  }
  return terms;
}

const nameKey = (name) => name.normalize('NFKC').toLowerCase();
const copy = (value) => structuredClone(value);

export class BrowserLibrary {
  constructor(database, pdfTools = null) {
    this.db = database;
    this.documents = Object.create(null);
    this.name = null;
    this.terms = Object.create(null);
    this.pending = [];
    this.activeJob = null;
    this.running = false;
    this.operations = Promise.resolve();
    this.writes = Promise.resolve();
    this.listeners = new Set();
    this.indexListeners = new Set();
    this.pdfTools = pdfTools;
  }

  async initialize() {
    const saved = await read(this.db, 'workspace', 'current');
    if (saved) {
      this.name = saved.name;
      this.documents = Object.assign(Object.create(null), saved.documents);
      for (const doc of Object.values(this.documents)) {
        if (['queued', 'processing'].includes(doc.status)) {
          doc.status = 'queued';
          this.pending.push(doc.id);
        }
      }
    }
    this.terms = buildIndex(this.documents);
  }

  run(action) {
    const operation = this.operations.catch(() => {}).then(action);
    this.operations = operation;
    return operation;
  }

  list() {
    return Object.values(this.documents).map(({ pages, ...doc }) => ({
      ...doc, wordCount: pages.reduce((sum, page) => sum + tokenize(page.text).length, 0),
    }));
  }

  changed() { for (const listener of this.listeners) listener(this.list()); }

  snapshot() { return { version: 1, name: this.name, documents: this.documents, terms: this.terms }; }

  persist(files = []) {
    this.terms = buildIndex(this.documents);
    const snapshot = copy(this.snapshot());
    const operation = this.writes.catch(() => {}).then(() => transaction(this.db, ['workspace', 'files'], (tx) => {
      for (const file of files) tx.objectStore('files').put(file.bytes, file.id);
      tx.objectStore('workspace').put(snapshot, 'current');
    }));
    this.writes = operation;
    return operation;
  }

  async state() {
    const snapshots = await readAll(this.db, 'indexes');
    const active = snapshots.find((index) => this.name && nameKey(index.name) === nameKey(this.name));
    return {
      activeName: this.name,
      dirty: active ? JSON.stringify(active.documents) !== JSON.stringify(this.documents) : Object.keys(this.documents).length > 0,
      indexes: snapshots.map((index) => ({
        id: index.id, name: index.name, savedAt: index.savedAt, documentCount: Object.keys(index.documents).length,
      })).sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  async indexesChanged(resetSearch = false) {
    const state = await this.state();
    for (const listener of this.indexListeners) listener({ ...state, resetSearch });
    return state;
  }

  assertIdle() {
    if (this.running || this.pending.length) throw new Error('Wait for PDF indexing to finish before saving or switching indexes.');
  }

  addFiles(files) {
    return this.run(async () => {
      const errors = [];
      for (const file of files) {
        let id;
        let previous;
        try {
          if (!/\.pdf$/i.test(file.name)) throw new Error('Only PDF files can be added.');
          const bytes = await file.arrayBuffer();
          if (!new TextDecoder().decode(bytes.slice(0, 1024)).includes('%PDF-')) throw new Error('This file does not contain a valid PDF header.');
          const hash = await crypto.subtle.digest('SHA-256', bytes);
          id = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
          previous = this.documents[id];
          if (previous && previous.status !== 'error') continue;
          this.documents[id] = {
            id, path: file.name, name: file.name, size: file.size, modified: file.lastModified,
            status: 'queued', page: 0, total: 0, pages: [], error: null,
          };
          await this.persist([{ id, bytes }]);
          this.pending.push(id);
          this.changed();
        } catch (error) {
          if (id) {
            if (previous) this.documents[id] = previous;
            else delete this.documents[id];
            this.terms = buildIndex(this.documents);
          }
          errors.push(`${file.name}: ${error.name === 'QuotaExceededError' ? 'Browser storage is full. Free space and try again.' : error.message}`);
        }
      }
      void this.drain();
      return { documents: this.list(), errors };
    });
  }

  async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.pending.length) {
        const doc = this.documents[this.pending.shift()];
        if (!doc) continue;
        const controller = new AbortController();
        const job = { id: doc.id, controller, worker: null };
        this.activeJob = job;
        let pdf;
        doc.status = 'processing';
        this.changed();
        controller.signal.addEventListener('abort', () => { void job.worker?.terminate(); }, { once: true });
        try {
          const { openPdf, renderPage, createOcr, recognize } = this.pdfTools || await import('./pdf.js');
          await this.persist();
          pdf = await openPdf(await read(this.db, 'files', doc.id));
          if (controller.signal.aborted) continue;
          job.worker = await createOcr();
          if (controller.signal.aborted) continue;
          const pages = [];
          for (let number = 1; number <= pdf.numPages; number += 1) {
            if (controller.signal.aborted) break;
            doc.page = number;
            doc.total = pdf.numPages;
            this.changed();
            const canvas = await renderPage(pdf, number);
            try {
              if (controller.signal.aborted) break;
              pages.push({ number, ...await recognize(canvas, job.worker, controller.signal) });
            } finally { canvas.width = canvas.height = 1; }
          }
          if (controller.signal.aborted || this.documents[doc.id] !== doc) continue;
          doc.pages = pages;
          doc.status = 'ready';
          await this.persist();
        } catch (error) {
          if (controller.signal.aborted || this.documents[doc.id] !== doc) continue;
          doc.status = 'error';
          doc.error = error.message || String(error);
          try { await this.persist(); } catch { doc.error += ' Browser storage could not be updated.'; }
        } finally {
          if (job.worker) await job.worker.terminate().catch(() => {});
          if (pdf) await pdf.destroy().catch(() => {});
          if (this.activeJob === job) this.activeJob = null;
        }
        this.changed();
      }
    } finally { this.running = false; }
  }

  remove(id) {
    return this.run(async () => {
      if (!Object.hasOwn(this.documents, id)) throw new Error('This file is no longer in the current index.');
      const doc = this.documents[id];
      const restart = this.pending.includes(id) || this.activeJob?.id === id;
      delete this.documents[id];
      this.pending = this.pending.filter((entry) => entry !== id);
      if (this.activeJob?.id === id) this.activeJob.controller.abort();
      try { await this.persist(); } catch (error) {
        this.documents[id] = doc;
        if (restart) { doc.status = 'queued'; this.pending.unshift(id); }
        this.terms = buildIndex(this.documents);
        this.changed();
        void this.drain();
        throw error;
      }
      this.changed();
      await this.collectFiles();
      return this.list();
    });
  }

  async collectFiles() {
    const snapshots = await readAll(this.db, 'indexes');
    const used = new Set(Object.keys(this.documents));
    for (const snapshot of snapshots) for (const id of Object.keys(snapshot.documents)) used.add(id);
    await transaction(this.db, ['files'], (tx) => {
      const request = tx.objectStore('files').openKeyCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (!used.has(cursor.key)) tx.objectStore('files').delete(cursor.key);
        cursor.continue();
      };
    });
  }

  save(name, overwriteId) {
    return this.run(async () => {
      this.assertIdle();
      if (typeof name !== 'string' || !name.trim() || name.trim().length > 80 || /[\u0000-\u001f]/u.test(name)) {
        throw new Error('Give the index a name between 1 and 80 characters.');
      }
      name = name.trim();
      const snapshots = await readAll(this.db, 'indexes');
      const existing = snapshots.find((index) => nameKey(index.name) === nameKey(name));
      if (existing && existing.id !== overwriteId) throw new Error('An index with this name already exists. Choose Replace saved index to update it.');
      if (overwriteId && existing?.id !== overwriteId) throw new Error('The saved index changed. Choose a name again.');
      await this.writes.catch(() => {});
      const record = { ...copy(this.snapshot()), id: existing?.id || crypto.randomUUID(), name, savedAt: new Date().toISOString() };
      await transaction(this.db, ['indexes', 'workspace'], (tx) => {
        tx.objectStore('indexes').put(record, record.id);
        tx.objectStore('workspace').put({ ...copy(this.snapshot()), name }, 'current');
      });
      this.name = name;
      await this.collectFiles();
      return this.indexesChanged();
    });
  }

  switchIndex(id = null) {
    return this.run(async () => {
      this.assertIdle();
      const snapshot = id ? await read(this.db, 'indexes', id) : { version: 1, name: null, documents: {}, terms: {} };
      if (!snapshot) throw new Error('This saved index no longer exists.');
      await this.writes.catch(() => {});
      await transaction(this.db, ['workspace'], (tx) => tx.objectStore('workspace').put(snapshot, 'current'));
      this.documents = Object.assign(Object.create(null), copy(snapshot.documents));
      this.name = snapshot.name;
      this.terms = buildIndex(this.documents);
      this.changed();
      await this.collectFiles();
      return this.indexesChanged(true);
    });
  }

  deleteIndex(id) {
    return this.run(async () => {
      const record = await read(this.db, 'indexes', id);
      if (!record) throw new Error('This saved index no longer exists.');
      await this.writes.catch(() => {});
      const name = this.name && nameKey(this.name) === nameKey(record.name) ? null : this.name;
      await transaction(this.db, ['indexes', 'workspace'], (tx) => {
        tx.objectStore('indexes').delete(id);
        tx.objectStore('workspace').put({ ...copy(this.snapshot()), name }, 'current');
      });
      this.name = name;
      await this.collectFiles();
      return this.indexesChanged();
    });
  }

  search(query) { return searchIndex(this.documents, this.terms, query); }

  async preview(id, number) {
    const { openPdf, renderPage } = this.pdfTools || await import('./pdf.js');
    const doc = this.documents[id];
    const page = doc?.pages.find((entry) => entry.number === number);
    if (!doc || doc.status !== 'ready' || !page) throw new Error('This indexed page is no longer available.');
    const bytes = await read(this.db, 'files', id);
    if (!bytes) throw new Error('The PDF is missing from browser storage. Add it again.');
    const pdf = await openPdf(bytes);
    let canvas;
    try {
      canvas = await renderPage(pdf, number);
      return {
        name: doc.name, page: number, total: doc.total, text: page.text, words: page.words || [],
        image: canvas.toDataURL('image/png').split(',')[1], width: canvas.width, height: canvas.height,
      };
    } finally {
      if (canvas) canvas.width = canvas.height = 1;
      await pdf.destroy();
    }
  }
}
