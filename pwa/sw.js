const CACHE_NAME = "scanentrega-v5";
const APP_SHELL = [
  "./index.html",
  "./offline.html",
  "./manifest.json",
  "./css/style.css",
  "./js/config.js",
  "./js/app.js",
  "./js/camera.js",
  "./js/quality.js",
  "./js/db.js",
  "./js/sync.js",
  "./js/mock-api.js",
  "./js/ui.js",
  "./js/mock-workflow.js",
  "./vendor/dexie.min.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const urls = APP_SHELL.map((file) => new URL(file, self.registration.scope).href);
    await cache.addAll(urls);
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith("scanentrega-") && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") void self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const requestUrl = new URL(request.url);
  const scopeUrl = new URL(self.registration.scope);
  if (requestUrl.origin !== scopeUrl.origin || !requestUrl.pathname.startsWith(scopeUrl.pathname)) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch {
        const cache = await caches.open(CACHE_NAME);
        const appEntry = new URL("./index.html", scopeUrl);
        if (requestUrl.pathname === scopeUrl.pathname || requestUrl.pathname === appEntry.pathname) {
          const cachedApp = await cache.match(appEntry.href);
          if (cachedApp) return cachedApp;
        }
        return (await cache.match(new URL("./offline.html", scopeUrl).href))
          ?? new Response("Offline", { status: 503, statusText: "Offline" });
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;

    const response = await fetch(request);
    if (response.ok && response.type === "basic") await cache.put(request, response.clone());
    return response;
  })());
});
