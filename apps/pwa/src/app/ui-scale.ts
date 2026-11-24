/**
 * EPIC-P20 T20.2: the whole UI scales in steps, per device. Keys and wheel
 * are caught so the browser's own page zoom does not stack on top.
 *
 * The scale is the CSS `zoom` of <html>, mirrored in `--ui-zoom` — viewport
 * heights are divided by it (02-layout.css), otherwise a zoomed layout grows
 * past the screen. The pattern and the "window never scrolls" guarantee:
 * docs/zoom-robuste-flaechen.md (EPIC-P50).
 */
import { registerShortcut } from "../shared/shortcuts/registry.ts";

const SCALE_KEY = "ancientvoid.uiScale";
const MOTION_KEY = "ancientvoid.ctxMotion";

export const SCALE_MIN = 0.5;
/** Untergrenze nach Nutzerfund 24.11.2026: am PC-Fenster waren 70 % zu gross —
 * die Spalten passten nicht. 50 % ist die bewusste Grenze, kleiner wird unleserlich. */
export const SCALE_MAX = 2;
export const SCALE_STEP = 0.1;
/** Accumulated wheel delta that makes one step; a trackpad pinch sends many small ones. */
const WHEEL_STEP_DELTA = 60;

/** Nearest step inside the allowed range; anything not a number is 100 %. */
export function clampScale(value: number): number {
  if (!Number.isFinite(value)) return 1;
  const stepped = Math.round(value / SCALE_STEP) * SCALE_STEP;
  return Math.round(Math.min(SCALE_MAX, Math.max(SCALE_MIN, stepped)) * 100) / 100;
}

export function getScale(): number {
  const raw = localStorage.getItem(SCALE_KEY);
  return raw === null ? 1 : clampScale(Number(raw));
}

export function applyScale(scale: number): void {
  const root = document.documentElement;
  root.style.setProperty("--ui-zoom", String(scale));
  root.style.zoom = scale === 1 ? "" : String(scale);
}

export function setScale(scale: number): number {
  const next = clampScale(scale);
  if (next === 1) localStorage.removeItem(SCALE_KEY);
  else localStorage.setItem(SCALE_KEY, String(next));
  applyScale(next);
  window.dispatchEvent(new CustomEvent("ancientvoid:scale", { detail: next }));
  return next;
}

function stepScale(direction: 1 | -1): number {
  return setScale(getScale() + direction * SCALE_STEP);
}

/** What a keydown means for the scale: 1 / -1 / 0 (reset) or null (not ours). */
export function scaleKey(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">): 1 | -1 | 0 | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  if (e.key === "+" || e.key === "=" || e.key === "Add") return 1;
  if (e.key === "-" || e.key === "_" || e.key === "Subtract") return -1;
  if (e.key === "0") return 0;
  return null;
}

/** Ctrl/⌘ + wheel, Ctrl/⌘ + plus/minus/0. Returns the cleanup. EPIC-P51 T51.5:
 * Tasten laufen über die Shortcut-Registry (eine zentrale keydown-Stelle),
 * das Rad bleibt ein eigener wheel-Listener. */
export function installScaleShortcuts(): () => void {
  let wheelAcc = 0;
  const offKeys = [
    registerShortcut("ui.zoom-in", (e) => {
      e.preventDefault();
      stepScale(1);
    }),
    registerShortcut("ui.zoom-out", (e) => {
      e.preventDefault();
      stepScale(-1);
    }),
    registerShortcut("ui.zoom-reset", (e) => {
      e.preventDefault();
      setScale(1);
    }),
  ];
  const onWheel = (e: WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    wheelAcc += e.deltaY;
    if (Math.abs(wheelAcc) < WHEEL_STEP_DELTA) return;
    stepScale(wheelAcc < 0 ? 1 : -1);
    wheelAcc = 0;
  };
  window.addEventListener("wheel", onWheel, { passive: false });
  return () => {
    for (const off of offKeys) off();
    window.removeEventListener("wheel", onWheel);
  };
}

/** Shimmer of the context bar: on by default; `prefers-reduced-motion` always wins (CSS). */
export function ctxMotionOn(): boolean {
  return localStorage.getItem(MOTION_KEY) !== "0";
}

export function applyCtxMotion(on: boolean): void {
  if (on) localStorage.removeItem(MOTION_KEY);
  else localStorage.setItem(MOTION_KEY, "0");
  document.documentElement.dataset.ctxMotion = on ? "on" : "off";
}
