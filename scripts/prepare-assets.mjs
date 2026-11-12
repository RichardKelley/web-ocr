import { createRequire } from 'node:module';
import { mkdir, readdir, copyFile, cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const vendor = path.join(root, 'public', 'vendor');
const directory = (name) => path.dirname(require.resolve(`${name}/package.json`));
await mkdir(path.join(vendor, 'tesseract'), { recursive: true });
await mkdir(path.join(vendor, 'core'), { recursive: true });
await copyFile(path.join(directory('tesseract.js'), 'dist', 'worker.min.js'), path.join(vendor, 'tesseract', 'worker.min.js'));
await copyFile(path.join(directory('tesseract.js'), 'LICENSE.md'), path.join(vendor, 'tesseract', 'LICENSE.md'));
for (const file of await readdir(directory('tesseract.js-core'))) {
  if (file.endsWith('.wasm') || file.endsWith('.wasm.js') || file === 'LICENSE') {
    await copyFile(path.join(directory('tesseract.js-core'), file), path.join(vendor, 'core', file));
  }
}
await cp(path.join(directory('@tesseract.js-data/eng'), '4.0.0'), path.join(vendor, 'languages'), { recursive: true });
for (const folder of ['cmaps', 'standard_fonts', 'wasm']) {
  await cp(path.join(directory('pdfjs-dist'), folder), path.join(vendor, 'pdf', folder), { recursive: true });
}
// Some static hosts send .mjs as text/plain. Keep the module worker as .js.
await copyFile(path.join(directory('pdfjs-dist'), 'build', 'pdf.worker.min.mjs'), path.join(vendor, 'pdf', 'pdf.worker.min.js'));
console.log('Prepared local OCR models, WebAssembly, and PDF resources.');
