import { readFile, access, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../docs/', import.meta.url));
const html = await readFile(path.join(root, 'index.html'), 'utf8');
assert.ok(!html.includes('./src/app.js'), 'The deployable HTML must load compiled assets.');
const scripts = Array.from(html.matchAll(/<script[^>]+src="([^"]+)"/g), (match) => match[1]);
assert.ok(scripts.length, 'The website needs a compiled entry script.');
for (const script of scripts) {
  assert.ok(script.startsWith('./assets/'), `Unexpected script URL: ${script}`);
  await access(path.join(root, script));
}
for (const file of await readdir(path.join(root, 'assets'))) {
  if (!/\.(?:mjs|js)$/.test(file)) continue;
  const source = await readFile(path.join(root, 'assets', file), 'utf8');
  assert.ok(!/\b(?:from|import)\s*(?:\(\s*)?["'`](?:pdfjs-dist|tesseract\.js)(?:[\/"'`])/u.test(source),
    `Unresolved browser package import in ${file}`);
}
for (const resource of [
  '.nojekyll', 'vendor/tesseract/worker.min.js', 'vendor/languages/eng.traineddata.gz',
  'vendor/pdf/pdf.worker.min.js',
  'vendor/core/tesseract-core-simd-lstm.wasm.js',
]) await access(path.join(root, resource));
console.log('Verified static entry, bundled package imports, PDF/OCR assets, and GitHub Pages marker.');
