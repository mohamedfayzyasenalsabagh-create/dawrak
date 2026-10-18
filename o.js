// صفحة الزبون: رقم الطلب وحالته، والتنبيه لما يجهز
import { configured, db, N, doc, onSnapshot, getDoc, updateDoc, collection, getDocs, query, where } from "./fb.js";
import { t, lang, useAuto } from "./i18n.js";
import { VAPID_PUBLIC, urlB64ToBytes } from "./push.js";

useAuto(); // صفحة الزبون دائماً حسب لغة جواله
const $ = (s) => document.querySelector(s);
const root = $("#root");
const P = new URLSearchParams(location.search);
const RID = P.get("r"), OID = P.get("o");
const KEY = `dawrak-o-${RID}-${OID}`;
const mem = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } })();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch {} };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let R = null, O = null, media = null, menu = null, menuOpen = false, rendered = "";

function fail(msg) { root.innerHTML = `<div class="center"><div style="font-size:48px">🍽️</div><p style="margin-top:12px">${esc(msg)}</p></div>`; }

if (!configured) fail(t("النظام قيد الإعداد"));
else if (!RID || !OID) fail(t("الرابط غير صحيح، امسح رمز QR مرة تانية"));
else start();

// ---------- الألوان ----------
function lum(hex) {
  const m = /^#?([\da-f]{6})$/i.exec(hex || ""); if (!m) return 0;
  const n = parseInt(m[1], 16), c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function theme() {
  const s = document.documentElement.style;
  if (R.color) { s.setProperty("--c1", R.color); s.setProperty("--on1", lum(R.color) > 0.5 ? "#17201B" : "#fff"); document.querySelector('meta[name=theme-color]').content = R.color; }
  if (R.color2) s.setProperty("--c2", R.color2);
}
const rname = () => (lang === "en" && R.nameEn) || R.name || "";

// ---------- البداية ----------
async function start() {
  try {
    const rs = await getDoc(doc(db, N.rest, RID));
    if (!rs.exists()) return fail(t("ما لقينا المطعم"));
    R = rs.data(); theme(); document.title = rname();
  } catch (e) { return fail(t("تعذّر الاتصال، تأكد من الإنترنت وحدّث الصفحة")); }

  onSnapshot(doc(db, N.rest, RID, "orders", OID), (s) => {
    // الطلب لسا ما وصل (نت الكاشير ضعيف): منستنى وما منوقف
    if (!s.exists()) { if (!O) root.innerHTML = `<div class="center"><div class="spin"></div><p>${esc(t("عم نستنى اتصال المطعم…"))}</p></div>`; return; }
    if (s.metadata.hasPendingWrites) return; // منعتمد بس على اللي أكّده الخادم
    const prev = O; O = s.data();
    if (!O.opened) updateDoc(s.ref, { opened: true }).catch(() => {});
    if (!prev && mem.alerts) subscribePush();
    react(prev); render();
  }, () => fail(t("تعذّر الاتصال، تأكد من الإنترنت وحدّث الصفحة")));

  loadMedia();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  window.addEventListener("online", net); window.addEventListener("offline", net); net();
  document.addEventListener("visibilitychange", backToPage);
  window.addEventListener("pageshow", backToPage);
}

function net() {
  const o = $("#off"); o.textContent = t("انقطع الإنترنت، رح نرجع نتصل تلقائياً"); o.style.display = navigator.onLine ? "none" : "block";
}

// العروض بتنحمّل مع الصفحة، والمنيو بس لما الزبون يطلبه (لتوفير الإنترنت)
const byOrder = (a, b) => (a.order || 0) - (b.order || 0);
async function loadMedia() {
  try {
    const q = await getDocs(query(collection(db, N.rest, RID, "media"), where("kind", "==", "offer")));
    media = q.docs.map((d) => d.data()).sort(byOrder);
  } catch { media = []; }
  rendered = ""; render();
}
async function loadMenu() {
  menuOpen = true; rendered = ""; render();
  if (menu) return;
  try {
    const q = await getDocs(query(collection(db, N.rest, RID, "media"), where("kind", "==", "menu")));
    menu = q.docs.map((d) => d.data()).sort(byOrder);
  } catch { menu = []; }
  rendered = ""; render();
}

// ---------- التنبيه ----------
let ac = null, beepTimer = null, wake = null;
async function enableAlerts() {
  mem.alerts = true; save();
  try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); await ac.resume(); tone(880, 0.12); } catch {}
  try { navigator.vibrate && navigator.vibrate(80); } catch {}
  try { if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission(); } catch {}
  lock(); rendered = ""; render();
  subscribePush();
}
// اشتراك بإشعارات الجوال: بتوصل حتى لو الشاشة مقفلة أو المتصفح مسكّر
async function subscribePush() {
  try {
    if (!("PushManager" in window) || Notification.permission !== "granted") return;
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToBytes(VAPID_PUBLIC) });
    // معلومات الإشعار لعامل الخدمة
    reg.active && reg.active.postMessage({ type: "order", url: location.href, title: "🔔 " + rname() + " · " + t("طلبك جاهز!"), body: t("طلب رقم {n} جاهز، تفضل استلمه", { n: O.num }), icon: R.logo || "icon-192.png", tag: KEY });
    if (O.push !== sub.endpoint) await updateDoc(doc(db, N.rest, RID, "orders", OID), { push: sub.endpoint });
  } catch (e) { console.warn("push", e); }
}
// لما يرجع الزبون للصفحة والطلب جاهز: نرجع نرن
async function backToPage() {
  if (document.visibilityState !== "visible") return;
  if (mem.alerts) lock();
  if (O && O.status === "ready" && !mem.picked) { try { await ac?.resume(); } catch {} ring(); }
}
async function lock() { try { if ("wakeLock" in navigator && !wake) { wake = await navigator.wakeLock.request("screen"); wake.addEventListener("release", () => (wake = null)); } } catch {} }
function tone(f, d, when = 0) {
  if (!ac) return;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = "square"; o.frequency.value = f; o.connect(g); g.connect(ac.destination);
  const t0 = ac.currentTime + when;
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
  o.start(t0); o.stop(t0 + d + 0.05);
}
function ring() {
  stopRing();
  try { if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)(); ac.resume(); } catch {}
  let n = 0;
  const once = () => {
    [0, 0.18, 0.36].forEach((w, i) => tone(i % 2 ? 1175 : 880, 0.15, w));
    try { navigator.vibrate && navigator.vibrate([400, 150, 400, 150, 600]); } catch {}
    if (++n >= 40) stopRing();
  };
  once(); beepTimer = setInterval(once, 1600);
  let f = false; const base = rname();
  ring.title = setInterval(() => { document.title = (f = !f) ? "🔔 " + t("طلبك جاهز!") : base; }, 900);
}
function stopRing() { clearInterval(beepTimer); clearInterval(ring.title); beepTimer = null; try { navigator.vibrate && navigator.vibrate(0); } catch {} document.title = R ? rname() : "دورك"; }
async function notify() {
  try {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const reg = await navigator.serviceWorker?.ready;
    const opts = { body: t("طلب رقم {n} جاهز، تفضل استلمه", { n: O.num }), icon: R.logo || "icon-192.png", badge: "icon-192.png", tag: KEY, renotify: true, requireInteraction: true, vibrate: [400, 150, 400, 150, 600], data: { url: location.href } };
    if (reg) reg.showNotification("🔔 " + rname() + " · " + t("طلبك جاهز!"), opts);
    else new Notification(rname(), opts);
  } catch {}
}

// يُستدعى عند كل تغيير بالطلب: يرن إذا صار جاهز أو الكاشير نادى مرة تانية
function react(prev) {
  const calls = O.calls || 0;
  // الكاشير رجّع الطلب لـ"بالتحضير"
  if (O.status !== "ready") {
    if (prev && prev.status === "ready" && mem.lastCalls !== undefined) { delete mem.lastCalls; mem.picked = false; save(); stopRing(); }
    return;
  }
  // منقارن مع آخر نداء محفوظ على الجهاز، لحتى ما يرن مرة تانية عند تحديث الصفحة
  const last = mem.lastCalls;
  if (last === undefined || calls > last) {
    mem.lastCalls = calls; if (last !== undefined) mem.picked = false; save();
    if (!mem.picked) { ring(); notify(); }
  }
}

function picked() {
  mem.picked = true; save(); stopRing();
  updateDoc(doc(db, N.rest, RID, "orders", OID), { picked: true }).catch(() => {});
  rendered = ""; render();
}
async function rate(n) {
  mem.rated = n; save(); rendered = ""; render();
  try { await updateDoc(doc(db, N.rest, RID, "orders", OID), { rating: n }); } catch {}
}
async function sendComment() {
  const v = ($("#cm")?.value || "").trim().slice(0, 300); if (!v) return;
  mem.commented = true; save(); rendered = ""; render();
  try { await updateDoc(doc(db, N.rest, RID, "orders", OID), { comment: v }); } catch {}
}

// ---------- العرض ----------
const ICONS = {
  instagram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor"/></svg>',
  whatsapp: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .1-1.3c0-.1-.2-.2-.5-.3z"/></svg>',
  facebook: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 8h3V4h-3a4 4 0 0 0-4 4v2H8v4h2v8h4v-8h3l1-4h-4V8z"/></svg>',
  maps: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg>'
};
function linkHref(k, v) {
  v = String(v || "").trim(); if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  if (k === "instagram") return "https://instagram.com/" + v.replace(/^@/, "");
  if (k === "whatsapp") { let d = v.replace(/\D/g, ""); if (d.startsWith("09")) d = "963" + d.slice(1); else if (d.startsWith("00")) d = d.slice(2); return "https://wa.me/" + d; }
  if (k === "facebook") return "https://facebook.com/" + v;
  if (k === "maps") return "https://maps.google.com/?q=" + encodeURIComponent(v);
  return "";
}
const LINK_NAMES = { instagram: "إنستغرام", whatsapp: "واتساب", facebook: "فيسبوك", maps: "الموقع" };

function linksHtml() {
  const L = R.links || {};
  const items = Object.keys(LINK_NAMES).map((k) => { const h = linkHref(k, L[k]); return h ? `<a href="${esc(h)}" target="_blank" rel="noopener">${ICONS[k]}${t(LINK_NAMES[k])}</a>` : ""; }).join("");
  return items ? `<div class="links">${items}</div>` : "";
}

function mediaHtml() {
  const offers = media || [];
  let h = "";
  if (R.hasMenu) h += menuOpen
    ? `<div class="card menu"><h3>📋 ${t("المنيو")}</h3>${menu ? menu.map((m) => `<img src="${m.data}" alt="" loading="lazy">`).join("") || `<p class="lbl">—</p>` : `<div class="spin"></div>`}</div>`
    : `<button class="alert ok" id="mn" style="margin-bottom:14px">📋 ${t("شوف المنيو")}</button>`;
  if (offers.length) h += `<div class="card"><h3>🔥 ${t("عروضنا")}</h3><div class="offers">${offers.map((o) => `<div class="offer">${o.data ? `<img src="${o.data}" alt="" loading="lazy">` : ""}<div><b>${esc((lang === "en" && o.titleEn) || o.title)}</b>${o.text || o.textEn ? `<p>${esc((lang === "en" && o.textEn) || o.text)}</p>` : ""}</div></div>`).join("")}</div></div>`;
  return h;
}

function render() {
  if (!R || !O) return;
  const ready = O.status === "ready";
  const showThanks = ready && mem.picked;
  const key = [O.status, O.num, mem.alerts, mem.picked, mem.rated, mem.commented, !!media, menuOpen, !!menu, O.calls].join("|");
  if (key === rendered) return; rendered = key;

  const head = `<div class="top"><div class="logo" style="${R.logo ? `background-image:url('${R.logo}')` : ""}">${R.logo ? "" : esc(rname().slice(0, 1))}</div><div class="rname">${esc(rname())}</div></div>`;
  let main;
  if (showThanks) {
    const r = mem.rated || O.rating || 0;
    main = `<div class="card thanks"><div class="e">😋</div><h2>${t("بالهنا والشفا!")}</h2><p class="lbl">${t("شكراً لزيارتك")} ${esc(rname())}</p>
      <p style="margin-top:18px;font-weight:700">${r ? t("شكراً على تقييمك ❤️") : t("كيف كانت تجربتك؟")}</p>
      <div class="stars">${[1, 2, 3, 4, 5].map((i) => `<button data-r="${i}" class="${i <= r ? "on" : ""}" ${r ? "disabled" : ""} aria-label="${i}">★</button>`).join("")}</div>
      ${r && !mem.commented && !O.comment ? `<textarea id="cm" maxlength="300" placeholder="${esc(t("بدك تقلّنا شي؟ (اختياري)"))}" style="width:100%;margin-top:10px;padding:12px;border-radius:14px;border:1.5px solid var(--line);font:inherit;min-height:70px"></textarea><button class="alert" id="cms" style="margin-top:8px;padding:12px;font-size:15px">${t("إرسال")}</button>` : ""}
      ${mem.commented ? `<p class="lbl" style="margin-top:8px">${t("وصلت ملاحظتك ✓")}</p>` : ""}
      ${linksHtml() ? `<p class="lbl" style="margin-top:14px">${t("تابعنا")}</p>${linksHtml()}` : ""}</div>`;
  } else {
    const stage = ready ? 3 : 2;
    main = `<div class="card"><p class="lbl">${t("رقم طلبك")}</p><div class="num">${esc(O.num)}</div>
      <div class="steps"><div class="bar" style="width:calc(${stage === 3 ? 100 : 50}% - 28px)"></div>
        <div class="st on"><span class="dot">✓</span>${t("استلمنا")}</div>
        <div class="st on ${stage === 2 ? "now" : ""}"><span class="dot">${stage > 2 ? "✓" : ""}</span>${t("بالتحضير")}</div>
        <div class="st ${stage === 3 ? "on now" : ""}"><span class="dot">${stage === 3 ? "✓" : ""}</span>${t("جاهز")}</div></div>
      ${mem.alerts ? `<div class="alert ok">✓ ${t("التنبيه مفعّل، رح يرن جوالك لما يجهز طلبك")}</div><p class="hint">${t("خلّي هالصفحة مفتوحة لتوصلك الرنة")}</p>`
        : `<button class="alert" id="en">🔔 ${t("فعّل التنبيه")}</button><p class="hint">${t("اكبس لنرن على جوالك لما يجهز طلبك")}</p>`}</div>`;
  }
  const overlay = ready && !mem.picked ? `<div class="ready show"><h1>🎉 ${t("طلبك جاهز!")}</h1><div class="big">${esc(O.num)}</div><p>${t("تفضل استلمه من الكاشير")}</p><button id="pk">${t("استلمت طلبي ✓")}</button></div>` : "";
  root.innerHTML = head + `<div class="wrap">${main}${mediaHtml()}<p class="foot">${t("بواسطة")} <a href="./" target="_blank">${t("دورك")}</a></p></div>` + overlay;

  $("#en")?.addEventListener("click", enableAlerts);
  $("#pk")?.addEventListener("click", picked);
  root.querySelectorAll(".stars button").forEach((b) => b.addEventListener("click", () => rate(+b.dataset.r)));
  $("#mn")?.addEventListener("click", loadMenu);
  $("#cms")?.addEventListener("click", sendComment);
}
