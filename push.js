// إشعارات الجوال حتى لو الشاشة مقفلة أو المتصفح مسكّر (Web Push)
// الكاشير بيبعت الإشعار مباشرة لخدمة الإشعارات بجوال الزبون، بدون خادم
export const VAPID_PUBLIC = "BOBuwPZrdg35WEC3DHfgLLBWLkt7R_1mwjRlZrxit8wXh4c_aktcVt9MAc1V3HpfsxkI-MoYUprdpKJllGJ72ho";
const JWK = { kty: "EC", crv: "P-256", x: "4G7A9mt2DflYQLcMd-AssFYuS3tH_WbCNGVmvGK3zBc", y: "h4c_aktcVt9MAc1V3HpfsxkI-MoYUprdpKJllGJ72ho", d: "I6wxKG6jq6hcSjlsGF6KW1VrKfYenitiDVPQD9tDeC4", ext: true };
const SUB = "mailto:support@dawrak.app";

const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const enc = (o) => b64u(new TextEncoder().encode(JSON.stringify(o)));
export function urlB64ToBytes(s) {
  const p = "=".repeat((4 - (s.length % 4)) % 4), b = atob((s + p).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

// فرق الساعة بين جوال الكاشير والوقت الحقيقي (إذا ساعة الجوال غلط Google بترفض الإشعار)
let clockOffset = 0;
export async function syncClock() {
  try {
    const t0 = Date.now();
    const r = await fetch(location.href.split("#")[0], { method: "HEAD", cache: "no-store" });
    const d = Date.parse(r.headers.get("Date") || "");
    if (d) clockOffset = d - (t0 + Date.now()) / 2;
  } catch {}
}
export const now = () => Date.now() + clockOffset;

let keyP = null;
// ترويسة Authorization حسب معيار VAPID (RFC 8292)
export async function vapidAuth(endpoint, at = now()) {
  keyP = keyP || crypto.subtle.importKey("jwk", JWK, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const head = enc({ typ: "JWT", alg: "ES256" });
  const body = enc({ aud: new URL(endpoint).origin, exp: Math.floor(at / 1000) + 12 * 3600, sub: SUB });
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await keyP, new TextEncoder().encode(head + "." + body));
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${VAPID_PUBLIC}`;
}

// نتائج الإرسال من تطبيق الكاشير
const waiting = new Map();
let seq = 0;
window.__pushResult = (id, code) => { const r = waiting.get(id); if (r) { waiting.delete(id); r(code); } };

// إرسال الإشعار لجوال الزبون، وبيرجع رمز النتيجة: 201 = انبعت، 404/410 = الاشتراك منتهي، 0 = ما في طريقة للإرسال
export async function sendPush(endpoint) {
  if (!endpoint) return 0;
  try {
    const auth = await vapidAuth(endpoint);
    const A = window.DawrakApp;
    if (A && A.push2) {
      const id = "p" + ++seq;
      return await new Promise((res) => { waiting.set(id, res); A.push2(id, endpoint, auth); setTimeout(() => { if (waiting.delete(id)) res(-1); }, 20000); });
    }
    if (A && A.push) { A.push(endpoint, auth); return 202; } // نسخة التطبيق القديمة: ما منعرف النتيجة
    const r = await fetch(endpoint, { method: "POST", headers: { Authorization: auth, TTL: "900", Urgency: "high" } });
    return r.status;
  } catch (e) { console.warn("push", e); return 0; }
}
export const pushOk = (code) => code >= 200 && code < 300;
