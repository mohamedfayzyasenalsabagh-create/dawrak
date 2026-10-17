// طبقة الاتصال بـ Firebase: الحسابات وقاعدة البيانات
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
  onAuthStateChanged, sendPasswordResetEmail, connectAuthEmulator, updatePassword
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc,
  collection, query, where, getDocs, onSnapshot, serverTimestamp, runTransaction, writeBatch,
  orderBy, limit, Timestamp, increment, deleteField, getCountFromServer
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig, PREFIX } from "./config.js";

const cfg = window.__DAWRAK_CFG || firebaseConfig;
export const configured = !String(cfg.apiKey).startsWith("PASTE");
const EMU = window.__DAWRAK_EMU; // للاختبار فقط

export const app = configured ? initializeApp(cfg) : null;
export const auth = configured ? getAuth(app) : null;
export const db = configured ? getFirestore(app) : null;
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
  shamcash: { name: "", account: "" },
  whatsapp: ""
};

export function platformOf(d) {
  const p = d || {};
  const out = JSON.parse(JSON.stringify(DEFAULT_PLATFORM));
  if (p.trialDays) out.trialDays = p.trialDays;
  for (const k of Object.keys(out.plans)) Object.assign(out.plans[k], (p.plans || {})[k] || {});
  Object.assign(out.shamcash, p.shamcash || {});
  if (p.whatsapp) out.whatsapp = p.whatsapp;
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
