// Shell behaviour: tabs, the bottom sheet, short notices, pull to refresh, first-run welcome.
import { $, put, reduceMotion } from "./util.js";
import { get, set, KEYS } from "./store.js";

// --- Tabs -----------------------------------------------------------------------
export function showTab(name) {
  const from = currentTab();
  setTimeout(() => window.dispatchEvent(new CustomEvent("radar-tab", { detail: { from, to: name } })), 0);
  const lit = name === "settings" ? "saved" : name; // Settings lives under You
  document.querySelectorAll(".tab").forEach((t) => {
    const on = t.dataset.v === lit;
    t.classList.toggle("on", on);
    if (on) t.setAttribute("aria-current", "page"); else t.removeAttribute("aria-current");
  });
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("on", v.id === "v-" + name));
  window.scrollTo(0, 0);
}
export const currentTab = () => ((document.querySelector(".view.on") || {}).id || "v-today").slice(2);
export function initTabs() {
  document.querySelectorAll(".tab").forEach((t) => { t.onclick = () => showTab(t.dataset.v); });
  document.querySelectorAll("#panes [data-p]").forEach((b) => { b.onclick = () => showPane(b.dataset.p); });
  showPane(get(KEYS.pane, "foryou"), true);
}

// --- Discover panes: For you, Go, Read & listen, Nearby ------------------------------------------
const PANES = ["foryou", "go", "read", "near"];
export function showPane(p, quiet) {
  if (!PANES.includes(p)) p = "foryou";
  document.querySelectorAll("#panes [data-p]").forEach((b) => {
    const on = b.dataset.p === p;
    b.classList.toggle("on", on); b.setAttribute("aria-selected", on);
  });
  PANES.forEach((k) => { const el = $("pane-" + k); if (el) el.hidden = k !== p; });
  set(KEYS.pane, p);
  if (!quiet) window.scrollTo(0, 0);
}

// --- Swipe a list row: right = yes / more, left = no / less ---------------------------------------
// Follows the finger sideways only (vertical scrolling stays normal); past 90 px it acts.
export function swipeRow(el, right, left, labels) {
  if (!el || el.dataset.swipe) return;
  el.dataset.swipe = "1";
  el.classList.add("swipe");
  const tag = document.createElement("span");
  tag.className = "swipe-tag"; tag.setAttribute("aria-hidden", "true");
  el.appendChild(tag);
  let x0 = null, y0 = 0, dx = 0, lock = null;
  el.addEventListener("pointerdown", (e) => {
    const hit = e.target.closest("a,button,input");
    // small buttons inside a row keep their tap; the row itself (or its main link) can be swiped
    // the row's title button stretches over the whole row (.open), so a touch there is a swipe on the row too
    if (e.pointerType === "mouse" || (hit && hit !== el && !hit.matches(".open,[data-swipeok]"))) return;
    x0 = e.clientX; y0 = e.clientY; dx = 0; lock = null;
  });
  // a swipe must not also count as a tap on the row's link or button
  el.addEventListener("click", (e) => { if (el.dataset.swiped) { e.preventDefault(); e.stopPropagation(); delete el.dataset.swiped; } }, true);
  el.addEventListener("pointermove", (e) => {
    if (x0 == null) return;
    dx = e.clientX - x0;
    if (lock == null && (Math.abs(dx) > 10 || Math.abs(e.clientY - y0) > 10)) lock = Math.abs(dx) > Math.abs(e.clientY - y0) * 1.3 ? "x" : "y";
    if (lock !== "x") return;
    el.style.transition = "none";
    el.style.transform = "translateX(" + dx + "px)";
    tag.textContent = dx > 0 ? labels[0] : labels[1];
    tag.className = "swipe-tag " + (dx > 0 ? "r" : "l");
    tag.style.opacity = Math.min(1, Math.abs(dx) / 90);
  });
  const end = () => {
    if (x0 == null) return;
    x0 = null; el.style.transition = ""; el.style.transform = ""; tag.style.opacity = 0;
    if (lock === "x") { el.dataset.swiped = "1"; setTimeout(() => { delete el.dataset.swiped; }, 400); }
    if (lock === "x" && Math.abs(dx) > 90) (dx > 0 ? right : left)();
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
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

// --- Undo notice ---------------------------------------------------------------------------------
// For things swiped away. With `later`, the change only happens when the notice runs out (so Undo costs
// nothing to send); otherwise `undo` puts it back.
let undoTimer = null, undoFns = null;
export function undoable(text, undo, later) {
  if (undoFns && undoFns.later) undoFns.later(); // a new one lets the previous change go ahead
  undoFns = { undo, later };
  $("undoText").textContent = text;
  $("undoBar").classList.add("show");
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => { const f = undoFns; undoFns = null; $("undoBar").classList.remove("show"); if (f && f.later) f.later(); }, 6000);
}
export function initUndo() {
  $("undoBtn").onclick = () => {
    const f = undoFns; undoFns = null; clearTimeout(undoTimer);
    $("undoBar").classList.remove("show");
    if (f && f.undo) f.undo();
  };
}
