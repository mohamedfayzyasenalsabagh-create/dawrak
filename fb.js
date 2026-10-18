// طبقة الاتصال بـ Firebase: الحسابات وقاعدة البيانات
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
  onAuthStateChanged, sendPasswordResetEmail, connectAuthEmulator, updatePassword
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator, doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc,
  collection, query, where, getDocs, onSnapshot, serverTimestamp, runTransaction, writeBatch,
  orderBy, limit, Timestamp, increment, deleteField, getCountFromServer, enableNetwork, disableNetwork
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig, PREFIX } from "./config.js";

const cfg = window.__DAWRAK_CFG || firebaseConfig;
export const configured = !String(cfg.apiKey).startsWith("PASTE");
const EMU = window.__DAWRAK_EMU; // للاختبار فقط

export const app = configured ? initializeApp(cfg) : null;
export const auth = configured ? getAuth(app) : null;
// نسخة محلية من البيانات على الجهاز: الكاشير بيكمّل شغله إذا قطع النت، وبتتزامن لما يرجع
function makeDb() {
  if (window.__DAWRAK_NOPERSIST) return getFirestore(app); // صفحة الزبون: دايماً من الخادم
  try { return initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }); }
  catch { return getFirestore(app); }
}
export const db = configured ? makeDb() : null;
// لما يرجع النت: نعيد الاتصال فوراً بدل ما نستنى
if (db) {
  window.addEventListener("offline", () => disableNetwork(db).catch(() => {}));
  window.addEventListener("online", () => enableNetwork(db).catch(() => {}));
}
if (configured && EMU) {
  connectAuthEmulator(auth, `http://${EMU.host}:${EMU.auth}`, { disableWarnings: true });
  connectFirestoreEmulator(db, EMU.host, EMU.fs);
}

// أسماء المجموعات
const PX = window.__DAWRAK_PFX ?? PREFIX;
export const N = { rest: PX + "restaurants", users: PX + "users", pay: PX + "payments", cfg: PX + "config" };

// تطبيق ثانٍ لإنشاء حسابات الكاشيرية دون تسجيل خروج صاحب المطعم
let sec = null;
export async function createStaffAccount(email, password) {
  if (!sec) {
    const a = initializeApp(cfg, "staff");
    sec = getAuth(a);
    if (EMU) connectAuthEmulator(sec, `http://${EMU.host}:${EMU.auth}`, { disableWarnings: true });
  }
  const c = await createUserWithEmailAndPassword(sec, email, password);
  const uid = c.user.uid;
  await signOut(sec);
  return uid;
}

export {
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged,
  sendPasswordResetEmail, updatePassword,
  doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, query, where, getDocs, onSnapshot,
  serverTimestamp, runTransaction, writeBatch, orderBy, limit, Timestamp, increment, deleteField, getCountFromServer
};

// الباقات الافتراضية (يعدّلها صاحب النظام من لوحته)
export const DEFAULT_PLATFORM = {
  trialDays: 7,
  plans: {
    basic: { m: 10, y: 100, cashiers: 1 },
    duo: { m: 15, y: 150, cashiers: 2 },
    unlimited: { m: 25, y: 250, cashiers: 999 }
  },
  shamcash: { name: "", account: "", qr: "" },
  whatsapp: ""
};

export function platformOf(d) {
  const p = d || {};
  const out = JSON.parse(JSON.stringify(DEFAULT_PLATFORM));
  if (p.trialDays) out.trialDays = p.trialDays;
  for (const k of Object.keys(out.plans)) Object.assign(out.plans[k], (p.plans || {})[k] || {});
  Object.assign(out.shamcash, p.shamcash || {});
  if (p.whatsapp) out.whatsapp = p.whatsapp;
  out.adminPush = p.adminPush || "";
  out.ownerUid = p.ownerUid;
  return out;
}

// ميزات كل باقة: الإحصائيات المفصّلة والفروع للباقة المفتوحة والتجربة فقط
export const hasPro = (plan) => plan === "unlimited" || plan === "trial";

export const toDate = (v) => (v && v.toDate ? v.toDate() : v ? new Date(v) : null);
export function isActive(r) {
  const e = toDate(r && r.expiresAt);
  return !!(r && r.status !== "stopped" && e && e > new Date());
}
export function dayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
