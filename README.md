# TestOCR Web

A standalone website version of TestOCR. Add or drop PDFs, run English OCR,
search indexed words, open matching pages with highlights, remove files, and
save/load/delete named indexes.

## How it works

The host serves static HTML, JavaScript, WebAssembly, and an English OCR model.
PDF.js renders pages and Tesseract.js recognizes their words in the browser.
PDFs, OCR text, and named indexes stay in IndexedDB on the visitor's device.
There is no backend, account, API key, or document upload. Hosting the website
does not give visitors access to each other's PDFs or indexes.

The website includes its OCR assets at build time; it does not fetch libraries
or language models from third-party CDNs. A first page load downloads the model
and engine as needed, so initial OCR can take longer than later pages.

Browser storage belongs to this site, browser profile, and device. It does not
sync across computers and can be removed by clearing site data, private browsing,
or browser storage eviction. Keep the original PDFs. This version has no backup
export or desktop-index import; add PDFs to build a separate web library.

## Run locally on Windows

Install Node.js 22.13+ (Node.js 24 LTS recommended), then open PowerShell in this
directory:

```powershell
npm install
npm run dev
```

Open the localhost URL printed in the terminal. Keep the tab open during OCR.
Use a current Chrome, Edge, Firefox, or Safari browser. Development needs Node;
visitors to a deployed site only need their browser. Double-clicking `index.html`
does not work: use a local HTTP server or HTTPS hosting.

```powershell
npm test
npm run build
npm run preview
```

The production website is generated in `docs/`. Any static host can serve that
directory. Relative asset paths support GitHub Pages repository subdirectories.
The site uses no server routes or SPA fallback rules.

The included `docs/` directory is already built and ready to host. Commit it when
deploying directly from a branch, and rebuild it after making source changes.

## Push this copy to GitHub

Copy **the contents of this directory**, including `.github`, into the root of a
new GitHub repository. Keep `package-lock.json` and the prebuilt `docs/` folder.
Do not upload `node_modules`, `dist`, `.npm-cache`, or generated `public/vendor`
files. No PDFs, indexes, keys,
or desktop application data are included in the source.

From the copied directory, using your repository URL:

```powershell
git init
git add .
git commit -m "Add browser PDF OCR and search app"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPOSITORY.git
git push -u origin main
```

For deployment without a build workflow, choose **Settings → Pages → Source →
Deploy from a branch → your branch (main or master) → /docs → Save**. You can also publish from the
repository root: the root entry detects plain static hosting and redirects to
the prebuilt `docs/` app, avoiding unresolved npm package imports.

For automatic builds, choose **Settings → Pages → Source → GitHub Actions**. The included
`.github/workflows/pages.yml` builds and deploys the site on pushes to `main` or `master`.
You can also run it manually from the Actions tab. Your repository must support
GitHub Pages with its current visibility and account plan. Nothing has been
pushed or deployed as part of creating this copy.

If you keep this directory inside the Electron repository instead, move the
workflow to the repository's root `.github/workflows` and set the build commands'
working directory, Node cache path, and uploaded artifact path to `web-app`.
The supplied workflow assumes this copy is the repository root.

### Fixing “Failed to resolve module specifier pdfjs-dist”

This error means a browser loaded the npm-based source directly. GitHub Pages
does not resolve npm imports or run Vite when publishing from a branch. Replace
the old files with this updated copy, including `entry.js` and `docs/`, then
publish the `/docs` folder or use GitHub Actions. A separate website-only ZIP
also contains the contents of `docs/` and can be uploaded directly to the root
of a static hosting repository. Do not mix source HTML with compiled assets.

After publishing, hard-refresh the page (Ctrl+F5), then drop any failed PDFs again
to retry. Browser-local files and saved indexes do not need to be cleared.

## Source layout

- `src/renderer.js`, `src/styles.css`, `index.html`: adapted desktop interface.
- `entry.js`: development entry and static-host fallback to the prebuilt app.
- `docs/`: complete, compiled website for GitHub Pages or another static host.
- `src/app.js`: browser API bridge, file picker, and single-tab write lock.
- `src/library.js`: queue, search index, named snapshots, and PDF retention.
- `src/storage.js`: IndexedDB transactions.
- `src/pdf.js`: browser PDF rendering and OCR.
- `src/search.js`: the desktop search algorithm converted to ES modules.
- `scripts/prepare-assets.mjs`: copies installed OCR/PDF resources into the build.
- `scripts/verify-site.mjs`: checks for unresolved browser imports and missing assets.
- `test/`: persistence, named-index, removal, queue, and search checks.

The Electron app in the parent directory remains independent of this copy.

## References

- [Vite: deploying to GitHub Pages](https://vite.dev/guide/static-deploy#github-pages)
- [Tesseract.js local installation](https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md)
- [Browser storage quotas and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)
