// سجل الأعطال: أي خطأ بيصير عند مطعم أو زبون بينحفظ، وصاحب النظام بيشوفه بلوحته
import { db, N, addDoc, collection, serverTimestamp } from "./fb.js";

export const errCtx = { rid: "", role: "" };
const seen = new Set();
let count = 0;
// أخطاء عادية ما إلها داعي (نت مقطوع، كلمة سر غلط، إضافات المتصفح)
const SKIP = /ResizeObserver|^Script error\.?$|extension:\/\/|network-request-failed|unavailable|offline|Failed to fetch|Load failed|NetworkError|auth\/(invalid-credential|invalid-login|wrong-password|user-not-found|email-already-in-use|weak-password|too-many-requests|invalid-email)|AbortError|NotAllowedError|wakeLock/i;

export function logError(e, where = "") {
  try {
    if (!db || !e) return;
    const msg = String(((e.code ? e.code + ": " : "") + (e.message || e)) || "").slice(0, 500);
    if (!msg || SKIP.test(msg) || seen.has(msg) || count >= 8) return;
    seen.add(msg); count++;
    addDoc(collection(db, N.err), {
      msg, where: String(where).slice(0, 80), stack: String(e.stack || "").slice(0, 1500),
      page: (location.pathname.split("/").pop() || "index.html").slice(0, 40), hash: location.hash.slice(0, 60),
      ua: navigator.userAgent.slice(0, 200), app: /DawrakApp/.test(navigator.userAgent),
      rid: String(errCtx.rid || "").slice(0, 40), role: String(errCtx.role || "").slice(0, 20),
      online: navigator.onLine, at: serverTimestamp()
    }).catch(() => {});
  } catch {}
}
window.addEventListener("error", (ev) => logError(ev.error || ev.message, "window"));
window.addEventListener("unhandledrejection", (ev) => logError(ev.reason, "promise"));
