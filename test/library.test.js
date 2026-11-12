import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { BrowserLibrary } from '../src/library.js';
import { openDatabase, read, readAll } from '../src/storage.js';
import { searchIndex } from '../src/search.js';

const tools = {
  openPdf: async () => ({ numPages: 2, destroy: async () => {} }),
  renderPage: async (_, number) => ({ number, width: 100, height: 200, toDataURL: () => 'data:image/png;base64,cG5n' }),
  createOcr: async () => ({ terminate: async () => {} }),
  recognize: async (canvas) => ({ text: canvas.number === 1 ? 'Orchard orchard' : 'Orchard lighthouse', words: [] }),
};

async function setup(t, pdfTools = tools) {
  globalThis.indexedDB = new IDBFactory();
  const db = await openDatabase();
  t.after(() => db.close());
  const library = new BrowserLibrary(db, pdfTools);
  await library.initialize();
  return library;
}

async function imported(library, files) {
  await library.addFiles(files);
  while (library.running) await new Promise((resolve) => setTimeout(resolve, 1));
}

const pdf = (name = 'sample.pdf', suffix = '') => new File([`%PDF-1.7\nfixture${suffix}`], name, { type: 'application/pdf' });

test('browser imports build page postings, skip duplicate content, and retain PDFs on reload', async (t) => {
  const library = await setup(t);
  await imported(library, [pdf(), pdf('same-bytes.pdf')]);
  assert.equal(library.list().length, 1);
  assert.equal(library.list()[0].status, 'ready');
  assert.equal(library.search('ORCHARD').results[0].occurrences, 2);
  assert.equal(library.search('orchard lighthouse').results[0].page, 2);
  assert.equal(library.search('orchardist').results.length, 0);
  const reopened = new BrowserLibrary(library.db, tools);
  await reopened.initialize();
  assert.equal(reopened.search('lighthouse').results.length, 1);
  assert.equal((await reopened.preview(reopened.list()[0].id, 2)).page, 2);
  assert.equal((await readAll(library.db, 'files')).length, 1);
});

test('named snapshots preserve their PDFs across file removal and New, and deletion reclaims unused PDFs', async (t) => {
  const library = await setup(t);
  await imported(library, [pdf()]);
  const saved = await library.save('Research');
  const id = saved.indexes[0].id;
  await assert.rejects(library.save('research'), /already exists/);
  await library.remove(library.list()[0].id);
  assert.equal(library.search('orchard').results.length, 0);
  assert.equal((await readAll(library.db, 'files')).length, 1);
  assert.equal((await library.state()).dirty, true);
  await library.switchIndex(id);
  assert.equal(library.search('orchard').results.length, 2);
  await library.switchIndex();
  assert.equal(library.list().length, 0);
  await library.deleteIndex(id);
  assert.equal((await readAll(library.db, 'files')).length, 0);
  assert.equal((await library.state()).indexes.length, 0);
});

test('explicit replacement persists an edited named copy and deleting active snapshot keeps the workspace', async (t) => {
  const library = await setup(t);
  await imported(library, [pdf()]);
  const saved = await library.save('Original');
  await imported(library, [pdf('second.pdf', 'different')]);
  const updated = await library.save('Original', saved.indexes[0].id);
  assert.equal(updated.indexes[0].documentCount, 2);
  assert.equal(updated.dirty, false);
  await library.deleteIndex(saved.indexes[0].id);
  assert.equal(library.list().length, 2);
  assert.equal(library.name, null);
  assert.equal((await readAll(library.db, 'files')).length, 2);
});

test('invalid PDFs fail cleanly and interrupted OCR resumes from browser storage', async (t) => {
  const library = await setup(t);
  const result = await library.addFiles([new File(['bad'], 'bad.pdf'), new File(['text'], 'note.txt')]);
  assert.equal(result.errors.length, 2);
  assert.equal(library.list().length, 0);
  await imported(library, [pdf()]);
  const document = Object.values(library.documents)[0];
  document.status = 'processing';
  document.pages = [];
  await library.persist();
  const reopened = new BrowserLibrary(library.db, tools);
  await reopened.initialize();
  assert.equal(reopened.list()[0].status, 'queued');
  await reopened.drain();
  assert.equal(reopened.search('orchard').results.length, 2);
  assert.equal((await read(library.db, 'workspace', 'current')).documents[document.id].status, 'ready');
});

test('removing active OCR cancels its job and does not stop subsequent files', async (t) => {
  let started;
  const start = new Promise((resolve) => { started = resolve; });
  let calls = 0;
  const library = await setup(t, { ...tools, recognize: async (_, worker, signal) => {
    calls += 1;
    if (calls === 1) {
      started();
      await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true }));
    }
    return { text: 'Remaining', words: [] };
  } });
  await library.addFiles([pdf(), pdf('next.pdf', 'next')]);
  await start;
  await library.remove(library.list()[0].id);
  while (library.running) await new Promise((resolve) => setTimeout(resolve, 1));
  assert.deepEqual(library.list().map((doc) => doc.name), ['next.pdf']);
  assert.equal(library.list()[0].status, 'ready');
  assert.equal(library.search('remaining').results.length, 2);
});

test('search validates empty and excessive queries', () => {
  assert.deepEqual(searchIndex({}, {}, '!!!').results, []);
  assert.throws(() => searchIndex({}, {}, 'a'.repeat(513)), /512/);
});
