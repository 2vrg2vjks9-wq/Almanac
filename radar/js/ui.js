// Shell behaviour: tabs, the bottom sheet, short notices, pull to refresh, first-run welcome.
import { $, put, reduceMotion } from "./util.js";
import { get, set, KEYS } from "./store.js";

// --- Tabs -----------------------------------------------------------------------
export function showTab(name) {
  document.querySelectorAll(".tab").forEach((t) => {
    const on = t.dataset.v === name;
    t.classList.toggle("on", on);
    if (on) t.setAttribute("aria-current", "page"); else t.removeAttribute("aria-current");
  });
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("on", v.id === "v-" + name));
  window.scrollTo(0, 0);
}
export const currentTab = () => (document.querySelector(".tab.on") || {}).dataset?.v || "today";
export function initTabs() {
  document.querySelectorAll(".tab").forEach((t) => { t.onclick = () => showTab(t.dataset.v); });
}

// --- Short notice at the top ------------------------------------------------------
let sayTimer;
export function say(text) {
  const el = $("say");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(sayTimer);
  sayTimer = setTimeout(() => el.classList.remove("show"), 3600);
}

// --- Bottom sheet -------------------------------------------------------------------
// One sheet for item details, places and short forms. render() returns html``; after(body)
// wires buttons. Close by the grab handle swipe, tapping outside, Escape or a close button.
let cur = null, lastFocus = null;
export const sheetOpen = () => !!cur;
export function openSheet(render, after, label) {
  cur = { render, after };
  lastFocus = document.activeElement;
  const dlg = $("sheet"), panel = $("panel");
  dlg.setAttribute("aria-label", label || "Details");
  paintSheet();
  dlg.classList.add("show");
  panel.scrollTop = 0;
  panel.style.transform = "";
  document.body.classList.add("locked");
  requestAnimationFrame(() => requestAnimationFrame(() => { dlg.classList.add("in"); panel.focus({ preventScroll: true }); }));
}
export function paintSheet() {
  if (!cur) return;
  const body = $("sheetBody");
  put(body, cur.render());
  body.querySelectorAll("[data-close]").forEach((b) => { b.onclick = closeSheet; });
  if (cur.after) cur.after(body);
}
export function closeSheet() {
  if (!cur) return;
  const dlg = $("sheet"), panel = $("panel");
  cur = null;
  dlg.classList.remove("in");
  panel.style.transform = "";
  document.body.classList.remove("locked");
  setTimeout(() => { if (!cur) dlg.classList.remove("show"); }, reduceMotion() ? 0 : 320);
  if (lastFocus && lastFocus.focus && document.body.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
}
export function initSheet() {
  $("scrim").onclick = closeSheet;
  $("sheetClose").onclick = closeSheet;
  document.addEventListener("keydown", (e) => {
    if (!cur) return;
    if (e.key === "Escape") { closeSheet(); return; }
    if (e.key !== "Tab") return;
    const f = [...$("panel").querySelectorAll("a[href],button:not([disabled]),input,textarea,select")];
    if (!f.length) return;
    const a = f[0], z = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === a || document.activeElement === $("panel"))) { e.preventDefault(); z.focus(); }
    else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
  });
  // Swipe down to close, only when the sheet is scrolled to the top.
  const panel = $("panel");
  let y0 = null, dy = 0;
  panel.addEventListener("touchstart", (e) => {
    const t = e.target;
    y0 = panel.scrollTop <= 0 && !(t.closest && t.closest("input,textarea,select")) ? e.touches[0].clientY : null; dy = 0;
  }, { passive: true });
  panel.addEventListener("touchmove", (e) => {
    if (y0 == null) return;
    dy = e.touches[0].clientY - y0;
    if (dy > 0) { panel.style.transition = "none"; panel.style.transform = "translateY(" + dy + "px)"; if (e.cancelable) e.preventDefault(); }
  }, { passive: false });
  panel.addEventListener("touchend", () => {
    if (y0 == null) return;
    panel.style.transition = ""; y0 = null;
    if (dy > 90) closeSheet(); else panel.style.transform = "";
  });
}

// --- Pull to refresh (Today only) ------------------------------------------------------
export function initPullToRefresh(onRefresh) {
  const ptr = $("ptr"), txt = $("ptrText");
  let y0 = null, dy = 0;
  document.addEventListener("touchstart", (e) => {
    y0 = window.scrollY <= 0 && !cur && currentTab() === "today" && !$("welcome").classList.contains("show") ? e.touches[0].clientY : null; dy = 0;
  }, { passive: true });
  document.addEventListener("touchmove", (e) => {
    if (y0 == null) return;
    dy = e.touches[0].clientY - y0;
    if (dy <= 0) { ptr.style.height = "0"; return; }
    ptr.style.transition = "none";
    ptr.style.height = Math.min(56, dy / 2.2) + "px";
    txt.textContent = dy > 110 ? "Release to refresh" : "Pull to refresh";
  }, { passive: true });
  document.addEventListener("touchend", () => {
    if (y0 == null) return;
    y0 = null; ptr.style.transition = ""; ptr.style.height = "0";
    if (dy > 110) onRefresh();
  });
}

// --- First-run welcome (three cards, once) ----------------------------------------------
export function initWelcome() {
  if (get(KEYS.welcomed, false)) return;
  const w = $("welcome"), cards = $("wcards"), next = $("wNext"), dots = w.querySelectorAll(".wdots i"), n = dots.length;
  const idx = () => Math.round(cards.scrollLeft / Math.max(1, cards.clientWidth));
  const paint = () => { const i = idx(); dots.forEach((x, j) => x.classList.toggle("on", j === i)); next.textContent = i >= n - 1 ? "Start" : "Next"; };
  const done = () => {
    set(KEYS.welcomed, true);
    w.classList.remove("show");
    document.body.classList.remove("locked");
    const t = document.querySelector(".tab.on"); if (t) t.focus({ preventScroll: true });
  };
  cards.addEventListener("scroll", paint, { passive: true });
  next.onclick = () => {
    const i = idx();
    if (i >= n - 1) return done();
    cards.scrollTo({ left: (i + 1) * cards.clientWidth, behavior: reduceMotion() ? "auto" : "smooth" });
    setTimeout(paint, reduceMotion() ? 0 : 400);
  };
  $("wSkip").onclick = done;
  w.addEventListener("keydown", (e) => { if (e.key === "Escape") done(); });
  w.classList.add("show");
  document.body.classList.add("locked");
  w.focus({ preventScroll: true });
}
