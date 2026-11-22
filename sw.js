// Service worker: เก็บเฉพาะไฟล์ของแอปไว้ใช้ออฟไลน์ ไม่เก็บข้อมูลการเงิน (ข้อมูลอยู่ใน localStorage และเซิร์ฟเวอร์)
const CACHE = "money-v1.0.0";
const FILES = ["./", "index.html", "style.css", "app.js", "manifest.webmanifest",
  "icons/favicon-64.png", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];

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
  // เฉพาะไฟล์ของแอปเอง คำขอไปเซิร์ฟเวอร์ข้อมูล (Worker) ไม่ผ่าน cache
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req, { cache: "no-cache" })
      .then((res) => {
        if (res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })),
  );
});
