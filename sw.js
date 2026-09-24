// Service worker: เก็บเฉพาะไฟล์ของแอปไว้ใช้ออฟไลน์ ไม่เก็บเอกสารพนักงาน
const CACHE = "deptflow-v2.2.0";
const FILES = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "config.js",
  "detect.js",
  "splitter.js",
  "zip.js",
  "signature.js",
  "manifest.webmanifest",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
  "vendor/pdf-lib.min.js",
  "vendor/pdf.min.mjs",
  "vendor/pdf.worker.min.mjs",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)));
});
