function tokenize(text) {
  return text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
}

function excerpt(text, terms) {
  const normalized = text.normalize('NFKC').replace(/\s+/g, ' ').trim();
  const wanted = new Set(terms);
  const first = Array.from(normalized.matchAll(/[\p{L}\p{N}]+/gu))
    .find((match) => wanted.has(match[0].toLowerCase()));
  const start = Math.max(0, (first?.index || 0) - 90);
  const end = Math.min(normalized.length, (first?.index || 0) + 210);
  // Extend to whole words so the highlighted match is never cut in half.
  let left = start;
  let right = end;
  while (left > 0 && /[\p{L}\p{N}]/u.test(normalized[left - 1])) left -= 1;
  while (right < normalized.length && /[\p{L}\p{N}]/u.test(normalized[right])) right += 1;
  return `${left ? '…' : ''}${normalized.slice(left, right)}${right < normalized.length ? '…' : ''}`;
}

function searchIndex(documents, index, query) {
  if (typeof query !== 'string' || query.length > 512) {
    throw new Error('Enter a search of 512 characters or fewer.');
  }
  const terms = [...new Set(tokenize(query))];
  if (terms.length > 32) throw new Error('Search for up to 32 words at a time.');
  if (!terms.length) return { terms, results: [] };
  const postings = terms.map((term) => Object.hasOwn(index, term) ? index[term] : null);
  if (postings.some((posting) => !posting)) return { terms, results: [] };
  // Start with the least common term and intersect postings on document and page.
  const seed = [...postings].sort((a, b) => Object.keys(a).length - Object.keys(b).length)[0];
  const results = [];
  for (const [documentId, pages] of Object.entries(seed)) {
    const document = documents[documentId];
    if (!document || document.status !== 'ready') continue;
    for (const pageNumber of Object.keys(pages)) {
      if (!postings.every((posting) => posting[documentId]?.[pageNumber]?.length)) continue;
      const page = document.pages.find((entry) => entry.number === Number(pageNumber));
      if (!page) continue;
      results.push({
        documentId,
        name: document.name,
        page: page.number,
        occurrences: postings.reduce((sum, posting) => sum + posting[documentId][pageNumber].length, 0),
        excerpt: excerpt(page.text, terms),
      });
    }
  }
  results.sort((a, b) => b.occurrences - a.occurrences || a.name.localeCompare(b.name) || a.page - b.page);
  return { terms, results };
}

export { tokenize, excerpt, searchIndex };

