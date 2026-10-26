// تطبيق دورك: دخول، كاشير، لوحة المطعم، ولوحة صاحب النظام
import {
  configured, auth, db, N, createStaffAccount, platformOf, hasPro, toDate, isActive, dayKey,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail,
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs, onSnapshot,
  serverTimestamp, runTransaction, writeBatch, orderBy, limit, Timestamp, increment, getCountFromServer
} from "./fb.js";
import { t, lang, setLang } from "./i18n.js";
import { APK_URL } from "./config.js";
import { logError, errCtx } from "./errlog.js";
import { sendPush, VAPID_PUBLIC, urlB64ToBytes } from "./push.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const app = $("#app");
const STAFF_DOMAIN = "staff.dawrak.app";
const IN_APP = /DawrakApp/.test(navigator.userAgent);

// ---------- الحالة ----------
const S = { user: null, plat: platformOf(), isAdmin: false, me: null, rid: null, R: null, unsub: [], boot: false };
const PLAN_NAMES = { trial: "تجربة مجانية", basic: "كاشير واحد", duo: "كاشيرين", unlimited: "مفتوحة" };
const planName = (p) => t(PLAN_NAMES[p] || p);

// ---------- أدوات ----------
export function toast(msg, ms = 2600) {
  const d = document.createElement("div"); d.className = "toast"; d.textContent = msg; document.body.appendChild(d);
  setTimeout(() => d.remove(), ms);
}
function modal(html, onMount) {
  const m = document.createElement("div"); m.className = "modal"; m.innerHTML = `<div class="box">${html}</div>`;
  m.addEventListener("click", (e) => { if (e.target === m) close(); });
  const close = () => m.remove();
  document.body.appendChild(m); onMount && onMount(m.firstElementChild, close);
  return close;
}
function confirmBox(msg, yes = t("تأكيد")) {
  return new Promise((res) => modal(`<p style="font-weight:700;margin-bottom:18px">${esc(msg)}</p><div class="row"><button class="btn ghost" data-n>${t("إلغاء")}</button><button class="btn" data-y>${esc(yes)}</button></div>`,
    (b, close) => { $("[data-n]", b).onclick = () => { close(); res(false); }; $("[data-y]", b).onclick = () => { close(); res(true); }; }));
}
function errMsg(e) {
  logError(e, "ui");
  const c = (e && e.code) || "";
  const map = {
    "auth/invalid-credential": "البريد أو كلمة السر غلط", "auth/wrong-password": "البريد أو كلمة السر غلط", "auth/user-not-found": "البريد أو كلمة السر غلط",
    "auth/invalid-login-credentials": "البريد أو كلمة السر غلط",
    "auth/email-already-in-use": "هالبريد مستخدم من قبل", "auth/weak-password": "كلمة السر لازم تكون 6 أحرف أو أكثر",
    "auth/invalid-email": "البريد غير صحيح", "auth/network-request-failed": "ما في إنترنت، جرّب مرة تانية",
    "auth/too-many-requests": "محاولات كتيرة، استنى شوي وجرّب", "permission-denied": "ما عندك صلاحية لهالعملية",
    unavailable: "ما في إنترنت، جرّب مرة تانية"
  };
  return t(map[c] || map[c.replace("firestore/", "")] || "صار خطأ، جرّب مرة تانية");
}
async function busy(btn, fn) {
  const old = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spin" style="width:20px;height:20px;margin:0;border-width:3px"></span>`;
  try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = old; }
}
const fmtDate = (d) => (d ? toDate(d).toLocaleDateString(lang === "ar" ? "ar-SY" : "en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");
const fmtTime = (d) => (d ? toDate(d).toLocaleTimeString(lang === "ar" ? "ar-SY" : "en-GB", { hour: "numeric", minute: "2-digit" }) : "");
const daysLeft = (d) => Math.ceil((toDate(d) - new Date()) / 864e5);
const money = (n) => `${Number(n || 0).toLocaleString("en-US")}$`;
const rand = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");
function waLink(phone, text) { let d = String(phone || "").replace(/\D/g, ""); if (d.startsWith("09")) d = "963" + d.slice(1); else if (d.startsWith("00")) d = d.slice(2); return d ? "https://wa.me/" + d + (text ? "?text=" + encodeURIComponent(text) : "") : ""; }

// تصغير الصور قبل الحفظ (الصور تُحفظ داخل قاعدة البيانات)
function compress(file, maxW = 1200, q = 0.72, type = "image/jpeg") {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, maxW / Math.max(img.width, img.height));
      const c = document.createElement("canvas"); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      const x = c.getContext("2d"); if (type === "image/jpeg") { x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); }
      x.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      let out = c.toDataURL(type, q);
      if (type === "image/webp" && !out.startsWith("data:image/webp")) out = c.toDataURL("image/png");
      let qq = q; while (out.length > 900000 && qq > 0.3) { qq -= 0.1; out = c.toDataURL("image/jpeg", qq); }
      res(out);
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("img")); };
    img.src = url;
  });
}
function pickFile(accept = "image/*", multiple = false) {
  return new Promise((res) => { const i = document.createElement("input"); i.type = "file"; i.accept = accept; i.multiple = multiple; i.onchange = () => res([...i.files]); i.click(); });
}
function qrSvg(text) {
  const q = window.qrcode(0, "M"); q.addData(text); q.make();
  return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
}
const customerUrl = (oid) => new URL(`o.html?r=${S.rid}&o=${oid}`, location.href).href;
const rname = () => (S.R && ((lang === "en" && S.R.nameEn) || S.R.name)) || "";

// الكتابة: إذا ما في نت منكمّل فوراً وبتتزامن لحالها لما يرجع
function write(p) {
  if (!navigator.onLine) { p.catch((e) => console.warn(e)); return Promise.resolve(); }
  return Promise.race([p, new Promise((r) => setTimeout(r, 8000))]);
}
function netBar() {
  const b = $("#netbar"); if (b) b.classList.toggle("hide", navigator.onLine);
}
window.addEventListener("offline", netBar);
window.addEventListener("online", () => { netBar(); flushPush(); });

// ---------- التوجيه ----------
function go(h) { if (location.hash !== h) location.hash = h; else route(); }
window.addEventListener("hashchange", () => route());

function stopAll() { S.unsub.forEach((u) => { try { u(); } catch {} }); S.unsub = []; clearInterval(S.tick); $$(".modal").forEach((m) => m.remove()); }

async function route() {
  stopAll();
  const h = location.hash || "#/";
  if (!configured) return app.innerHTML = `<div class="auth"><div class="logo"><i>🔔</i><b>${t("دورك")}</b></div><div class="note">${t("النظام قيد الإعداد: لازم تضيف إعدادات Firebase بملف config.js")}</div></div>`;
  if (!S.boot) return app.innerHTML = `<div class="spin"></div>`;

  if (h.startsWith("#/admin")) {
    if (!S.user) return viewLogin(true);
    if (!S.isAdmin) return viewClaim();
    return adminShell(h.split("/")[2] || "home");
  }
  if (h === "#/signup") return S.user && S.rid ? go("#/r/cashier") : viewSignup();
  if (h === "#/forgot") return viewForgot();
  if (!S.user) return viewLogin(false);
  if (S.isAdmin && !S.rid) return go("#/admin");
  if (!S.me) return S.user.email?.endsWith("@" + STAFF_DOMAIN) ? viewDisabled() : viewSignup();
  if (!h.startsWith("#/r/")) return go("#/r/cashier");
  return restShell(h.split("/")[2] || "cashier");
}

// ---------- تسجيل الدخول والحساب ----------
let meUnsub = null, rUnsub = null;
async function loadPlatform() { try { const s = await getDoc(doc(db, N.cfg, "platform")); S.plat = platformOf(s.exists() ? s.data() : null); S.platExists = s.exists(); } catch { } }

if (configured) onAuthStateChanged(auth, async (u) => {
  S.user = u; S.me = null; S.rid = null; S.R = null; S.isAdmin = false;
  meUnsub && meUnsub(); rUnsub && rUnsub(); meUnsub = rUnsub = null;
  await loadPlatform();
  if (u) {
    S.isAdmin = S.plat.ownerUid === u.uid; if (S.isAdmin) errCtx.role = "admin";
    try {
      const s = await getDoc(doc(db, N.users, u.uid));
      if (s.exists()) {
        S.me = s.data(); S.rid = S.me.rid; errCtx.rid = S.rid; errCtx.role = S.me.role;
        await new Promise((res) => {
          rUnsub = onSnapshot(doc(db, N.rest, S.rid), (rs) => {
            const first = !S.R; S.R = rs.exists() ? rs.data() : null;
            if (first) res(); else refreshBanner();
          }, () => res());
        });
        // إذا انحذف حساب الكاشير من قبل صاحب المطعم
        meUnsub = onSnapshot(doc(db, N.users, u.uid), (x) => { if (!x.exists() && S.me) { S.me = null; S.rid = null; route(); } }, () => {});
      }
    } catch (e) { console.warn(e); }
  }
  S.boot = true; route();
});
else route();

function authFrame(inner) {
  app.innerHTML = `<div class="auth"><div class="logo"><i>🔔</i><b>${t("دورك")}</b><p class="mute small">${t("جوال زبونك صار جهاز النداء")}</p></div>${inner}
    <p class="switch"><a data-lang>${lang === "ar" ? "English" : "العربية"}</a></p></div>`;
  $("[data-lang]").onclick = () => { setLang(lang === "ar" ? "en" : "ar"); route(); };
}

function viewLogin(admin) {
  const claimable = admin && !S.platExists;
  authFrame(`<div class="card"><h2>${admin ? t("دخول صاحب النظام") : t("تسجيل الدخول")}</h2><div id="er"></div>
    <label class="field"><span>${t("البريد أو اسم المستخدم")}</span><input class="inp" id="em" autocomplete="username" dir="ltr" inputmode="email"></label>
    <label class="field"><span>${t("كلمة السر")}</span><input class="inp" id="pw" type="password" autocomplete="current-password" dir="ltr"></label>
    <button class="btn acc block" id="go">${t("دخول")}</button>
    ${claimable ? `<button class="btn ghost block" id="mk" style="margin-top:10px">${t("إنشاء حساب صاحب النظام")}</button>` : ""}
    </div>
    ${admin ? "" : `<p class="switch">${t("مطعم جديد؟")} <a href="#/signup">${t("جرّب مجاناً {d} أيام", { d: S.plat.trialDays })}</a></p>
    <p class="switch"><a href="#/forgot">${t("نسيت كلمة السر؟")}</a></p>`}`);
  const doLogin = (create) => busy($(create ? "#mk" : "#go"), async () => {
    let em = $("#em").value.trim().toLowerCase(); const pw = $("#pw").value;
    if (em && !em.includes("@")) em = `${em}@${STAFF_DOMAIN}`;
    try {
      if (create) await createUserWithEmailAndPassword(auth, em, pw);
      else await signInWithEmailAndPassword(auth, em, pw);
    } catch (e) { $("#er").innerHTML = `<div class="err">${errMsg(e)}</div>`; }
  });
  $("#go").onclick = () => doLogin(false);
  $("#mk") && ($("#mk").onclick = () => doLogin(true));
  $("#pw").onkeydown = (e) => e.key === "Enter" && doLogin(false);
}

function viewForgot() {
  authFrame(`<div class="card"><h2>${t("استعادة كلمة السر")}</h2><div id="er"></div>
    <label class="field"><span>${t("البريد الإلكتروني")}</span><input class="inp" id="em" dir="ltr" inputmode="email"></label>
    <button class="btn acc block" id="go">${t("أرسل رابط الاستعادة")}</button>
    <p class="mute small" style="margin-top:10px">${t("حسابات الكاشيرية: صاحب المطعم بيعمللك حساب جديد")}</p></div>
    <p class="switch"><a href="#/">${t("رجوع لتسجيل الدخول")}</a></p>`);
  $("#go").onclick = () => busy($("#go"), async () => {
    try { await sendPasswordResetEmail(auth, $("#em").value.trim()); $("#er").innerHTML = `<div class="note">${t("بعتنالك رابط على بريدك")}</div>`; }
    catch (e) { $("#er").innerHTML = `<div class="err">${errMsg(e)}</div>`; }
  });
}

function viewDisabled() {
  authFrame(`<div class="card"><h2>${t("الحساب موقوف")}</h2><p class="mute">${t("صاحب المطعم حذف هالحساب أو أوقفه")}</p>
    <button class="btn block" id="out" style="margin-top:14px">${t("تسجيل خروج")}</button></div>`);
  $("#out").onclick = () => signOut(auth);
}

function viewSignup() {
  const signed = !!S.user;
  authFrame(`<div class="card"><h2>${t("سجّل مطعمك")}</h2>
    <p class="mute small" style="margin-bottom:14px">${t("{d} أيام تجربة مجانية بكل الميزات، بدون أي دفع", { d: S.plat.trialDays })}</p><div id="er"></div>
    <label class="field"><span>${t("اسم المطعم أو الكافيه")}</span><input class="inp" id="rn"></label>
    <label class="field"><span>${t("رقم الجوال (واتساب)")}</span><input class="inp" id="ph" dir="ltr" inputmode="tel" placeholder="09xxxxxxxx"></label>
    ${signed ? "" : `<label class="field"><span>${t("البريد الإلكتروني")}</span><input class="inp" id="em" dir="ltr" inputmode="email" autocomplete="email"></label>
    <label class="field"><span>${t("كلمة السر")}</span><input class="inp" id="pw" type="password" dir="ltr" autocomplete="new-password"></label>`}
    <button class="btn acc block" id="go">${t("ابدأ التجربة المجانية")}</button>
    <p class="mute small" style="margin-top:10px;text-align:center">${t("بتسجيلك بتوافق على")} <a href="legal.html" target="_blank">${t("الشروط وسياسة الخصوصية")}</a></p></div>
    ${signed ? `<p class="switch"><a id="out">${t("تسجيل خروج")}</a></p>` : `<p class="switch">${t("عندك حساب؟")} <a href="#/">${t("دخول")}</a></p>`}`);
  $("#out") && ($("#out").onclick = () => signOut(auth));
  $("#go").onclick = () => busy($("#go"), async () => {
    const name = $("#rn").value.trim(), phone = $("#ph").value.trim();
    if (name.length < 2) return ($("#er").innerHTML = `<div class="err">${t("اكتب اسم المطعم")}</div>`);
    if (phone.replace(/\D/g, "").length < 9) return ($("#er").innerHTML = `<div class="err">${t("اكتب رقم جوال صحيح")}</div>`);
    try {
      let u = auth.currentUser;
      if (!u) u = (await createUserWithEmailAndPassword(auth, $("#em").value.trim().toLowerCase(), $("#pw").value)).user;
      const rref = doc(collection(db, N.rest));
      const b = writeBatch(db);
      b.set(rref, {
        name, nameEn: "", phone, code: rand(5), ownerUid: u.uid, ownerEmail: u.email, plan: "trial", status: "active",
        createdAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + S.plat.trialDays * 864e5),
        color: "#17201B", color2: "#FF7A1A", links: { whatsapp: phone }, branches: [], counters: {}
      });
      b.set(doc(db, N.users, u.uid), { rid: rref.id, role: "owner", name, email: u.email, createdAt: serverTimestamp() });
      await b.commit();
      await sendPush(S.plat.adminPush).catch(() => {});
      location.hash = "#/r/cashier"; location.reload();
    } catch (e) { console.warn(e); $("#er").innerHTML = `<div class="err">${errMsg(e)}</div>`; }
  });
}

async function viewClaim() {
  if (S.platExists) {
    authFrame(`<div class="card"><h2>${t("هالصفحة لصاحب النظام بس")}</h2><button class="btn block" id="out">${t("تسجيل خروج")}</button></div>`);
    return ($("#out").onclick = () => signOut(auth));
  }
  authFrame(`<div class="card"><h2>${t("تفعيل لوحة صاحب النظام")}</h2><p class="mute" style="margin-bottom:14px">${t("رح يصير هالحساب هو صاحب النظام، ومرة وحدة بس:")} <b dir="ltr">${esc(S.user.email)}</b></p>
    <div id="er"></div><button class="btn acc block" id="go">${t("تفعيل")}</button></div>`);
  $("#go").onclick = () => busy($("#go"), async () => {
    try { await setDoc(doc(db, N.cfg, "platform"), { ...platformOf(), ownerUid: S.user.uid }); location.reload(); }
    catch (e) { $("#er").innerHTML = `<div class="err">${errMsg(e)}</div>`; }
  });
}

// ---------- هيكل لوحة المطعم ----------
const isOwner = () => S.me && S.me.role === "owner";
function restTabs() {
  const tabs = [["cashier", "🔔 " + t("الطلبات")]];
  if (isOwner()) tabs.push(["stats", "📊 " + t("الإحصائيات")], ["brand", "🎨 " + t("صفحة الزبون")], ["team", "👥 " + t("الفريق")], ["plan", "💳 " + t("الاشتراك")]);
  return tabs;
}
function shell(tabs, cur, base, who) {
  app.innerHTML = `<div class="shell"><div class="bar"><a class="brand" href="./"><i>🔔</i>${t("دورك")}</a><span class="sp"></span>
    <span class="who">${esc(who)}</span><button data-lang>${lang === "ar" ? "EN" : "ع"}</button><button data-out>${t("خروج")}</button></div>
    ${tabs.length > 1 ? `<nav class="tabs">${tabs.map(([k, l]) => `<a href="${base}${k}" class="${k === cur ? "on" : ""}">${l}</a>`).join("")}</nav>` : ""}
    <main><div id="netbar" class="banner warn hide">📶 ${t("ما في نت. الطلبات عم تنحفظ على الجهاز وبتتزامن لما يرجع")}</div><div id="bn"></div><div id="v"></div></main></div>`;
  $("[data-out]").onclick = async () => { if (await confirmBox(t("بدك تطلع من الحساب؟"), t("خروج"))) { stopAll(); signOut(auth); location.hash = "#/"; } };
  $("[data-lang]").onclick = () => { setLang(lang === "ar" ? "en" : "ar"); route(); };
  netBar();
  return $("#v");
}
function refreshBanner() {
  const bn = $("#bn"); if (!bn || !S.R) return;
  const r = S.R, d = daysLeft(r.expiresAt), act = isActive(r);
  let h = "";
  if (r.status === "stopped") h = `<div class="banner bad">⛔ ${t("الحساب موقوف من الإدارة، تواصل معنا")}</div>`;
  else if (!act) h = `<div class="banner bad">⛔ ${r.plan === "trial" ? t("خلصت التجربة المجانية") : t("خلص الاشتراك")}، ${t("ما بتقدر تعمل طلبات جديدة")}${isOwner() ? `<a class="btn sm" href="#/r/plan">${t("اشترك هلق")}</a>` : ""}</div>`;
  else if (d <= 3) h = `<div class="banner warn">⏳ ${r.plan === "trial" ? t("التجربة بتخلص بعد {d} يوم", { d }) : t("الاشتراك بيخلص بعد {d} يوم", { d })}${isOwner() ? `<a class="btn sm acc" href="#/r/plan">${t("جدّد")}</a>` : ""}</div>`;
  bn.innerHTML = h;
  const nb = $("#newo"); if (nb) nb.disabled = !act;
}
function restShell(tab) {
  if (!S.R) return app.innerHTML = `<div class="spin"></div>`;
  const tabs = restTabs(); if (!tabs.find((x) => x[0] === tab)) tab = "cashier";
  const v = shell(tabs, tab, "#/r/", `${rname()}${isOwner() ? "" : " · " + (S.me.name || "")}`);
  refreshBanner();
  ({ cashier: viewCashier, stats: viewStats, brand: viewBrand, team: viewTeam, plan: viewPlan }[tab])(v);
}

// ---------- الكاشير ----------
function myBranch() {
  const br = S.R.branches || [];
  if (!br.length) return "main";
  if (S.me.branch && br.find((b) => b.id === S.me.branch)) return S.me.branch;
  let x = null; try { x = localStorage.getItem("dawrak-branch-" + S.rid); } catch {}
  return br.find((b) => b.id === x) ? x : br[0].id;
}
const branchName = (id) => ((S.R.branches || []).find((b) => b.id === id) || {}).name || "";

function viewCashier(v) {
  const br = S.R.branches || [];
  const canPick = isOwner() && br.length > 1;
  v.innerHTML = `${canPick ? `<label class="field"><span>${t("الفرع")}</span><select class="inp" id="brs">${br.map((b) => `<option value="${b.id}" ${b.id === myBranch() ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select></label>` : ""}
    <button class="newbtn" id="newo">＋ ${t("طلب جديد")}</button><div id="ol"><div class="spin"></div></div>
    ${IN_APP ? "" : `<p class="mute small" style="text-align:center;margin-top:18px"><a href="${APK_URL}">📱 ${t("نزّل تطبيق أندرويد للكاشير")}</a></p>`}`;
  $("#brs") && ($("#brs").onchange = (e) => { try { localStorage.setItem("dawrak-branch-" + S.rid, e.target.value); } catch {} viewCashier(v); });
  refreshBanner();
  const branch = myBranch();
  let orders = [], doneOpen = false;
  const draw = () => {
    const now = Date.now();
    const mine = orders.filter((o) => (o.branch || "main") === branch);
    const waiting = mine.filter((o) => o.status === "new").sort((a, b) => a.num - b.num);
    const ready = mine.filter((o) => o.status === "ready" && !o.picked);
    const done = mine.filter((o) => o.status === "ready" && o.picked).sort((a, b) => b.num - a.num);
    const rt = (o) => (toDate(o.readyAt) || new Date()).getTime();
    const fresh = ready.filter((o) => now - rt(o) < 5 * 60e3).sort((a, b) => rt(b) - rt(a));
    const old = ready.filter((o) => now - rt(o) >= 5 * 60e3).sort((a, b) => rt(b) - rt(a));
    const row = (o, cls) => {
      const flags = [o.push ? `🔔 ${t("التنبيه مفعّل")}` : "", o.picked ? `✓ ${t("استلم")}` : o.opened ? `📱 ${t("فتح الصفحة")}` : `<span style="color:var(--warn)">${t("ما مسح الرمز بعد")}</span>`, o.rating ? "⭐".repeat(o.rating) : "", o.comment ? "💬" : "", o.calls ? `🔔×${o.calls + 1}` : ""].filter(Boolean).join(" · ");
      return `<div class="ord ${cls}" data-id="${o.id}"><div class="n" data-qr>${o.num}</div>
        <div class="m"><b>${o.status === "ready" ? t("جاهز") + " · " + fmtTime(o.readyAt) : t("بالتحضير") + " · " + fmtTime(o.createdAt)}</b><br>${flags}</div>
        <div class="acts">${o.picked ? "" : o.status === "new" ? `<button class="btn ok" data-ready>✓ ${t("جاهز")}</button>`
          : `<button class="btn sm acc" data-call>🔔 ${t("نادي مرة تانية")}</button><button class="btn sm ok" data-done title="${t("استلم طلبه")}">✓ ${t("استلم")}</button><button class="btn sm ghost" data-undo title="${t("تراجع")}">↩</button>`}</div></div>`;
    };
    $("#ol").innerHTML = !mine.length ? `<div class="empty">${t("ما في طلبات اليوم بعد. اكبس «طلب جديد» لتبلش")}</div>`
      : `${waiting.length ? `<div class="sec-t">${t("بالتحضير")} (${waiting.length})</div><div class="olist">${waiting.map((o) => row(o, "")).join("")}</div>` : ""}
         ${fresh.length ? `<div class="sec-t">${t("جاهز")} (${fresh.length})</div><div class="olist">${fresh.map((o) => row(o, "ready")).join("")}</div>` : ""}
         ${old.length ? `<div class="sec-t">${t("جاهز ولسا ما استلم")} (${old.length})</div><div class="olist">${old.map((o) => row(o, "ready old")).join("")}</div>` : ""}
         ${done.length ? `<details class="done" ${doneOpen ? "open" : ""}><summary class="sec-t" style="cursor:pointer">✓ ${t("طلبات منتهية")} (${done.length})</summary><div class="olist">${done.map((o) => row(o, "ready old")).join("")}</div></details>` : ""}`;
    const d = $("#ol details.done"); if (d) d.ontoggle = () => (doneOpen = d.open);
  };
  $("#ol").onclick = async (e) => {
    const card = e.target.closest(".ord"); if (!card) return;
    const id = card.dataset.id, o = orders.find((x) => x.id === id), ref = doc(db, N.rest, S.rid, "orders", id);
    try {
      if (e.target.closest("[data-ready]")) { await write(updateDoc(ref, { status: "ready", readyAt: serverTimestamp() })); pushTo(o); }
      else if (e.target.closest("[data-call]")) { await write(updateDoc(ref, { calls: increment(1), lastCall: serverTimestamp() })); pushTo(o); toast(t("رنّينا للزبون مرة تانية 🔔")); }
      else if (e.target.closest("[data-done]")) await write(updateDoc(ref, { picked: true }));
      else if (e.target.closest("[data-undo]")) await write(updateDoc(ref, { status: "new", readyAt: null }));
      else if (e.target.closest("[data-qr]")) showQr(o);
    } catch (er) { toast(errMsg(er)); }
  };
  $("#newo").onclick = () => busy($("#newo"), newOrder);
  S.unsub.push(onSnapshot(query(collection(db, N.rest, S.rid, "orders"), where("day", "==", dayKey())), (q) => {
    orders = q.docs.map((d) => ({ id: d.id, ...d.data() })); S.orders = orders; draw();
  }, (e) => { $("#ol").innerHTML = `<div class="err">${errMsg(e)}</div>`; }));
  S.tick = setInterval(draw, 30e3);
  cleanupOld();

  async function newOrder() {
    if (!isActive(S.R)) return toast(t("الاشتراك منتهي"));
    const today = dayKey(), rref = doc(db, N.rest, S.rid), oref = doc(collection(db, N.rest, S.rid, "orders"));
    const base = { branch, day: today, status: "new", calls: 0, createdAt: serverTimestamp(), by: S.user.uid, byName: S.me.name || "" };
    // بدون نت: الرقم من آخر طلب محفوظ على الجهاز، والطلب بيتزامن لما يرجع النت
    const offline = () => {
      const c = (S.R.counters || {})[branch] || {};
      const n = 1 + Math.max(c.d === today ? c.n || 0 : 0, ...orders.filter((o) => (o.branch || "main") === branch).map((o) => o.num || 0));
      setDoc(oref, { ...base, num: n }).catch((e) => console.warn(e));
      updateDoc(rref, { [`counters.${branch}`]: { d: today, n } }).catch(() => {});
      S.R.counters = { ...(S.R.counters || {}), [branch]: { d: today, n } };
      return n;
    };
    try {
      let num;
      if (!navigator.onLine) num = offline();
      else {
        try {
          num = await Promise.race([
            runTransaction(db, async (tx) => {
              const rs = await tx.get(rref), ex = await tx.get(oref);
              if (ex.exists()) return ex.data().num;
              const c = (rs.data().counters || {})[branch] || {};
              const n = c.d === today ? (c.n || 0) + 1 : 1;
              tx.update(rref, { [`counters.${branch}`]: { d: today, n } });
              tx.set(oref, { ...base, num: n });
              return n;
            }),
            new Promise((_, rej) => setTimeout(() => rej({ code: "timeout" }), 6000))
          ]);
        } catch (e) { if (e && e.code === "permission-denied") throw e; num = offline(); }
      }
      showQr({ id: oref.id, num });
    } catch (e) { console.warn(e); toast(errMsg(e)); }
  }
}
// إشعار لجوال الزبون حتى لو الشاشة مقفلة (بيشتغل من تطبيق الكاشير)
let pushWarned = false;
const pendingPush = new Set();
function flushPush() {
  const ids = [...pendingPush]; pendingPush.clear();
  for (const id of ids) { const o = (S.orders || []).find((x) => x.id === id); if (o && o.status === "ready" && !o.picked) pushTo(o); }
}
async function pushTo(o) {
  if (!o || !o.push) return;
  if (!navigator.onLine) { pendingPush.add(o.id); return; }
  const ok = await sendPush(o.push);
  if (!ok && !IN_APP && !pushWarned) { pushWarned = true; toast(t("لتوصل الرنة للزبون وجواله مقفل، استخدم تطبيق الكاشير"), 5000); }
}
// حذف الطلبات الأقدم من 3 أشهر (مرة باليوم، من حساب صاحب المطعم)
async function cleanupOld() {
  if (!isOwner() || !navigator.onLine) return;
  const k = "dawrak-clean-" + S.rid; let last = 0;
  try { last = +localStorage.getItem(k) || 0; } catch {}
  if (Date.now() - last < 864e5) return;
  try { localStorage.setItem(k, String(Date.now())); } catch {}
  try {
    const cutoff = Timestamp.fromMillis(Date.now() - 90 * 864e5);
    for (let i = 0; i < 5; i++) {
      const q = await getDocs(query(collection(db, N.rest, S.rid, "orders"), where("createdAt", "<", cutoff), limit(300)));
      if (q.empty) break;
      const b = writeBatch(db); q.docs.forEach((d) => b.delete(d.ref)); await b.commit();
    }
  } catch (e) { console.warn("cleanup", e); }
}
function showQr(o) {
  const url = customerUrl(o.id);
  modal(`<div class="qrbox"><p class="mute">${t("رقم الطلب")}</p><div class="bign">${o.num}</div><div class="qr" data-url="${esc(url)}">${qrSvg(url)}</div>
    <p style="margin:12px 0 4px;font-weight:700">${t("خلّي الزبون يمسح الرمز بكاميرا جواله")}</p>
    <p class="mute small">${t("رح يرن جواله لما تكبس «جاهز»")}</p>
    <div class="row" style="margin-top:16px"><button class="btn ghost" data-share>${t("مشاركة الرابط")}</button><button class="btn acc" data-ok>${t("تم")}</button></div></div>`,
    (b, close) => {
      $("[data-ok]", b).onclick = close;
      $("[data-share]", b).onclick = async () => {
        try { if (navigator.share) await navigator.share({ title: rname(), text: t("تابع طلبك رقم {n}", { n: o.num }), url }); else { await navigator.clipboard.writeText(url); toast(t("انسخ الرابط")); } } catch {}
      };
    });
}

// ---------- الإحصائيات ----------
async function viewStats(v) {
  const pro = hasPro(S.R.plan);
  v.innerHTML = `<div class="grid" id="kp"><div class="kpi"><b>…</b><span>${t("طلبات اليوم")}</span></div></div><div id="pro"><div class="spin"></div></div>`;
  const col = collection(db, N.rest, S.rid, "orders");
  const now = new Date(), monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  try {
    const [today, month] = await Promise.all([
      getCountFromServer(query(col, where("day", "==", dayKey()))),
      getCountFromServer(query(col, where("createdAt", ">=", Timestamp.fromDate(monthStart))))
    ]);
    $("#kp").innerHTML = `<div class="kpi"><b>${today.data().count}</b><span>${t("طلبات اليوم")}</span></div><div class="kpi"><b>${month.data().count}</b><span>${t("طلبات هالشهر")}</span></div>`;
  } catch (e) { $("#kp").innerHTML = `<div class="err">${errMsg(e)}</div>`; }

  loadComments(v, col);
  if (!pro) {
    $("#pro").innerHTML = `<div class="card lock" style="min-height:260px"><div class="veil"><div style="font-size:34px">📊</div><b>${t("الإحصائيات المفصّلة بالباقة المفتوحة")}</b>
      <p class="mute small">${t("أوقات الذروة، مدة التحضير، مقارنة الأيام، التقييمات وأداء كل كاشير")}</p><a class="btn acc" href="#/r/plan">${t("رقّي باقتك")}</a></div>
      <h2>${t("أوقات الذروة")}</h2><div class="bars">${Array.from({ length: 14 }, (_, i) => `<div style="height:${20 + ((i * 37) % 70)}%"></div>`).join("")}</div></div>`;
    return;
  }
  let docs = [];
  try {
    const since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
    const q = await getDocs(query(col, where("createdAt", ">=", Timestamp.fromDate(since)), orderBy("createdAt"), limit(8000)));
    docs = q.docs.map((d) => d.data());
  } catch (e) { return ($("#pro").innerHTML = `<div class="err">${errMsg(e)}</div>`); }
  const br = S.R.branches || [];
  let sel = "all";
  const draw = () => {
    const D = sel === "all" ? docs : docs.filter((o) => (o.branch || "main") === sel);
    const byDay = {}, byHour = Array(24).fill(0), byWd = Array(7).fill(0), wdDays = Array(7).fill(0), byCashier = {};
    let prepSum = 0, prepN = 0, rSum = 0, rN = 0, todayPrep = 0, todayPrepN = 0;
    const tk = dayKey();
    for (const o of D) {
      const c = toDate(o.createdAt); if (!c) continue;
      byDay[o.day || dayKey(c)] = (byDay[o.day || dayKey(c)] || 0) + 1; byHour[c.getHours()]++;
      byCashier[o.byName || "—"] = (byCashier[o.byName || "—"] || 0) + 1;
      const r = toDate(o.readyAt);
      if (r && r > c) { const m = (r - c) / 60e3; if (m < 240) { prepSum += m; prepN++; if (o.day === tk) { todayPrep += m; todayPrepN++; } } }
      if (o.rating) { rSum += o.rating; rN++; }
    }
    const days = [];
    for (let i = 13; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i); days.push([d, byDay[dayKey(d)] || 0]); }
    for (let i = 0; i < 30; i++) { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i); wdDays[d.getDay()]++; byWd[d.getDay()] += byDay[dayKey(d)] || 0; }
    const maxD = Math.max(1, ...days.map((x) => x[1])), maxH = Math.max(1, ...byHour);
    const peak = byHour.indexOf(Math.max(...byHour));
    const yest = days[12][1], tod = days[13][1], lastWeek = days[6][1];
    const wdN = lang === "ar" ? ["أحد", "اثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"] : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const wdAvg = byWd.map((s, i) => (wdDays[i] ? s / wdDays[i] : 0)), maxW = Math.max(1, ...wdAvg);
    const hrs = Array.from({ length: 24 }, (_, i) => i).filter((h) => byHour[h] > 0 || (h >= 8 && h <= 23));
    const diff = (a, b) => (b ? `${a >= b ? "▲" : "▼"} ${Math.abs(Math.round(((a - b) / b) * 100))}%` : "—");
    $("#pro").innerHTML = `
      ${br.length > 1 ? `<div class="seg" id="bsel"><button data-b="all" class="${sel === "all" ? "on" : ""}">${t("كل الفروع")}</button>${br.map((b) => `<button data-b="${b.id}" class="${sel === b.id ? "on" : ""}">${esc(b.name)}</button>`).join("")}</div>` : ""}
      <div class="grid" style="margin:12px 0">
        <div class="kpi"><b>${prepN ? Math.round(prepSum / prepN) : "—"}<small style="font-size:14px"> ${t("د")}</small></b><span>${t("متوسط مدة التحضير")}</span></div>
        <div class="kpi"><b>${todayPrepN ? Math.round(todayPrep / todayPrepN) : "—"}<small style="font-size:14px"> ${t("د")}</small></b><span>${t("مدة التحضير اليوم")}</span></div>
        <div class="kpi"><b>${rN ? (rSum / rN).toFixed(1) + "★" : "—"}</b><span>${t("التقييم")} (${rN})</span></div>
        <div class="kpi"><b>${peak}:00</b><span>${t("ساعة الذروة")}</span></div>
      </div>
      <div class="card"><h2>${t("مقارنة")}</h2><div class="grid">
        <div><b style="font-size:24px">${tod}</b><div class="mute small">${t("اليوم")}</div></div>
        <div><b style="font-size:24px">${yest}</b><div class="mute small">${t("مبارح")} · ${diff(tod, yest)}</div></div>
        <div><b style="font-size:24px">${lastWeek}</b><div class="mute small">${t("نفس اليوم الأسبوع الماضي")} · ${diff(tod, lastWeek)}</div></div></div></div>
      <div class="card"><h2>${t("الطلبات آخر 14 يوم")}</h2><div class="bars">${days.map(([d, n], i) => `<div class="${i < 13 ? "dim" : ""}" style="height:${(n / maxD) * 100}%"><span>${n || ""}</span></div>`).join("")}</div>
        <div class="axis">${days.map(([d]) => `<span>${d.getDate()}</span>`).join("")}</div></div>
      <div class="card"><h2>${t("أوقات الذروة")}</h2><div class="bars">${hrs.map((h) => `<div class="${h === peak ? "" : "dim"}" style="height:${(byHour[h] / maxH) * 100}%"><span>${byHour[h] || ""}</span></div>`).join("")}</div>
        <div class="axis">${hrs.map((h) => `<span>${h}</span>`).join("")}</div></div>
      <div class="card"><h2>${t("متوسط الطلبات حسب اليوم")}</h2><div class="bars">${wdAvg.map((a) => `<div class="${a === maxW ? "" : "dim"}" style="height:${(a / maxW) * 100}%"><span>${a ? a.toFixed(0) : ""}</span></div>`).join("")}</div>
        <div class="axis">${wdN.map((n) => `<span>${n}</span>`).join("")}</div></div>
      <div class="card"><h2>${t("أداء الكاشيرية (30 يوم)")}</h2><div class="list">${Object.entries(byCashier).sort((a, b) => b[1] - a[1]).map(([n, c]) => `<div class="row" style="justify-content:space-between"><b>${esc(n)}</b><span>${c}</span></div>`).join("") || `<p class="mute">—</p>`}</div></div>`;
    $$("#bsel button").forEach((b) => (b.onclick = () => { sel = b.dataset.b; draw(); }));
  };
  draw();
}

async function loadComments(v, col) {
  const box = document.createElement("div"); box.className = "card"; v.appendChild(box);
  box.innerHTML = `<h2>💬 ${t("ملاحظات الزبائن")}</h2><div class="spin"></div>`;
  try {
    const q = await getDocs(query(col, where("comment", ">", ""), limit(60)));
    const cs = q.docs.map((d) => d.data()).sort((a, b) => (toDate(b.createdAt) || 0) - (toDate(a.createdAt) || 0)).slice(0, 30);
    box.innerHTML = `<h2>💬 ${t("ملاحظات الزبائن")}</h2><div class="list">${cs.map((o) => `<div style="border-bottom:1px solid var(--line);padding-bottom:8px">
      <div class="small mute">${o.rating ? "⭐".repeat(o.rating) + " · " : ""}#${o.num} · ${fmtDate(o.createdAt)}</div><div>${esc(o.comment)}</div></div>`).join("") || `<p class="mute small">${t("لسا ما في ملاحظات")}</p>`}</div>`;
  } catch (e) { box.innerHTML = `<h2>💬 ${t("ملاحظات الزبائن")}</h2><p class="mute small">${errMsg(e)}</p>`; }
}

// ---------- تخصيص صفحة الزبون ----------
async function viewBrand(v) {
  const r = S.R, L = r.links || {};
  v.innerHTML = `<div class="card"><h2>${t("هوية المطعم")}</h2>
      <div class="row" style="align-items:flex-start;margin-bottom:14px"><div style="flex:none;text-align:center">
        <div id="lg" style="width:84px;height:84px;border-radius:22px;background:#f3efe8 center/cover no-repeat;${r.logo ? `background-image:url('${r.logo}')` : ""};display:grid;place-items:center;font-size:28px">${r.logo ? "" : "🏪"}</div>
        <button class="btn sm ghost" id="lgb" style="margin-top:8px">${t("اللوغو")}</button></div>
        <div><label class="field"><span>${t("الاسم بالعربي")}</span><input class="inp" id="n1" value="${esc(r.name)}"></label>
        <label class="field"><span>${t("الاسم بالإنكليزي")}</span><input class="inp" id="n2" dir="ltr" value="${esc(r.nameEn)}"></label></div></div>
      <div class="colors"><label class="field"><span>${t("اللون الأساسي")}</span><input type="color" id="c1" value="${esc(r.color || "#17201B")}"></label>
        <label class="field"><span>${t("لون التمييز")}</span><input type="color" id="c2" value="${esc(r.color2 || "#FF7A1A")}"></label></div>
      <h3 style="margin-top:6px">${t("روابط المطعم")}</h3>
      <div class="grid">${[["instagram", "إنستغرام", "@yourcafe"], ["whatsapp", "واتساب", "09xxxxxxxx"], ["facebook", "فيسبوك", "facebook.com/..."], ["maps", "الموقع", "Damascus, Mazzeh"]].map(([k, l, p]) =>
        `<label class="field"><span>${t(l)}</span><input class="inp" data-l="${k}" dir="ltr" placeholder="${p}" value="${esc(L[k] || "")}"></label>`).join("")}</div>
      <div class="row"><button class="btn acc" id="sv">${t("حفظ")}</button><a class="btn ghost" id="pv" target="_blank">👁 ${t("معاينة صفحة الزبون")}</a></div></div>
    <div class="card"><h2>🔥 ${t("العروض")}</h2><p class="mute small" style="margin-bottom:12px">${t("بتظهر للزبون وهو عم يستنى طلبه")}</p><div id="ofs" class="list"></div>
      <button class="btn ghost" id="addof" style="margin-top:12px">＋ ${t("أضف عرض")}</button></div>
    <div class="card"><h2>📋 ${t("المنيو")}</h2><p class="mute small" style="margin-bottom:12px">${t("ارفع صور المنيو، بتظهر للزبون بالترتيب")}</p><div class="imgs" id="mn"></div>
      <button class="btn ghost" id="addmn">＋ ${t("أضف صور")}</button></div>`;
  let logo = r.logo || "";
  $("#lgb").onclick = async () => {
    const [f] = await pickFile(); if (!f) return;
    logo = await compress(f, 256, 0.85, "image/webp");
    $("#lg").style.backgroundImage = `url('${logo}')`; $("#lg").textContent = "";
  };
  $("#sv").onclick = () => busy($("#sv"), async () => {
    const links = {}; $$("[data-l]").forEach((i) => (links[i.dataset.l] = i.value.trim()));
    try {
      await updateDoc(doc(db, N.rest, S.rid), { name: $("#n1").value.trim() || r.name, nameEn: $("#n2").value.trim(), color: $("#c1").value, color2: $("#c2").value, links, logo });
      toast(t("انحفظ ✓"));
    } catch (e) { toast(errMsg(e)); }
  });
  // معاينة: طلب تجريبي
  $("#pv").onclick = async (e) => {
    e.preventDefault();
    try {
      const ref = doc(db, N.rest, S.rid, "orders", "preview");
      await setDoc(ref, { num: 27, branch: "preview", day: "preview", status: "new", calls: 0, createdAt: Timestamp.fromMillis(0), by: S.user.uid, byName: "preview" });
      window.open(customerUrl("preview"), "_blank");
    } catch (er) { toast(errMsg(er)); }
  };

  const mcol = collection(db, N.rest, S.rid, "media");
  let media = [];
  const drawMedia = () => {
    const ofs = media.filter((m) => m.kind === "offer"), mn = media.filter((m) => m.kind === "menu");
    $("#ofs").innerHTML = ofs.map((o) => `<div class="item">${o.data ? `<img class="thumb" src="${o.data}">` : `<div class="thumb"></div>`}<div class="grow"><div class="t">${esc(o.title)}</div><div class="mute small">${esc(o.text || "")}</div></div><button class="btn sm bad" data-del="${o.id}">${t("حذف")}</button></div>`).join("") || `<p class="mute small">${t("ما في عروض")}</p>`;
    $("#mn").innerHTML = mn.map((m) => `<div class="im"><img src="${m.data}"><button data-del="${m.id}">✕</button></div>`).join("");
  };
  const load = async () => {
    const q = await getDocs(query(mcol, orderBy("order"))); media = q.docs.map((d) => ({ id: d.id, ...d.data() })); drawMedia();
    const has = media.some((m) => m.kind === "menu");
    if (!!S.R.hasMenu !== has) updateDoc(doc(db, N.rest, S.rid), { hasMenu: has }).catch(() => {});
  };
  load().catch((e) => toast(errMsg(e)));
  v.addEventListener("click", async (e) => {
    const id = e.target.closest("[data-del]")?.dataset.del; if (!id) return;
    if (!(await confirmBox(t("متأكد بدك تحذف؟"), t("حذف")))) return;
    try { await deleteDoc(doc(mcol, id)); await load(); } catch (er) { toast(errMsg(er)); }
  });
  $("#addmn").onclick = async () => {
    const fs = await pickFile("image/*", true); if (!fs.length) return;
    if (media.filter((m) => m.kind === "menu").length + fs.length > 8) return toast(t("الحد الأقصى 8 صور للمنيو"));
    toast(t("عم نرفع الصور…"));
    try { let i = 0; for (const f of fs) await setDoc(doc(mcol), { kind: "menu", data: await compress(f, 1100, 0.6), order: Date.now() + i++ }); await load(); toast(t("انحفظ ✓")); }
    catch (er) { toast(errMsg(er)); }
  };
  $("#addof").onclick = () => modal(`<h2 style="margin-bottom:12px">${t("عرض جديد")}</h2>
      <label class="field"><span>${t("عنوان العرض")}</span><input class="inp" id="ot" placeholder="${t("مثلاً: قهوتين بسعر وحدة")}"></label>
      <label class="field"><span>${t("التفاصيل (اختياري)")}</span><textarea class="inp" id="ox"></textarea></label>
      <button class="btn ghost block" id="oi">🖼 ${t("صورة (اختياري)")}</button><img id="op" style="display:none;border-radius:12px;margin-top:10px">
      <div class="row" style="margin-top:16px"><button class="btn ghost" data-x>${t("إلغاء")}</button><button class="btn acc" id="os">${t("إضافة")}</button></div>`,
    (b, close) => {
      let img = "";
      $("[data-x]", b).onclick = close;
      $("#oi", b).onclick = async () => { const [f] = await pickFile(); if (!f) return; img = await compress(f, 700, 0.6); $("#op", b).src = img; $("#op", b).style.display = "block"; };
      $("#os", b).onclick = () => busy($("#os", b), async () => {
        const title = $("#ot", b).value.trim(); if (!title) return toast(t("اكتب عنوان العرض"));
        try { await setDoc(doc(mcol), { kind: "offer", title, text: $("#ox", b).value.trim(), data: img, order: Date.now() }); close(); await load(); }
        catch (er) { toast(errMsg(er)); }
      });
    });
}

// ---------- الفريق والفروع ----------
async function viewTeam(v) {
  const plan = S.R.plan, pro = hasPro(plan);
  const max = plan === "trial" ? 999 : (S.plat.plans[plan] || {}).cashiers || 1;
  v.innerHTML = `<div class="card"><h2>👥 ${t("الكاشيرية")}</h2><p class="mute small" style="margin-bottom:12px" id="lim"></p><div class="list" id="st"><div class="spin"></div></div>
    <button class="btn acc" id="add" style="margin-top:12px">＋ ${t("أضف كاشير")}</button></div>
    <div class="card"><h2>🏬 ${t("الفروع")}</h2>${pro ? `<p class="mute small" style="margin-bottom:12px">${t("كل فرع إله ترقيم طلبات وإحصائيات خاصة")}</p><div class="list" id="brl"></div>
      <div class="row" style="margin-top:12px"><input class="inp" id="brn" placeholder="${t("اسم الفرع")}"><button class="btn" id="bra" style="flex:none">${t("إضافة")}</button></div>`
      : `<p class="mute">${t("الفروع المتعددة بالباقة المفتوحة")}</p><a class="btn ghost" href="#/r/plan" style="margin-top:10px">${t("رقّي باقتك")}</a>`}</div>`;
  let staff = [];
  const load = async () => {
    const q = await getDocs(query(collection(db, N.users), where("rid", "==", S.rid)));
    staff = q.docs.map((d) => ({ id: d.id, ...d.data() })).filter((x) => x.role === "cashier");
    $("#lim").textContent = max >= 999 ? t("عدد مفتوح من الكاشيرية") : t("باقتك بتسمح بـ {m} كاشير (مستخدم {u})", { m: max, u: staff.length });
    $("#st").innerHTML = staff.map((s) => `<div class="item"><div class="grow"><div class="t">${esc(s.name)}</div><div class="mute small">${t("اسم الدخول")}: <b dir="ltr">${esc(s.login)}</b>${s.branch ? " · " + esc(branchName(s.branch)) : ""}</div></div>
      <button class="btn sm bad" data-rm="${s.id}">${t("حذف")}</button></div>`).join("") || `<p class="mute small">${t("لسا ما أضفت كاشيرية. أنت كصاحب مطعم بتقدر تشتغل كاشير من حسابك.")}</p>`;
  };
  load().catch((e) => ($("#st").innerHTML = `<div class="err">${errMsg(e)}</div>`));
  $("#st").onclick = async (e) => {
    const id = e.target.closest("[data-rm]")?.dataset.rm; if (!id) return;
    if (!(await confirmBox(t("بدك تحذف هالكاشير؟ ما رح يقدر يدخل بعدها"), t("حذف")))) return;
    try { await deleteDoc(doc(db, N.users, id)); await load(); } catch (er) { toast(errMsg(er)); }
  };
  $("#add").onclick = () => {
    if (staff.length >= max) return toast(t("وصلت للحد الأقصى بباقتك، رقّي الباقة لتضيف أكثر"));
    const br = S.R.branches || [];
    modal(`<h2 style="margin-bottom:12px">${t("كاشير جديد")}</h2><div id="er"></div>
      <label class="field"><span>${t("الاسم")}</span><input class="inp" id="sn"></label>
      <label class="field"><span>${t("اسم الدخول (أحرف إنكليزية وأرقام)")}</span><div class="row" dir="ltr"><input class="inp" id="su" autocapitalize="none" placeholder="ahmad"><span style="flex:none" class="mute">.${esc(S.R.code)}</span></div></label>
      <label class="field"><span>${t("كلمة السر (6 أحرف أو أكثر)")}</span><input class="inp" id="sp" dir="ltr"></label>
      ${pro && br.length ? `<label class="field"><span>${t("الفرع")}</span><select class="inp" id="sb">${br.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join("")}</select></label>` : ""}
      <div class="row"><button class="btn ghost" data-x>${t("إلغاء")}</button><button class="btn acc" id="ss">${t("إنشاء")}</button></div>`,
      (b, close) => {
        $("[data-x]", b).onclick = close;
        $("#ss", b).onclick = () => busy($("#ss", b), async () => {
          const name = $("#sn", b).value.trim(), u = $("#su", b).value.trim().toLowerCase(), pw = $("#sp", b).value;
          if (!name || !/^[a-z0-9_]{3,20}$/.test(u)) return ($("#er", b).innerHTML = `<div class="err">${t("اكتب الاسم واسم دخول من 3 أحرف إنكليزية أو أكثر")}</div>`);
          const login = `${u}.${S.R.code}`;
          try {
            const uid = await createStaffAccount(`${login}@${STAFF_DOMAIN}`, pw);
            await setDoc(doc(db, N.users, uid), { rid: S.rid, role: "cashier", name, login, branch: $("#sb", b)?.value || "", createdAt: serverTimestamp() });
            close(); await load();
            modal(`<h2>✓ ${t("تم إنشاء الحساب")}</h2><p class="mute" style="margin:10px 0">${t("بيانات دخول الكاشير:")}</p>
              <div class="card" dir="ltr" style="box-shadow:none;background:var(--bg)"><b>${esc(login)}</b><br>${esc(pw)}</div>
              <button class="btn block" data-c>${t("تم")}</button>`, (bb, cl) => ($("[data-c]", bb).onclick = cl));
          } catch (er) { $("#er", b).innerHTML = `<div class="err">${er.code === "auth/email-already-in-use" ? t("اسم الدخول مستخدم، اختار غيره") : errMsg(er)}</div>`; }
        });
      });
  };
  if (pro) {
    const drawBr = () => {
      const br = S.R.branches || [];
      $("#brl").innerHTML = br.map((b) => `<div class="item"><div class="grow t">${esc(b.name)}</div><button class="btn sm bad" data-rb="${b.id}">${t("حذف")}</button></div>`).join("") || `<p class="mute small">${t("فرع واحد (الرئيسي)")}</p>`;
    };
    drawBr();
    $("#bra").onclick = () => busy($("#bra"), async () => {
      const name = $("#brn").value.trim(); if (!name) return;
      const br = [...(S.R.branches || [])];
      if (!br.length) br.push({ id: "main", name: t("الفرع الرئيسي") });
      br.push({ id: rand(6), name });
      try { await updateDoc(doc(db, N.rest, S.rid), { branches: br }); S.R.branches = br; $("#brn").value = ""; drawBr(); } catch (e) { toast(errMsg(e)); }
    });
    $("#brl").onclick = async (e) => {
      const id = e.target.closest("[data-rb]")?.dataset.rb; if (!id) return;
      if (!(await confirmBox(t("بدك تحذف هالفرع؟"), t("حذف")))) return;
      let br = (S.R.branches || []).filter((b) => b.id !== id); if (br.length === 1 && br[0].id === "main") br = [];
      try { await updateDoc(doc(db, N.rest, S.rid), { branches: br }); S.R.branches = br; drawBr(); } catch (er) { toast(errMsg(er)); }
    };
  }
}

// ---------- الاشتراك والدفع ----------
async function viewPlan(v) {
  const r = S.R, P = S.plat, act = isActive(r);
  let period = "m", plan = r.plan !== "trial" ? r.plan : "basic";
  v.innerHTML = `<div class="card"><h2>${t("اشتراكك الحالي")}</h2>
      <div class="row" style="flex-wrap:wrap"><div><span class="pill ${act ? "ok" : "bad"}">${act ? t("فعّال") : t("منتهي")}</span> <b style="font-size:18px">${planName(r.plan)}</b></div>
      <div class="mute">${act ? t("ينتهي {d} (بعد {n} يوم)", { d: fmtDate(r.expiresAt), n: daysLeft(r.expiresAt) }) : t("انتهى {d}", { d: fmtDate(r.expiresAt) })}</div></div>
      <p class="mute small" style="margin-top:8px">${t("رمز المطعم")}: <b dir="ltr">${esc(r.code)}</b></p></div>
    <div id="pend"></div>
    <div class="card"><h2>${act && r.plan !== "trial" ? t("جدّد أو غيّر باقتك") : t("اختار باقتك")}</h2>
      <div class="seg"><button data-p="m" class="on">${t("شهري")}</button><button data-p="y">${t("سنوي")} <span class="pill acc">${t("شهرين مجاناً")}</span></button></div>
      <div class="plans" id="pl"></div></div>
    <div class="card"><h2>${t("الدفع عبر شام كاش")}</h2>
      ${P.shamcash.qr ? `<div style="text-align:center;margin-bottom:12px"><img src="${P.shamcash.qr}" alt="QR" style="width:min(70vw,260px);border-radius:16px;border:1px solid var(--line);background:#fff;padding:8px"><p class="mute small">${t("امسح الرمز من تطبيق شام كاش")}</p></div>` : ""}
      <ol style="padding-inline-start:20px;line-height:2">
        <li>${t("حوّل المبلغ")} <b id="amt"></b>${P.shamcash.account || !P.shamcash.qr ? ` ${t("على حساب شام كاش:")} <b dir="ltr">${esc(P.shamcash.account || "—")}</b>` : ""}${P.shamcash.name ? ` (${esc(P.shamcash.name)})` : ""}</li>
        <li>${t("صوّر إيصال التحويل")}</li><li>${t("ارفع الصورة هون، ومنفعّل اشتراكك خلال ساعات")}</li></ol>
      <div id="er"></div><button class="btn ghost block" id="rc" style="margin-top:10px">📷 ${t("ارفع صورة الإيصال")}</button><img id="rcp" style="display:none;max-height:260px;margin:10px auto;border-radius:12px">
      <button class="btn acc block" id="send" style="margin-top:10px" disabled>${t("أرسل للمراجعة")}</button>
      ${P.whatsapp ? `<p class="small mute" style="margin-top:12px;text-align:center"><a href="${waLink(P.whatsapp)}" target="_blank">💬 ${t("عندك سؤال؟ راسلنا واتساب")}</a></p>` : ""}</div>
    <div class="card"><h2>${t("سجل الدفعات")}</h2><div id="hist" class="list"></div></div>`;
  const feats = (k) => {
    const c = P.plans[k].cashiers;
    return `<li>${c >= 999 ? t("عدد مفتوح من الكاشيرية") : t("{n} كاشير", { n: c })}</li><li>${t("نداء الزبون وتنبيه")}</li><li>${t("لوغو وألوان وعروض ومنيو")}</li>
      <li class="${k === "unlimited" ? "" : "no"}">${t("إحصائيات مفصّلة")}</li><li class="${k === "unlimited" ? "" : "no"}">${t("فروع متعددة")}</li>`;
  };
  const drawPlans = () => {
    $("#pl").innerHTML = ["basic", "duo", "unlimited"].map((k) => `<div class="plan ${k === plan ? "on" : ""}" data-k="${k}"><b>${planName(k)}</b>
      <div class="pr">${money(P.plans[k][period])}<small>/${period === "m" ? t("شهر") : t("سنة")}</small></div><ul>${feats(k)}</ul></div>`).join("");
    $("#amt").textContent = money(P.plans[plan][period]);
  };
  drawPlans();
  $$(".seg button", v).forEach((b) => (b.onclick = () => { period = b.dataset.p; $$(".seg button", v).forEach((x) => x.classList.toggle("on", x === b)); drawPlans(); }));
  $("#pl").onclick = (e) => { const k = e.target.closest("[data-k]")?.dataset.k; if (k) { plan = k; drawPlans(); } };
  let img = "";
  $("#rc").onclick = async () => { const [f] = await pickFile(); if (!f) return; img = await compress(f, 1100, 0.7); $("#rcp").src = img; $("#rcp").style.display = "block"; $("#send").disabled = false; };
  $("#send").onclick = () => busy($("#send"), async () => {
    try {
      await setDoc(doc(collection(db, N.pay)), { rid: S.rid, rname: r.name, phone: r.phone || "", plan, period, amount: P.plans[plan][period], img, status: "pending", createdAt: serverTimestamp(), by: S.user.uid });
      img = ""; $("#rcp").style.display = "none"; loadHist();
      sendPush(P.adminPush).catch(() => {});
      const wa = waLink(P.whatsapp, t("مرحباً، رفعت إيصال اشتراك دورك لمطعم {r}: باقة {p} ({a}). رمز المطعم {c}", { r: r.name, p: planName(plan) + " · " + (period === "y" ? t("سنوي") : t("شهري")), a: money(P.plans[plan][period]), c: r.code }));
      modal(`<div style="text-align:center"><div style="font-size:44px">✅</div><h2>${t("وصلنا الإيصال")}</h2><p class="mute" style="margin:8px 0 16px">${t("رح نفعّل اشتراكك بعد المراجعة")}</p>
        ${wa ? `<a class="btn ok block" href="${wa}" target="_blank" style="margin-bottom:10px">💬 ${t("بلّغنا على واتساب لتفعيل أسرع")}</a>` : ""}<button class="btn ghost block" data-c>${t("تم")}</button></div>`, (b, c) => ($("[data-c]", b).onclick = c));
    } catch (e) { $("#er").innerHTML = `<div class="err">${errMsg(e)}</div>`; }
  });
  const ST = { pending: ["warn", "قيد المراجعة"], approved: ["ok", "مقبول"], rejected: ["bad", "مرفوض"] };
  const loadHist = async () => {
    try {
      const q = await getDocs(query(collection(db, N.pay), where("rid", "==", S.rid)));
      const ps = q.docs.map((d) => d.data()).sort((a, b) => (toDate(b.createdAt) || 0) - (toDate(a.createdAt) || 0));
      $("#hist").innerHTML = ps.map((p) => `<div class="row" style="justify-content:space-between;flex-wrap:wrap"><span>${fmtDate(p.createdAt)} · ${planName(p.plan)} · ${p.period === "y" ? t("سنوي") : t("شهري")}</span><span><b>${money(p.amount)}</b> <span class="pill ${ST[p.status][0]}">${t(ST[p.status][1])}</span></span>${p.note ? `<div class="mute small" style="flex-basis:100%">${esc(p.note)}</div>` : ""}</div>`).join("") || `<p class="mute small">—</p>`;
      const pend = ps.find((p) => p.status === "pending");
      $("#pend").innerHTML = pend ? `<div class="banner warn">⏳ ${t("عندك دفعة قيد المراجعة ({a})، رح نفعّلها قريباً", { a: money(pend.amount) })}</div>` : "";
    } catch (e) { $("#hist").innerHTML = `<div class="err">${errMsg(e)}</div>`; }
  };
  loadHist();
}

// ---------- لوحة صاحب النظام ----------
function adminShell(tab) {
  const tabs = [["home", "📈 " + t("نظرة عامة")], ["pay", "💳 " + t("الدفعات")], ["rest", "🏪 " + t("المطاعم")], ["errors", "⚠️ " + t("الأعطال")], ["settings", "⚙️ " + t("الإعدادات")]];
  if (!tabs.find((x) => x[0] === tab)) tab = "home";
  const v = shell(tabs, tab, "#/admin/", t("صاحب النظام"));
  ({ home: adminHome, pay: adminPay, rest: adminRest, errors: adminErrors, settings: adminSettings }[tab])(v);
}
async function allRest() { const q = await getDocs(collection(db, N.rest)); return q.docs.map((d) => ({ id: d.id, ...d.data() })); }
async function allPay() { const q = await getDocs(collection(db, N.pay)); return q.docs.map((d) => ({ id: d.id, ...d.data() })); }

async function adminErrors(v) {
  v.innerHTML = `<div class="spin"></div>`;
  let docs = [];
  const load = async () => {
    const [q, rs] = await Promise.all([getDocs(query(collection(db, N.err), orderBy("at", "desc"), limit(400))), allRest()]);
    docs = q.docs; const names = Object.fromEntries(rs.map((r) => [r.id, r.name]));
    // نجمع الأخطاء المتشابهة
    const g = new Map();
    for (const d of docs) { const e = d.data(); const k = e.msg; if (!g.has(k)) g.set(k, { e, n: 0, rids: new Set(), last: e.at }); const x = g.get(k); x.n++; if (e.rid) x.rids.add(names[e.rid] || e.rid); }
    const where = (e) => [e.page, e.role && t({ owner: "صاحب مطعم", cashier: "كاشير", customer: "زبون", admin: "صاحب النظام" }[e.role] || e.role), e.app ? t("التطبيق") : t("المتصفح"), e.online === false ? t("بدون نت") : ""].filter(Boolean).join(" · ");
    v.innerHTML = `<div class="row" style="margin-bottom:12px;justify-content:space-between"><p class="mute small">${t("آخر {n} عطل، الأخطاء المتشابهة مجمّعة", { n: docs.length })}</p>
      ${docs.length ? `<button class="btn sm bad" id="clr" style="flex:none">${t("مسح الكل")}</button>` : ""}</div>
      <div class="list">${[...g.values()].map(({ e, n, rids, last }) => `<div class="item" style="display:block"><div class="row" style="justify-content:space-between;align-items:flex-start">
        <div class="t" dir="ltr" style="text-align:start;word-break:break-word">${esc(e.msg)}</div><span class="pill ${n > 3 ? "bad" : "warn"}" style="flex:none">×${n}</span></div>
        <div class="mute small" style="margin-top:4px">${fmtDate(last)} ${fmtTime(last)} · ${esc(where(e))}${rids.size ? " · 🏪 " + esc([...rids].slice(0, 4).join("، ")) : ""}</div>
        ${e.stack ? `<details style="margin-top:6px"><summary class="small mute" style="cursor:pointer">${t("التفاصيل")}</summary><pre dir="ltr" style="white-space:pre-wrap;font-size:11px;background:var(--bg);padding:8px;border-radius:10px;margin-top:6px;overflow:auto">${esc(e.stack)}\n\n${esc(e.ua)}</pre></details>` : ""}</div>`).join("")
        || `<div class="empty">✅ ${t("ما في أعطال")}</div>`}</div>`;
    $("#clr") && ($("#clr").onclick = async () => {
      if (!(await confirmBox(t("بدك تمسح كل الأعطال المسجّلة؟"), t("مسح")))) return;
      try { for (let i = 0; i < docs.length; i += 400) { const b = writeBatch(db); docs.slice(i, i + 400).forEach((d) => b.delete(d.ref)); await b.commit(); } await load(); } catch (er) { toast(errMsg(er)); }
    });
  };
  try { await load(); } catch (e) { v.innerHTML = `<div class="err">${errMsg(e)}</div>`; }
}

async function adminHome(v) {
  v.innerHTML = `<div class="spin"></div>`;
  let errN = 0;
  try { errN = (await getCountFromServer(query(collection(db, N.err), where("at", ">=", Timestamp.fromMillis(Date.now() - 864e5))))).data().count; } catch {}
  try {
    const [rs, ps] = await Promise.all([allRest(), allPay()]);
    const now = new Date(), m0 = new Date(now.getFullYear(), now.getMonth(), 1), m1 = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const paid = rs.filter((r) => isActive(r) && r.plan !== "trial"), trial = rs.filter((r) => isActive(r) && r.plan === "trial"), dead = rs.filter((r) => !isActive(r));
    const ap = ps.filter((p) => p.status === "approved");
    const sum = (a, b) => ap.filter((p) => { const d = toDate(p.approvedAt || p.createdAt); return d >= a && (!b || d < b); }).reduce((s, p) => s + (p.amount || 0), 0);
    const soon = rs.filter((r) => isActive(r) && daysLeft(r.expiresAt) <= 3).sort((a, b) => toDate(a.expiresAt) - toDate(b.expiresAt));
    const lapsed = rs.filter((r) => !isActive(r) && r.status !== "stopped" && daysLeft(r.expiresAt) >= -14).sort((a, b) => toDate(b.expiresAt) - toDate(a.expiresAt));
    const remind = (r, ended) => waLink(r.phone, ended
      ? t("مرحباً {r} 👋 خلص اشتراككم بدورك بتاريخ {d}. لتجددوه: افتحوا دورك ← الاشتراك ← ادفعوا عبر شام كاش وارفعوا الإيصال، ومنفعّله فوراً.", { r: r.name, d: fmtDate(r.expiresAt) })
      : t("مرحباً {r} 👋 اشتراككم بدورك بيخلص بتاريخ {d}. لتجددوه بدون انقطاع: افتحوا دورك ← الاشتراك ← ادفعوا عبر شام كاش وارفعوا الإيصال.", { r: r.name, d: fmtDate(r.expiresAt) }));
    const row = (r, ended) => `<div class="row" style="justify-content:space-between;flex-wrap:wrap"><span><b>${esc(r.name)}</b> · ${planName(r.plan)} · ${ended ? t("خلص") + " " + fmtDate(r.expiresAt) : t("بعد {n} يوم", { n: daysLeft(r.expiresAt) })}</span>${r.phone ? `<a class="btn sm ghost" style="flex:none" target="_blank" href="${remind(r, ended)}">💬 ${t("ذكّرهم")}</a>` : ""}</div>`;
    const pend = ps.filter((p) => p.status === "pending").length;
    const byPlan = { basic: 0, duo: 0, unlimited: 0 }; paid.forEach((r) => (byPlan[r.plan] = (byPlan[r.plan] || 0) + 1));
    const months = []; for (let i = 5; i >= 0; i--) { const a = new Date(now.getFullYear(), now.getMonth() - i, 1), b = new Date(now.getFullYear(), now.getMonth() - i + 1, 1); months.push([a, sum(a, b)]); }
    const mx = Math.max(1, ...months.map((x) => x[1]));
    v.innerHTML = `${errN ? `<div class="banner bad">⚠️ ${t("صار {n} عطل آخر 24 ساعة", { n: errN })}<a class="btn sm" href="#/admin/errors">${t("شوف")}</a></div>` : ""}${pend ? `<div class="banner warn">💳 ${t("عندك {n} دفعة بانتظار المراجعة", { n: pend })}<a class="btn sm acc" href="#/admin/pay">${t("راجع")}</a></div>` : ""}
      <div class="grid"><div class="kpi"><b>${money(sum(m0))}</b><span>${t("أرباح هالشهر")}</span></div><div class="kpi"><b>${money(sum(m1, m0))}</b><span>${t("الشهر الماضي")}</span></div>
        <div class="kpi"><b>${rs.length}</b><span>${t("كل المطاعم")}</span></div><div class="kpi"><b>${paid.length}</b><span>${t("مشتركين")}</span></div>
        <div class="kpi"><b>${trial.length}</b><span>${t("بالتجربة")}</span></div><div class="kpi"><b>${dead.length}</b><span>${t("منتهي أو موقوف")}</span></div></div>
      <div class="card" style="margin-top:14px"><h2>${t("الأرباح آخر 6 أشهر")}</h2><div class="bars">${months.map(([, s]) => `<div style="height:${(s / mx) * 100}%"><span>${s ? money(s) : ""}</span></div>`).join("")}</div>
        <div class="axis">${months.map(([d]) => `<span>${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}</span>`).join("")}</div></div>
      <div class="card"><h2>${t("المشتركين حسب الباقة")}</h2><div class="grid">${Object.entries(byPlan).map(([k, n]) => `<div><b style="font-size:24px">${n}</b><div class="mute small">${planName(k)}</div></div>`).join("")}</div></div>
      <div class="card"><h2>⏳ ${t("بيخلص اشتراكهم خلال 3 أيام")}</h2><div class="list">${soon.map((r) => row(r, false)).join("") || `<p class="mute small">—</p>`}</div></div>
      <div class="card"><h2>⛔ ${t("خلص اشتراكهم آخر أسبوعين")}</h2><div class="list">${lapsed.map((r) => row(r, true)).join("") || `<p class="mute small">—</p>`}</div></div>`;
  } catch (e) { v.innerHTML = `<div class="err">${errMsg(e)}</div>`; }
}

async function adminPay(v) {
  v.innerHTML = `<div class="spin"></div>`;
  let ps = [], rs = {};
  const load = async () => {
    const [a, b] = await Promise.all([allPay(), allRest()]);
    rs = Object.fromEntries(b.map((r) => [r.id, r]));
    ps = a.sort((x, y) => (x.status === "pending") - (y.status === "pending") || (toDate(x.createdAt) || 0) - (toDate(y.createdAt) || 0)).reverse();
    const ST = { pending: ["warn", "قيد المراجعة"], approved: ["ok", "مقبول"], rejected: ["bad", "مرفوض"] };
    v.innerHTML = `<div class="list">${ps.map((p) => `<div class="item">${p.img ? `<img class="thumb" src="${p.img}" data-img="${p.id}" style="cursor:zoom-in">` : ""}
      <div class="grow"><div class="t">${esc(p.rname)} <span class="pill ${ST[p.status][0]}">${t(ST[p.status][1])}</span></div>
      <div class="mute small">${planName(p.plan)} · ${p.period === "y" ? t("سنوي") : t("شهري")} · <b>${money(p.amount)}</b> · ${fmtDate(p.createdAt)}</div></div>
      ${p.status === "pending" ? `<button class="btn sm ok" data-ok="${p.id}">✓ ${t("قبول وتفعيل")}</button><button class="btn sm bad" data-no="${p.id}">${t("رفض")}</button>` : ""}</div>`).join("") || `<div class="empty">${t("ما في دفعات بعد")}</div>`}</div>`;
  };
  await load().catch((e) => (v.innerHTML = `<div class="err">${errMsg(e)}</div>`));
  v.onclick = async (e) => {
    const im = e.target.closest("[data-img]"), ok = e.target.closest("[data-ok]"), no = e.target.closest("[data-no]");
    if (im) { const p = ps.find((x) => x.id === im.dataset.img); return modal(`<img src="${p.img}" style="width:100%;border-radius:12px"><button class="btn block" data-c style="margin-top:12px">${t("إغلاق")}</button>`, (b, c) => ($("[data-c]", b).onclick = c)); }
    if (ok) {
      const p = ps.find((x) => x.id === ok.dataset.ok), r = rs[p.rid];
      if (!(await confirmBox(t("تفعيل {p} لـ {r}؟", { p: planName(p.plan) + " · " + (p.period === "y" ? t("سنوي") : t("شهري")), r: p.rname }), t("تفعيل")))) return;
      const base = r && isActive(r) && r.plan !== "trial" ? toDate(r.expiresAt).getTime() : Date.now();
      const exp = base + (p.period === "y" ? 365 : 30) * 864e5;
      try {
        const b = writeBatch(db);
        b.update(doc(db, N.pay, p.id), { status: "approved", approvedAt: serverTimestamp() });
        b.update(doc(db, N.rest, p.rid), { plan: p.plan, status: "active", expiresAt: Timestamp.fromMillis(exp) });
        await b.commit(); toast(t("تم التفعيل ✓")); await load();
      } catch (er) { toast(errMsg(er)); }
    }
    if (no) {
      const note = prompt(t("سبب الرفض (بيظهر للمطعم)"), t("الإيصال غير واضح أو المبلغ غير صحيح")); if (note === null) return;
      try { await updateDoc(doc(db, N.pay, no.dataset.no), { status: "rejected", note }); await load(); } catch (er) { toast(errMsg(er)); }
    }
  };
}

async function adminRest(v) {
  v.innerHTML = `<input class="inp" id="q" placeholder="🔍 ${t("ابحث باسم المطعم أو الرقم أو الرمز")}" style="margin-bottom:12px"><div class="list" id="rl"><div class="spin"></div></div>`;
  let rs = [];
  const draw = () => {
    const s = $("#q").value.trim().toLowerCase();
    const list = rs.filter((r) => !s || [r.name, r.nameEn, r.phone, r.code, r.ownerEmail].join(" ").toLowerCase().includes(s))
      .sort((a, b) => (toDate(b.createdAt) || 0) - (toDate(a.createdAt) || 0));
    $("#rl").innerHTML = list.map((r) => { const a = isActive(r); return `<div class="item"><div class="thumb" style="background:#f3efe8 center/cover;${r.logo ? `background-image:url('${r.logo}')` : ""}"></div>
      <div class="grow"><div class="t">${esc(r.name)} <span class="pill ${r.status === "stopped" ? "bad" : a ? "ok" : "bad"}">${r.status === "stopped" ? t("موقوف") : a ? t("فعّال") : t("منتهي")}</span></div>
      <div class="mute small">${planName(r.plan)} · ${t("ينتهي")} ${fmtDate(r.expiresAt)} · <span dir="ltr">${esc(r.code)}</span><br><span dir="ltr">${esc(r.ownerEmail || "")}</span> ${r.phone ? `· <a href="${waLink(r.phone)}" target="_blank" dir="ltr">${esc(r.phone)}</a>` : ""}</div></div>
      <button class="btn sm ghost" data-m="${r.id}">${t("إدارة")}</button></div>`; }).join("") || `<div class="empty">—</div>`;
  };
  const load = async () => { rs = await allRest(); draw(); };
  load().catch((e) => ($("#rl").innerHTML = `<div class="err">${errMsg(e)}</div>`));
  $("#q").oninput = draw;
  $("#rl").onclick = (e) => {
    const id = e.target.closest("[data-m]")?.dataset.m; if (!id) return;
    const r = rs.find((x) => x.id === id);
    modal(`<h2 style="margin-bottom:6px">${esc(r.name)}</h2><p class="mute small" style="margin-bottom:14px">${planName(r.plan)} · ${t("ينتهي")} ${fmtDate(r.expiresAt)}</p>
      <label class="field"><span>${t("الباقة")}</span><select class="inp" id="mp">${["trial", "basic", "duo", "unlimited"].map((k) => `<option value="${k}" ${k === r.plan ? "selected" : ""}>${planName(k)}</option>`).join("")}</select></label>
      <label class="field"><span>${t("تاريخ الانتهاء")}</span><input class="inp" type="date" id="me" value="${dayKey(toDate(r.expiresAt) || new Date())}"></label>
      <div class="row" style="margin-bottom:10px"><button class="btn sm ghost" data-add="7">+7 ${t("أيام")}</button><button class="btn sm ghost" data-add="30">+30</button><button class="btn sm ghost" data-add="365">+365</button></div>
      <div class="row"><button class="btn ${r.status === "stopped" ? "ok" : "bad"}" id="mst">${r.status === "stopped" ? t("تفعيل الحساب") : t("إيقاف الحساب")}</button><button class="btn acc" id="msv">${t("حفظ")}</button></div>`,
      (b, close) => {
        $$("[data-add]", b).forEach((x) => (x.onclick = () => { const cur = new Date($("#me", b).value); const base = cur > new Date() ? cur : new Date(); base.setDate(base.getDate() + +x.dataset.add); $("#me", b).value = dayKey(base); }));
        $("#msv", b).onclick = () => busy($("#msv", b), async () => {
          const d = new Date($("#me", b).value + "T23:59:00");
          try { await updateDoc(doc(db, N.rest, id), { plan: $("#mp", b).value, expiresAt: Timestamp.fromDate(d) }); close(); toast(t("انحفظ ✓")); await load(); } catch (er) { toast(errMsg(er)); }
        });
        $("#mst", b).onclick = () => busy($("#mst", b), async () => {
          try { await updateDoc(doc(db, N.rest, id), { status: r.status === "stopped" ? "active" : "stopped" }); close(); await load(); } catch (er) { toast(errMsg(er)); }
        });
      });
  };
}

async function adminSettings(v) {
  const P = S.plat;
  v.innerHTML = `<div class="card"><h2>${t("الأسعار والباقات")}</h2>
      ${["basic", "duo", "unlimited"].map((k) => `<h3>${planName(k)}</h3><div class="grid" style="margin-bottom:10px">
        <label class="field"><span>${t("شهري $")}</span><input class="inp" type="number" data-k="${k}.m" value="${P.plans[k].m}"></label>
        <label class="field"><span>${t("سنوي $")}</span><input class="inp" type="number" data-k="${k}.y" value="${P.plans[k].y}"></label>
        <label class="field"><span>${t("عدد الكاشيرية")}</span><input class="inp" type="number" data-k="${k}.cashiers" value="${P.plans[k].cashiers}"></label></div>`).join("")}
      <label class="field"><span>${t("أيام التجربة المجانية")}</span><input class="inp" type="number" id="td" value="${P.trialDays}"></label></div>
    <div class="card"><h2>${t("الدفع والتواصل")}</h2>
      <div class="row" style="align-items:center;margin-bottom:14px"><div id="qrp" style="flex:none;width:110px;height:110px;border-radius:14px;border:1px solid var(--line);background:#fff center/contain no-repeat;${P.shamcash.qr ? `background-image:url('${P.shamcash.qr}')` : ""};display:grid;place-items:center;font-size:12px;color:var(--mute)">${P.shamcash.qr ? "" : "QR"}</div>
        <div><b>${t("صورة QR شام كاش")}</b><p class="mute small" style="margin:4px 0 8px">${t("بتظهر للمطعم ليمسحها ويدفع")}</p><button class="btn sm ghost" id="qru">${t("رفع صورة")}</button> <button class="btn sm bad ${P.shamcash.qr ? "" : "hide"}" id="qrd">${t("حذف")}</button></div></div>
      <label class="field"><span>${t("حساب شام كاش (الرقم أو العنوان)")}</span><input class="inp" id="sa" dir="ltr" value="${esc(P.shamcash.account)}"></label>
      <label class="field"><span>${t("اسم صاحب الحساب")}</span><input class="inp" id="sn" value="${esc(P.shamcash.name)}"></label>
      <label class="field"><span>${t("رقم واتساب الدعم")}</span><input class="inp" id="wa" dir="ltr" value="${esc(P.whatsapp)}"></label>
      <button class="btn acc" id="sv">${t("حفظ")}</button></div>
    <div class="card"><h2>🔔 ${t("إشعارات لجوالي")}</h2><p class="mute small" style="margin-bottom:12px">${t("بيوصلك إشعار لما يسجّل مطعم جديد أو يرفع إيصال دفع")}</p>
      <p id="aps" class="small" style="margin-bottom:10px">${P.adminPush ? "✓ " + t("مفعّلة") : t("مو مفعّلة")}</p>
      <button class="btn ghost" id="ape">${t("فعّل الإشعارات على هالجوال")}</button></div>`;
  $("#ape").onclick = () => busy($("#ape"), async () => {
    if (IN_APP || !("PushManager" in window)) return toast(t("افتح لوحتك من متصفح Chrome لتفعيل الإشعارات"), 5000);
    try {
      if ((await Notification.requestPermission()) !== "granted") return toast(t("لازم توافق على الإشعارات"));
      const reg = await navigator.serviceWorker.register("sw.js?role=admin", { scope: "./__admin/" });
      await new Promise((r) => { const w = reg.installing || reg.waiting; if (!w || reg.active) return r(); w.addEventListener("statechange", () => w.state === "activated" && r()); setTimeout(r, 5000); });
      const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToBytes(VAPID_PUBLIC) }));
      await updateDoc(doc(db, N.cfg, "platform"), { adminPush: sub.endpoint });
      await loadPlatform(); $("#aps").textContent = "✓ " + t("مفعّلة"); toast(t("انحفظ ✓"));
    } catch (e) { console.warn(e); toast(errMsg(e)); }
  });
  let qr = P.shamcash.qr || "";
  const showQr = () => { const b = $("#qrp"); b.style.backgroundImage = qr ? `url('${qr}')` : ""; b.textContent = qr ? "" : "QR"; $("#qrd").classList.toggle("hide", !qr); };
  $("#qru").onclick = async () => { const [f] = await pickFile(); if (!f) return; qr = await compress(f, 700, 0.9, "image/png"); showQr(); };
  $("#qrd").onclick = () => { qr = ""; showQr(); };
  $("#sv").onclick = () => busy($("#sv"), async () => {
    const plans = JSON.parse(JSON.stringify(P.plans));
    $$("[data-k]").forEach((i) => { const [k, f] = i.dataset.k.split("."); plans[k][f] = Math.max(0, Number(i.value) || 0); });
    try {
      await updateDoc(doc(db, N.cfg, "platform"), { plans, trialDays: Math.max(1, +$("#td").value || 7), shamcash: { account: $("#sa").value.trim(), name: $("#sn").value.trim(), qr }, whatsapp: $("#wa").value.trim() });
      await loadPlatform(); toast(t("انحفظ ✓"));
    } catch (e) { toast(errMsg(e)); }
  });
}
