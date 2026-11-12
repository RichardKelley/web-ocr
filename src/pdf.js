import * as pdfjs from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { createWorker } from 'tesseract.js';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;
const vendor = new URL(`${import.meta.env.BASE_URL}vendor/`, window.location.href).href;

export async function openPdf(bytes) {
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    cMapUrl: `${vendor}pdf/cmaps/`, cMapPacked: true,
    standardFontDataUrl: `${vendor}pdf/standard_fonts/`,
    wasmUrl: `${vendor}pdf/wasm/`,
  });
  try {
    const pdf = await task.promise;
    return {
      numPages: pdf.numPages,
      getPage: (number) => pdf.getPage(number),
      destroy: () => task.destroy(),
    };
  } catch (error) {
    await task.destroy();
    throw error;
  }
}

export async function renderPage(pdf, number) {
  const page = await pdf.getPage(number);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(3, 6000 / Math.max(base.width, base.height), Math.sqrt(16000000 / (base.width * base.height)));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  try {
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    return canvas;
  } catch (error) {
    canvas.width = canvas.height = 1;
    throw error;
  } finally { page.cleanup(); }
}

export const createOcr = () => createWorker('eng', 1, {
  workerPath: `${vendor}tesseract/worker.min.js`,
  corePath: `${vendor}core/`,
  langPath: `${vendor}languages/`,
  workerBlobURL: false,
  gzip: true,
});

export async function recognize(canvas, worker, signal) {
  let onAbort;
  try {
    const cancelled = new Promise((_, reject) => {
      onAbort = () => reject(new Error('OCR cancelled.'));
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
    const result = await Promise.race([worker.recognize(canvas, {}, { blocks: true }), cancelled]);
    const words = (result.data.blocks || []).flatMap((block) => block.paragraphs
      .flatMap((paragraph) => paragraph.lines.flatMap((line) => line.words)))
      .map((word) => ({ text: word.text, bbox: word.bbox }));
    return { text: result.data.text, words };
  } finally { signal.removeEventListener('abort', onAbort); }
}
