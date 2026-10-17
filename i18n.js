// الترجمة: النص العربي هو المفتاح، والإنكليزي يُؤخذ من القاموس
import { EN } from "./en.js";

const saved = (() => { try { return localStorage.getItem("dawrak-lang"); } catch { return null; } })();
const auto = (navigator.language || "ar").toLowerCase().startsWith("ar") ? "ar" : "en";

export let lang = saved || auto;
export const autoLang = auto;

export function useAuto() { lang = auto; apply(); }
export function setLang(l, remember = true) {
  lang = l;
  if (remember) { try { localStorage.setItem("dawrak-lang", l); } catch {} }
  apply();
}
export function apply() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
}
export function t(s, vars) {
  let out = lang === "en" ? (EN[s] ?? s) : s;
  if (vars) for (const k in vars) out = out.split("{" + k + "}").join(vars[k]);
  return out;
}
apply();
