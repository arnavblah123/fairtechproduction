// Minimal service worker: makes the app installable and takes control
// immediately. All requests pass through to the network — live production
// data must never be served stale from a cache.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
