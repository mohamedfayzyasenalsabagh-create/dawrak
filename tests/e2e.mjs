// اختبار السيناريو كامل: صاحب النظام، تسجيل مطعم، طلب، الزبون، الجاهزية، التقييم، الكاشيرية، الدفع
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(new URL(q.url, "http://x").pathname); if (p.endsWith("/")) p += "index.html";
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(r);
}).listen(5055);
const BASE = "http://127.0.0.1:5055/";

const INIT = `window.__DAWRAK_CFG={apiKey:"demo-key",authDomain:"demo-dawrak.firebaseapp.com",projectId:"demo-dawrak",appId:"1:1:web:1"};
window.__DAWRAK_EMU={host:"127.0.0.1",auth:9099,fs:8080};
try{localStorage.setItem("dawrak-lang","ar")}catch{}`;

const browser = await chromium.launch();
const errors = [];
let step = 0;
const ok = (m) => console.log(`✓ ${++step}. ${m}`);
async function ctx(name) {
  const c = await browser.newContext({ locale: "ar-SY", permissions: ["notifications"] });
  await c.addInitScript(INIT);
  const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(`[${name}] ${e.message}`));
  p.on("console", (m) => { if (m.type() === "error" && !/favicon|ERR_|404/.test(m.text())) errors.push(`[${name}] ${m.text()}`); });
  p.on("dialog", (d) => d.accept(d.defaultValue()));
  return p;
}
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
async function upload(p, clickSel) {
  const [fc] = await Promise.all([p.waitForEvent("filechooser"), p.click(clickSel)]);
  await fc.setFiles({ name: "x.png", mimeType: "image/png", buffer: png });
}

try {
  // 1) صاحب النظام
  const A = await ctx("admin");
  await A.goto(BASE + "app.html#/admin");
  await A.fill("#em", "boss@dawrak.test"); await A.fill("#pw", "secret123");
  await A.click("#mk");
  await A.waitForSelector("text=تفعيل لوحة صاحب النظام");
  await A.click("#go");
  await A.waitForSelector("text=أرباح هالشهر"); ok("صاحب النظام فعّل لوحته");
  await A.goto(BASE + "app.html#/admin/settings"); await A.waitForSelector("#sa");
  await A.fill("#sa", "SHAM-12345"); await A.fill("#sn", "Mohamed"); await upload(A, "#qru"); await A.click("#sv");
  await A.waitForSelector("text=انحفظ"); ok("إعدادات شام كاش انحفظت");

  // 2) تسجيل مطعم
  const O = await ctx("owner");
  await O.goto(BASE + "app.html#/signup");
  await O.fill("#rn", "كافيه المسا"); await O.fill("#ph", "0999123456");
  await O.fill("#em", "cafe@dawrak.test"); await O.fill("#pw", "secret123");
  await O.click("#go");
  await O.waitForSelector("#newo"); ok("المطعم سجّل وفتحت شاشة الكاشير");
  await O.waitForSelector("text=ما في طلبات اليوم");

  // 3) طلب جديد
  await O.click("#newo");
  await O.waitForSelector(".qrbox .bign");
  const num = await O.textContent(".qrbox .bign");
  const url = await O.getAttribute(".qr", "data-url");
  if (num.trim() !== "1") throw new Error("رقم الطلب الأول مو 1: " + num);
  ok("طلب رقم 1 مع رمز QR");
  await O.click("[data-ok]");

  // 4) الزبون
  const C = await ctx("customer");
  await C.goto(url.replace(/^https?:\/\/[^/]+\//, BASE));
  await C.waitForSelector(".num"); if ((await C.textContent(".num")).trim() !== "1") throw new Error("الزبون ما شاف رقمه");
  await C.waitForSelector("text=كافيه المسا"); ok("الزبون شاف رقمه واسم المطعم");
  await C.click("#en"); await C.waitForSelector("text=التنبيه مفعّل"); ok("الزبون فعّل التنبيه");
  await O.waitForSelector("text=فتح الصفحة"); ok("الكاشير شاف إنو الزبون فتح الصفحة");

  // 5) جاهز
  await O.click("[data-ready]");
  await C.waitForSelector(".ready.show"); ok("وصل التنبيه للزبون: طلبك جاهز");
  await C.click("#pk"); await C.waitForSelector(".stars");
  await C.click('.stars button[data-r="5"]'); await C.waitForSelector("text=شكراً على تقييمك");
  await O.waitForSelector("text=⭐⭐⭐⭐⭐"); ok("الزبون استلم وقيّم 5 نجوم، والكاشير شاف التقييم");

  // 6) نادي مرة تانية
  await O.click("[data-call]");
  await C.waitForSelector(".ready.show"); ok("زر «نادي مرة تانية» رجّع رنّ عند الزبون");
  await C.click("#pk");

  // 7) الحماية: الزبون ما بيقدر يغيّر حالة الطلب
  const denied = await C.evaluate(async (u) => {
    const fb = await import("./fb.js"); const q = new URL(u).searchParams;
    try { await fb.updateDoc(fb.doc(fb.db, fb.N.rest, q.get("r"), "orders", q.get("o")), { status: "new" }); return false; } catch (e) { return e.code; }
  }, url);
  if (!denied) throw new Error("الزبون قدر يعدّل حالة الطلب!"); ok("الزبون ممنوع يعدّل حالة الطلب (" + denied + ")");
  const denied2 = await C.evaluate(async () => {
    const fb = await import("./fb.js");
    try { await fb.getDocs(fb.collection(fb.db, fb.N.pay)); return false; } catch (e) { return e.code; }
  });
  if (!denied2) throw new Error("الزبون قدر يقرأ الدفعات!"); ok("الدفعات محمية");

  // 8) كاشير جديد
  await O.goto(BASE + "app.html#/r/team"); await O.waitForSelector("#add");
  await O.click("#add"); await O.fill("#sn", "أحمد"); await O.fill("#su", "ahmad"); await O.fill("#sp", "123456");
  await O.click("#ss"); await O.waitForSelector("text=تم إنشاء الحساب");
  const login = (await O.textContent(".modal .card b")).trim(); await O.click("[data-c]");
  ok("صاحب المطعم أضاف كاشير: " + login);
  const K = await ctx("cashier");
  await K.goto(BASE + "app.html"); await K.fill("#em", login); await K.fill("#pw", "123456"); await K.click("#go");
  await K.waitForSelector("#newo");
  if (await K.$("text=الإحصائيات")) throw new Error("الكاشير شاف تبويب الإحصائيات");
  await K.click("#newo"); await K.waitForSelector(".qrbox .bign");
  if ((await K.textContent(".qrbox .bign")).trim() !== "2") throw new Error("ترقيم الكاشير غلط"); await K.click("[data-ok]");
  ok("الكاشير دخل وعمل طلب رقم 2، وما بيشوف لوحة صاحب المطعم");

  // 9) تخصيص صفحة الزبون
  await O.goto(BASE + "app.html#/r/brand"); await O.waitForSelector("#n2");
  await O.fill("#n2", "Evening Cafe"); await O.click("#sv"); await O.waitForSelector("text=انحفظ");
  await O.click("#addof"); await O.fill("#ot", "قهوتين بسعر وحدة"); await O.click("#os");
  await O.waitForSelector("#ofs >> text=قهوتين بسعر وحدة");
  await C.reload(); await C.waitForSelector("text=قهوتين بسعر وحدة"); ok("العرض ظهر بصفحة الزبون");

  // 10) الإحصائيات
  await O.goto(BASE + "app.html#/r/stats"); await O.waitForSelector("text=متوسط مدة التحضير"); ok("الإحصائيات المفصّلة شغالة");

  // 11) الدفع والتفعيل
  await O.goto(BASE + "app.html#/r/plan"); await O.waitForSelector("text=SHAM-12345"); await O.waitForSelector('img[alt="QR"]');
  await O.click('.plan[data-k="duo"]'); await upload(O, "#rc");
  await O.waitForSelector("#send:not([disabled])"); await O.click("#send");
  await O.waitForSelector("text=قيد المراجعة"); ok("المطعم رفع إيصال شام كاش");
  await A.goto(BASE + "app.html#/admin/pay"); await A.waitForSelector("[data-ok]");
  await A.click("[data-ok]"); await A.click(".modal [data-y]"); await A.waitForSelector("text=تم التفعيل");
  await O.goto(BASE + "app.html#/r/plan"); await O.waitForSelector("text=كاشيرين"); await O.waitForSelector(".pill.ok");
  ok("صاحب النظام قبل الدفعة والاشتراك تفعّل");

  // 12) لوحة صاحب النظام
  await A.goto(BASE + "app.html#/admin"); await A.waitForSelector("text=15$"); ok("الأرباح ظهرت بلوحة صاحب النظام");
  await A.goto(BASE + "app.html#/admin/rest"); await A.waitForSelector("text=كافيه المسا"); ok("قائمة المطاعم شغالة");

  // 13) الصفحة الرئيسية والإنكليزي
  const L = await ctx("landing");
  await L.goto(BASE); await L.waitForSelector("text=جوال زبونك");
  await L.click("#lng"); await L.waitForSelector("text=is now the pager"); ok("الصفحة الرئيسية بالعربي والإنكليزي");

  if (errors.length) { console.log("\nأخطاء بالمتصفح:\n" + errors.join("\n")); process.exitCode = 1; }
  else console.log("\n✅ كل الاختبارات نجحت");
} catch (e) {
  console.error("✗ فشل:", e.message);
  if (errors.length) console.log(errors.join("\n"));
  process.exitCode = 1;
} finally {
  await browser.close(); srv.close();
}
