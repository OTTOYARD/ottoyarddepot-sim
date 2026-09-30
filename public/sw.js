// ============================================================================
// OTTO-TWIN service worker — caches the APP SHELL only.
//
// What it caches: the page itself (index.html), the manifest, the icons, and
// Vite's content-hashed build output under /assets/ (JS, CSS, fonts, wasm).
// What it NEVER caches: anything cross-origin (the Supabase backend, the
// Omniverse stream, Google Fonts), any non-GET request, and any same-origin
// request outside that list. Live twin data always comes from the network;
// the cache only saves re-downloading the ~2 MB of code on every launch.
//
//   - /assets/*  cache-first: a hashed file never changes under its name.
//   - the page   network-first, cached copy only when offline, so a deploy is
//                picked up on the next launch rather than one launch late.
//
// Bump VERSION to drop every cache this worker made (activate deletes others).
// ============================================================================
const VERSION = "otto-twin-shell-v2"; // v2: the new OTTOYARD logo in every icon
const SHELL = ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png", "/favicon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("otto-twin-shell-") && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // live data and third parties: untouched

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put("/", copy)); }
          return res;
        })
        .catch(() => caches.match("/").then((r) => r || Response.error())),
    );
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      })),
    );
    return;
  }

  if (SHELL.includes(url.pathname)) {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
  }
});
