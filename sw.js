// عامل الخدمة: يعرض إشعار "طلبك جاهز" ويفتح الصفحة عند الضغط عليه
const V = "dawrak-v3";
const ADMIN = new URL(location.href).searchParams.get("role") === "admin"; // نسخة إشعارات صاحب النظام
const INFO = "dawrak-push"; // معلومات آخر طلب لعرض الإشعار
const CORE = ["o.html", "o.js", "push.js", "fb.js", "i18n.js", "en.js", "config.js", "icon-192.png"];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(V).then((c) => c.addAll(CORE)).catch(() => {}));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V && k !== INFO).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// الشبكة أولاً، والنسخة المحفوظة عند ضعف الإنترنت
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  // مكتبة Firebase: من الذاكرة أولاً، لتفتح لوحة الكاشير حتى بدون نت
  if (u.hostname === "www.gstatic.com" && u.pathname.startsWith("/firebasejs/")) {
    e.respondWith(caches.match(e.request).then((m) => m || fetch(e.request).then((r) => { const c = r.clone(); caches.open(V).then((ca) => ca.put(e.request, c)); return r; })));
    return;
  }
  if (u.origin !== location.origin) return;
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

// الصفحة بتبعت معلومات الطلب لنعرضها بالإشعار
self.addEventListener("message", (e) => {
  if (!e.data || e.data.type !== "order") return;
  e.waitUntil(caches.open(INFO).then((c) => c.put("/__order", new Response(JSON.stringify({ ...e.data, ts: Date.now() })))));
});
// إشعار من الكاشير: "طلبك جاهز" حتى لو الجوال مقفل أو المتصفح مسكّر
self.addEventListener("push", (e) => {
  if (ADMIN) {
    e.waitUntil(self.registration.showNotification("🔔 دورك · نشاط جديد", {
      body: "مطعم جديد سجّل أو في إيصال دفع بانتظار مراجعتك", icon: "../icon-192.png", badge: "../icon-192.png",
      tag: "dawrak-admin", renotify: true, data: { url: new URL("../app.html#/admin", location.href).href }
    }));
    return;
  }
  e.waitUntil((async () => {
    let o = null;
    try { const r = await (await caches.open(INFO)).match("/__order"); if (r) o = await r.json(); } catch {}
    const title = (o && o.title) || "🔔 طلبك جاهز!";
    await self.registration.showNotification(title, {
      body: (o && o.body) || "تفضل استلم طلبك",
      icon: (o && o.icon) || "icon-192.png", badge: "icon-192.png",
      tag: (o && o.tag) || "dawrak", renotify: true, requireInteraction: true,
      vibrate: [500, 200, 500, 200, 800], data: { url: (o && o.url) || "./" }
    });
  })());
});
