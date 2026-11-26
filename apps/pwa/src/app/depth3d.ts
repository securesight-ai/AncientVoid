/**
 * EPIC-P86 T86.1: die Tiefenebene der Oberfläche — Blätter und Fenster
 * fliegen beim Öffnen ein Stück auf den Betrachter zu (CSS-3D, ohne
 * three.js; die Flüge selbst liegen in styles/61-depth3d.css).
 *
 * Ablage und Ereignis folgen dem ctxMotion-Muster (ui-scale.ts): an ist der
 * Default, localStorage hält nur das explizite „0“, jede Änderung setzt das
 * Attribut am Wurzelelement und meldet es als Ereignis. Kaskade:
 * prefers-reduced-motion > Bewegung (ctxMotion) > 3D (hier) — die CSS-Seite
 * wertet alle drei selbst aus; `depth3dAllowed()` ist der effektive Zustand
 * für Schalter, die ihn anzeigen (Sidebar, Dock, Einstellungen).
 */
import { motionAllowed } from "../shared/motion.ts";

/** localStorage-Schlüssel der Tiefenebene („0“ = aus, alles andere = an). */
export const DEPTH3D_KEY = "ancientvoid.depth3d";

/** Feuert nach jeder Änderung (Detail: neuer eigener Schalterzustand). */
export const DEPTH3D_EVENT = "ancientvoid:depth3d";

/** Der eigene Schalter — ohne die Bewegungs-Kaskade. */
export function depth3dOn(): boolean {
  return localStorage.getItem(DEPTH3D_KEY) !== "0";
}

export function applyDepth3d(on: boolean): void {
  if (on) localStorage.removeItem(DEPTH3D_KEY);
  else localStorage.setItem(DEPTH3D_KEY, "0");
  document.documentElement.setAttribute("data-ctx-3d", on ? "on" : "off");
  window.dispatchEvent(new CustomEvent(DEPTH3D_EVENT, { detail: on }));
}

export function toggleDepth3d(): void {
  applyDepth3d(!depth3dOn());
}

/** Effektiver Zustand: der Flug läuft nur, wenn auch Bewegung erlaubt ist. */
export function depth3dAllowed(): boolean {
  return depth3dOn() && motionAllowed();
}
