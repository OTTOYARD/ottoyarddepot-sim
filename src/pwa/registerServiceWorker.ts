/**
 * Register the app-shell service worker (public/sw.js) — production builds
 * only: in `vite dev` a worker would serve stale modules over HMR.
 *
 * It caches the shell (page, icons, hashed /assets/) so the installed app opens
 * fast; it never caches the backend (see sw.js). `?nosw=1` unregisters it, the
 * escape hatch if a phone ever sticks on an old build.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  if (new URLSearchParams(window.location.search).get('nosw') === '1') {
    navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()));
    return;
  }
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* no shell cache: the app still runs */ });
  });
}
