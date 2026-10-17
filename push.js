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

let keyP = null;
// ترويسة Authorization حسب معيار VAPID (RFC 8292)
export async function vapidAuth(endpoint, now = Date.now()) {
  keyP = keyP || crypto.subtle.importKey("jwk", JWK, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const head = enc({ typ: "JWT", alg: "ES256" });
  const body = enc({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: SUB });
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await keyP, new TextEncoder().encode(head + "." + body));
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${VAPID_PUBLIC}`;
}

// إرسال إشعار فاضي، وعامل الخدمة عند الزبون بيعرض "طلبك جاهز"
export async function sendPush(endpoint) {
  if (!endpoint) return false;
  try {
    const auth = await vapidAuth(endpoint);
    if (window.DawrakApp && window.DawrakApp.push) { window.DawrakApp.push(endpoint, auth); return true; }
    const r = await fetch(endpoint, { method: "POST", headers: { Authorization: auth, TTL: "900", Urgency: "high" } });
    return r.ok;
  } catch (e) { console.warn("push", e); return false; }
}
