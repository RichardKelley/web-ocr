// Vite supplies import.meta.env in development and compiled production builds.
// A plain static host serves this file unchanged, so open the committed build.
if (import.meta.env?.DEV || import.meta.env?.PROD) {
  await import('./src/app.js');
} else {
  window.location.replace(new URL('./docs/', window.location.href));
}
