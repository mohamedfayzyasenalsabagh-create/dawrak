// عامل الخدمة: يعرض إشعار "طلبك جاهز" ويفتح الصفحة عند الضغط عليه
const V = "dawrak-v1";
const CORE = ["o.html", "o.js", "fb.js", "i18n.js", "en.js", "config.js", "icon-192.png"];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(V).then((c) => c.addAll(CORE)).catch(() => {}));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// الشبكة أولاً، والنسخة المحفوظة عند ضعف الإنترنت
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then((r) => { const c = r.clone(); caches.open(V).then((ca) => ca.put(e.request, c)).catch(() => {}); return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: u.pathname.endsWith("o.html") }))
  );
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "./";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
    for (const c of cs) if (c.url === url && "focus" in c) return c.focus();
    return self.clients.openWindow(url);
  }));
});
