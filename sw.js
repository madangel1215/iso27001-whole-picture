// ISMS·LA service worker — 離線可用 app shell（cache-first）
const CACHE = "ismsla-v1.0.0";
const CORE = [
  "./", "index.html", "favicon.svg", "manifest.webmanifest", "icon-192.png", "icon-512.png", "og-image.png",
  "data/data.json", "data/supplements.json", "data/documents.json", "data/standards.json", "data/exam.json",
  "https://unpkg.com/cytoscape@3.34.0/dist/cytoscape.min.js",
  "https://unpkg.com/layout-base@2.0.1/layout-base.js",
  "https://unpkg.com/cose-base@2.2.0/cose-base.js",
  "https://unpkg.com/cytoscape-fcose@2.2.0/cytoscape-fcose.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.allSettled(CORE.map((u) => c.add(u))); // 單一資源失敗不擋安裝
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const isHTML = req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html");
  const isData = url.origin === location.origin && url.pathname.endsWith(".json");
  // HTML 與同源 JSON 內容 → network-first：線上拿最新(部署/CMS 編輯立即生效)，離線退快取
  if (isHTML || isData) {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res && res.ok) { const c = await caches.open(CACHE); c.put(req, res.clone()); }
        return res;
      } catch (err) {
        return (await caches.match(req)) || (isHTML && await caches.match("index.html")) || Response.error();
      }
    })());
    return;
  }
  // 其餘(釘版 CDN、圖示、og-image) → cache-first
  e.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      const res = await fetch(req);
      // 任何 ok 回應都寫回（含 CDN/CORS），確保離線完整；opaque(status 0)因 res.ok=false 自動略過
      if (res && res.ok) { const c = await caches.open(CACHE); c.put(req, res.clone()); }
      return res;
    } catch (err) { return cached || Response.error(); }
  })());
});
