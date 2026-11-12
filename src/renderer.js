const fileList = document.querySelector('.file-list ul');
const emptyState = document.querySelector('.empty-state');
const importMessage = document.querySelector('#import-message');
const workspace = document.querySelector('.workspace');
const searchPanel = document.querySelector('.search-panel');
const searchInput = document.querySelector('#search-input');
const searchStatus = document.querySelector('#search-status');
const searchResults = document.querySelector('#search-results');
const resultList = document.querySelector('#result-list');
const documentView = document.querySelector('#document-view');
const previewStatus = document.querySelector('#preview-status');
const pageSheet = document.querySelector('.page-sheet');
const pageImage = document.querySelector('#page-image');
const pageHighlights = document.querySelector('#page-highlights');
const matchedPassage = document.querySelector('#matched-passage');
let searchVersion = 0;
let previewVersion = 0;
let lastResultButton;
let revision = 0;
const savedIndexSelect = document.querySelector('#saved-index');
const indexMessage = document.querySelector('#index-message');
const activeIndexLabel = document.querySelector('#active-index');
const saveIndexDialog = document.querySelector('#save-index-dialog');
const deleteIndexDialog = document.querySelector('#delete-index-dialog');
const switchIndexDialog = document.querySelector('#switch-index-dialog');
const indexNameInput = document.querySelector('#index-name');
const confirmSaveIndex = document.querySelector('#confirm-save-index');
let savedIndexes = [];
let activeIndexName = null;
let indexDirty = false;
let indexesReady = false;
let indexOperation = false;
let indexing = false;
let indexesRevision = 0;
let pendingDeleteId = null;
let pendingSwitch = null;
let currentDocumentIds = new Set();

function updateFileControls() {
  const busy = indexOperation || !indexesReady;
  document.querySelector('#add-files').disabled = busy;
  for (const button of fileList.querySelectorAll('.remove-file')) button.disabled = busy;
}

document.querySelector('#add-files').addEventListener('click', async () => {
  await runIndexOperation(async () => {
    const result = await window.pdfLibrary.pickFiles();
    importMessage.textContent = result.errors.join('\n');
  }, '', importMessage);
});

function updateIndexControls() {
  const busy = indexOperation || indexing || !indexesReady;
  savedIndexSelect.disabled = busy;
  document.querySelector('#new-index').disabled = busy;
  document.querySelector('#save-index').disabled = busy;
  document.querySelector('#load-index').disabled = busy || !savedIndexSelect.value;
  document.querySelector('#delete-index').disabled = busy || !savedIndexSelect.value;
  activeIndexLabel.textContent = `Working: ${activeIndexName || 'Unsaved index'}${indexDirty ? ' · Unsaved changes' : ''}`;
  activeIndexLabel.title = activeIndexLabel.textContent;
  if (indexing) indexMessage.textContent = 'Finish OCR before saving or switching indexes.';
  else if (indexMessage.textContent === 'Finish OCR before saving or switching indexes.') indexMessage.textContent = '';
  updateFileControls();
}

function renderIndexes(state) {
  indexesRevision += 1;
  const previousSelection = savedIndexSelect.value;
  const previousName = activeIndexName;
  activeIndexName = state.activeName;
  indexDirty = state.dirty;
  savedIndexes = state.indexes;
  indexesReady = true;
  savedIndexSelect.replaceChildren(new Option('Select an index…', ''));
  for (const index of savedIndexes) {
    savedIndexSelect.append(new Option(`${index.name} (${index.documentCount} files)`, index.id));
  }
  const active = savedIndexes.find((index) => index.name === activeIndexName);
  savedIndexSelect.value = activeIndexName !== previousName || state.resetSearch
    ? active?.id || ''
    : savedIndexes.some((index) => index.id === previousSelection) ? previousSelection : active?.id || '';
  if (state.resetSearch) {
    searchVersion += 1;
    previewVersion += 1;
    lastResultButton = null;
    resultList.replaceChildren();
    searchInput.value = '';
    searchStatus.textContent = '';
    showResults();
    searchResults.hidden = true;
    workspace.classList.remove('has-search');
    importMessage.textContent = '';
    searchInput.focus();
  }
  updateIndexControls();
}

async function runIndexOperation(action, successMessage, errorElement = indexMessage) {
  if (indexOperation) return false;
  indexOperation = true;
  errorElement.textContent = '';
  updateIndexControls();
  try {
    await action();
    indexMessage.textContent = successMessage;
    return true;
  } catch (error) {
    errorElement.textContent = error.message;
    return false;
  } finally {
    indexOperation = false;
    updateIndexControls();
  }
}

function updateSaveNote() {
  const key = indexNameInput.value.trim().normalize('NFKC').toLowerCase();
  const existing = savedIndexes.find((index) => index.name.normalize('NFKC').toLowerCase() === key);
  confirmSaveIndex.textContent = existing ? 'Replace saved index' : 'Save index';
  document.querySelector('#save-index-note').textContent = existing
    ? `This will replace the saved copy of “${existing.name}” with your current workspace.`
    : 'Saves the current file list, OCR text, and search index.';
  return existing;
}

savedIndexSelect.addEventListener('change', updateIndexControls);
document.querySelector('#save-index').addEventListener('click', () => {
  indexNameInput.value = activeIndexName || '';
  document.querySelector('#save-index-error').textContent = '';
  updateSaveNote();
  saveIndexDialog.showModal();
  indexNameInput.select();
});
indexNameInput.addEventListener('input', updateSaveNote);
document.querySelector('#cancel-save-index').addEventListener('click', () => {
  if (!indexOperation) saveIndexDialog.close();
});
document.querySelector('#save-index-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const existing = updateSaveNote();
  confirmSaveIndex.disabled = true;
  const saved = await runIndexOperation(
    () => window.pdfLibrary.indexes.save(indexNameInput.value, existing?.id),
    'Index saved.', document.querySelector('#save-index-error'),
  );
  confirmSaveIndex.disabled = false;
  if (saved) saveIndexDialog.close();
});

async function switchIndex(action, description, successMessage) {
  if (indexDirty) {
    pendingSwitch = { action, successMessage };
    document.querySelector('#switch-index-description').textContent = description;
    switchIndexDialog.showModal();
  } else {
    await runIndexOperation(action, successMessage);
  }
}
document.querySelector('#new-index').addEventListener('click', () => {
  void switchIndex(() => window.pdfLibrary.indexes.create(), 'Start a new, empty index?', 'Started a new index.');
});
document.querySelector('#load-index').addEventListener('click', () => {
  const selected = savedIndexes.find((index) => index.id === savedIndexSelect.value);
  if (selected) void switchIndex(() => window.pdfLibrary.indexes.load(selected.id),
    `Load “${selected.name}” into the workspace?`, `Loaded “${selected.name}”.`);
});
document.querySelector('#cancel-switch-index').addEventListener('click', () => {
  pendingSwitch = null;
  switchIndexDialog.close();
});
document.querySelector('#confirm-switch-index').addEventListener('click', async () => {
  const operation = pendingSwitch;
  pendingSwitch = null;
  switchIndexDialog.close();
  if (operation) await runIndexOperation(operation.action, operation.successMessage);
});

document.querySelector('#delete-index').addEventListener('click', () => {
  const selected = savedIndexes.find((index) => index.id === savedIndexSelect.value);
  if (!selected) return;
  pendingDeleteId = selected.id;
  document.querySelector('#delete-index-description').textContent = `Delete “${selected.name}” from saved indexes?`;
  document.querySelector('#delete-index-error').textContent = '';
  deleteIndexDialog.showModal();
});
document.querySelector('#cancel-delete-index').addEventListener('click', () => {
  if (!indexOperation) deleteIndexDialog.close();
});
document.querySelector('#confirm-delete-index').addEventListener('click', async () => {
  if (!pendingDeleteId) return;
  const id = pendingDeleteId;
  const button = document.querySelector('#confirm-delete-index');
  button.disabled = true;
  const deleted = await runIndexOperation(() => window.pdfLibrary.indexes.delete(id),
    'Saved index deleted. Current files were kept.', document.querySelector('#delete-index-error'));
  button.disabled = false;
  if (deleted) {
    pendingDeleteId = null;
    deleteIndexDialog.close();
  }
});
for (const dialog of [saveIndexDialog, deleteIndexDialog, switchIndexDialog]) {
  dialog.addEventListener('cancel', (event) => {
    if (indexOperation) event.preventDefault();
  });
}
window.pdfLibrary.indexes.onChanged(renderIndexes);
const initialIndexesRevision = indexesRevision;
window.pdfLibrary.indexes.list().then((state) => {
  if (indexesRevision === initialIndexesRevision) renderIndexes(state);
}).catch((error) => { indexMessage.textContent = error.message; });
updateIndexControls();

function appendHighlightedText(element, text, terms) {
  const normalized = text.normalize('NFKC');
  const wanted = new Set(terms);
  let cursor = 0;
  for (const match of normalized.matchAll(/[\p{L}\p{N}]+/gu)) {
    if (!wanted.has(match[0].toLowerCase())) continue;
    element.append(document.createTextNode(normalized.slice(cursor, match.index)));
    const highlight = document.createElement('mark');
    highlight.textContent = match[0];
    element.append(highlight);
    cursor = match.index + match[0].length;
  }
  element.append(document.createTextNode(normalized.slice(cursor)));
}

function showResults() {
  previewVersion += 1;
  documentView.hidden = true;
  searchPanel.hidden = false;
  searchResults.hidden = false;
  pageImage.removeAttribute('src');
  pageHighlights.replaceChildren();
}

document.querySelector('#back-to-results').addEventListener('click', () => {
  showResults();
  if (lastResultButton?.isConnected) lastResultButton.focus();
  else searchInput.focus();
});

async function openResult(result, terms) {
  const version = ++previewVersion;
  searchPanel.hidden = true;
  searchResults.hidden = true;
  documentView.hidden = false;
  pageSheet.hidden = true;
  pageImage.removeAttribute('src');
  pageHighlights.replaceChildren();
  matchedPassage.replaceChildren();
  appendHighlightedText(matchedPassage, result.excerpt, terms);
  document.querySelector('#document-title').textContent = `${result.name} · Page ${result.page}`;
  previewStatus.textContent = 'Loading matching page…';
  document.querySelector('#back-to-results').focus();
  try {
    const page = await window.pdfLibrary.preview(result.documentId, result.page);
    if (version !== previewVersion) return;
    const ready = new Promise((resolve, reject) => {
      pageImage.onload = resolve;
      pageImage.onerror = () => reject(new Error('The page image could not be displayed.'));
    });
    pageImage.alt = `${page.name}, page ${page.page} of ${page.total}`;
    pageImage.src = `data:image/png;base64,${page.image}`;
    pageHighlights.setAttribute('viewBox', `0 0 ${page.width} ${page.height}`);
    const wanted = new Set(terms);
    for (const word of page.words) {
      const tokens = word.text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
      if (!tokens.some((token) => wanted.has(token))) continue;
      const { x0, x1, y0, y1 } = word.bbox;
      const rectangle = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rectangle.setAttribute('x', Math.max(0, x0 - 4));
      rectangle.setAttribute('y', Math.max(0, y0 - 4));
      rectangle.setAttribute('width', x1 - x0 + 8);
      rectangle.setAttribute('height', y1 - y0 + 8);
      pageHighlights.append(rectangle);
    }
    await ready;
    if (version !== previewVersion) return;
    pageSheet.hidden = false;
    previewStatus.textContent = pageHighlights.children.length
      ? 'Search words are highlighted on the original page.'
      : 'The matched OCR text is shown above the original page.';
    document.querySelector('.preview-scroll').scrollTop = 0;
    requestAnimationFrame(() => {
      if (version === previewVersion) {
        pageHighlights.querySelector('rect')?.scrollIntoView({ block: 'center' });
      }
    });
  } catch (error) {
    if (version === previewVersion) previewStatus.textContent = `Could not open page: ${error.message}`;
  }
}

document.querySelector('#search-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const version = ++searchVersion;
  showResults();
  workspace.classList.add('has-search');
  resultList.replaceChildren();
  searchStatus.textContent = 'Searching…';
  try {
    const { terms, results } = await window.pdfLibrary.search(searchInput.value);
    if (version !== searchVersion) return;
    if (!terms.length) {
      searchStatus.textContent = 'Enter a word to search your indexed PDFs.';
      return;
    }
    if (!results.length) {
      searchStatus.textContent = 'No matches found. Try different words, or wait for your PDFs to finish indexing.';
      return;
    }
    const documentCount = new Set(results.map((result) => result.documentId)).size;
    searchStatus.textContent = `${results.length} matching ${results.length === 1 ? 'page' : 'pages'} in ${documentCount} ${documentCount === 1 ? 'PDF' : 'PDFs'}`;
    for (const result of results) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'search-result';
      const title = document.createElement('span');
      title.className = 'result-title';
      title.textContent = result.name;
      const metadata = document.createElement('span');
      metadata.className = 'result-metadata';
      metadata.textContent = `Page ${result.page} · ${result.occurrences} word ${result.occurrences === 1 ? 'match' : 'matches'}`;
      const passage = document.createElement('span');
      passage.className = 'result-excerpt';
      appendHighlightedText(passage, result.excerpt, terms);
      button.append(title, metadata, passage);
      button.addEventListener('click', () => {
        lastResultButton = button;
        void openResult(result, terms);
      });
      item.append(button);
      resultList.append(item);
    }
    searchResults.scrollTop = 0;
  } catch (error) {
    if (version === searchVersion) searchStatus.textContent = `Search failed: ${error.message}`;
  }
});

function renderFiles(documents) {
  revision += 1;
  const nextIds = new Set(documents.map((document) => document.id));
  const removed = [...currentDocumentIds].some((id) => !nextIds.has(id));
  currentDocumentIds = nextIds;
  indexing = documents.some((document) => ['queued', 'processing'].includes(document.status));
  indexDirty = true;
  updateIndexControls();
  fileList.replaceChildren();
  emptyState.hidden = documents.length > 0;
  for (const documentInfo of documents) {
    const item = document.createElement('li');
    item.className = 'file-item';
    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = documentInfo.name;
    name.title = documentInfo.path;
    const status = document.createElement('span');
    status.className = 'file-status';
    if (documentInfo.status === 'ready') {
      status.textContent = `Indexed · ${documentInfo.total} pages · ${documentInfo.wordCount} words`;
      if (!documentInfo.wordCount) status.textContent = 'Indexed · No readable words found';
    } else if (documentInfo.status === 'processing') {
      status.textContent = documentInfo.total
        ? `OCR · Page ${documentInfo.page} of ${documentInfo.total}` : 'Starting OCR…';
    } else if (documentInfo.status === 'error') {
      status.textContent = `Failed: ${documentInfo.error} Drop again to retry.`;
      status.classList.add('error');
    } else {
      status.textContent = 'Queued for OCR';
    }
    const details = document.createElement('div');
    details.className = 'file-details';
    details.append(name, status);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove-file';
    remove.textContent = 'Remove';
    remove.setAttribute('aria-label', `Remove ${documentInfo.name} from this index`);
    remove.title = 'Remove from the current index. The original PDF is kept.';
    remove.disabled = indexOperation || !indexesReady;
    remove.addEventListener('click', () => {
      void runIndexOperation(async () => {
        await window.pdfLibrary.remove(documentInfo.id);
        const state = await window.pdfLibrary.indexes.list();
        renderIndexes(state);
      }, '', importMessage);
    });
    item.append(details, remove);
    fileList.append(item);
  }
  if (removed && workspace.classList.contains('has-search')) {
    document.querySelector('#search-form').requestSubmit();
  }
}

window.pdfLibrary.onChanged(renderFiles);
const initialRevision = revision;
window.pdfLibrary.list().then((documents) => {
  if (revision === initialRevision) {
    const previousDirty = indexDirty;
    renderFiles(documents);
    indexDirty = previousDirty;
    updateIndexControls();
  }
}).catch((error) => { importMessage.textContent = error.message; });

let dragDepth = 0;
window.addEventListener('dragenter', (event) => {
  event.preventDefault();
  dragDepth += 1;
  document.body.classList.add('dragging');
});
window.addEventListener('dragover', (event) => {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
});
window.addEventListener('dragleave', (event) => {
  event.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) document.body.classList.remove('dragging');
});
window.addEventListener('drop', async (event) => {
  event.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging');
  importMessage.textContent = '';
  const files = Array.from(event.dataTransfer.files);
  if (!files.length) return;
  if (indexOperation) {
    importMessage.textContent = 'Wait for the index operation to finish, then drop the PDFs again.';
    return;
  }
  try {
    const result = await window.pdfLibrary.addFiles(files);
    // Progress events render the current state; the reply may be older.
    importMessage.textContent = result.errors.join('\n');
  } catch (error) {
    importMessage.textContent = `Could not add files: ${error.message}`;
  }
});
