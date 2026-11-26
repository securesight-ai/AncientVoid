/**
 * ADR-0093: die Ablage nimmt beim Wiederkommen auf, was außerhalb kopiert wurde.
 *
 * Der Browser erlaubt das Lesen des System-Clipsboards nur, wenn das Fenster dran ist —
 * deshalb wird beim Fokus und beim Sichtbarwerden einmal geschaut, nicht dauerhaft.
 * Was kopiert wurde, während die App zu war, kann kein Web-Feature nachholen; das steht
 * auch im Ablageblatt.
 */
import { pushShelf, pushShelfImage } from "./clipboard-shelf.ts";
import { MAX_IMAGE_BYTES, saveImage } from "./clipboard-images.ts";

export const INGEST_EVENT = "ancientvoid:clipboard-ingest";
const SCHALTER_SCHLUESSEL = "ancientvoid.clipboard-ingest.v1";
/** Zwei Blicke ins Clipboard mindestens drei Sekunden auseinander — kein Lausch-Timer. */
const MIN_ABSTAND_MS = 3_000;
const BILD_TYPEN = ["image/png", "image/jpeg"] as const;

export function ingestEnabled(): boolean {
  try {
    return localStorage.getItem(SCHALTER_SCHLUESSEL) !== "aus";
  } catch {
    return true;
  }
}

export function setIngestEnabled(an: boolean): void {
  try {
    localStorage.setItem(SCHALTER_SCHLUESSEL, an ? "an" : "aus");
  } catch {
    // Privater Modus: der Schalter gilt fuer diese Sitzung.
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(INGEST_EVENT));
}

/** Ein Ablage-Stueck, wie der Browser es liefert (testbar, ohne echtes Clipboard). */
export interface ClipboardStueck {
  types: readonly string[];
  getType(type: string): Promise<Blob>;
}

/** Was aus einem Clipboard-Stueck wird — rechnerisch, damit die Spec das pruefen kann. */
export function einordnung(stueck: { types: readonly string[] }): { art: "bild"; typ: string } | { art: "text" } | null {
  const bild = stueck.types.find((typ) => (BILD_TYPEN as readonly string[]).includes(typ));
  if (bild) return { art: "bild", typ: bild };
  if (stueck.types.includes("text/plain")) return { art: "text" };
  return null;
}

/** Bilder messen — ohne Bild-Decoder (Knoten-Testlauf) ehrlich mit 0 × 0. */
async function abmessen(blob: Blob): Promise<{ width: number; height: number }> {
  try {
    if (typeof createImageBitmap !== "function") return { width: 0, height: 0 };
    const bild = await createImageBitmap(blob);
    const masse = { width: bild.width, height: bild.height };
    bild.close?.();
    return masse;
  } catch {
    return { width: 0, height: 0 };
  }
}

let zuletztGesehen = 0;

/**
 * Einen Blick ins Clipboard tun. `lesen` ist der Einstiegspunkt — im Test ein
 * kuenstliches Clipboard, sonst das echte. Rueckgabe zaehlt, was angekommen ist.
 */
export async function readOnce(
  lesen: () => Promise<readonly ClipboardStueck[]> = () => navigator.clipboard.read(),
): Promise<{ texte: number; bilder: number; uebersprungen: number }> {
  if (!ingestEnabled()) return { texte: 0, bilder: 0, uebersprungen: 0 };
  let texte = 0;
  let bilder = 0;
  let uebersprungen = 0;
  const stuecke = await lesen();
  for (const stueck of stuecke) {
    const plan = einordnung(stueck);
    if (!plan) {
      uebersprungen += 1;
      continue;
    }
    if (plan.art === "bild") {
      const blob = await stueck.getType(plan.typ);
      if (!blob.size || blob.size > MAX_IMAGE_BYTES) {
        uebersprungen += 1;
        continue;
      }
      const masse = await abmessen(blob);
      const bild = await saveImage({ blob, mime: plan.typ, width: masse.width, height: masse.height });
      if (bild.ignored) {
        uebersprungen += 1;
        continue;
      }
      pushShelfImage({ asset: bild.id, mime: plan.typ, bytes: blob.size, width: masse.width, height: masse.height });
      bilder += 1;
      continue;
    }
    const blob = await stueck.getType("text/plain");
    const text = await blob.text();
    if (pushShelf(text, "andere-app")) texte += 1;
    else uebersprungen += 1;
  }
  return { texte, bilder, uebersprungen };
}

/** Wie der Browser zur Erlaubnis steht — fuer den ehrlichen Hinweis im Blatt. */
export async function erlaubnisLage(): Promise<"erlaubt" | "verweigert" | "weiss nicht"> {
  try {
    const abfrage = await navigator.permissions?.query?.({ name: "clipboard-read" as PermissionName });
    if (!abfrage) return "weiss nicht";
    return abfrage.state === "granted" ? "erlaubt" : abfrage.state === "denied" ? "verweigert" : "weiss nicht";
  } catch {
    return "weiss nicht";
  }
}

/** Beim Wiederkommen hinschauen — spaetestens alle drei Sekunden, nie dauernd. */
export function installClipboardIngest(): () => void {
  if (typeof window === "undefined" || typeof navigator?.clipboard?.read !== "function") return () => undefined;
  const schauen = () => {
    const jetzt = Date.now();
    if (jetzt - zuletztGesehen < MIN_ABSTAND_MS) return;
    zuletztGesehen = jetzt;
    void readOnce().catch(() => undefined);
  };
  const aufSichtbarkeit = () => {
    if (document.visibilityState === "visible") schauen();
  };
  window.addEventListener("focus", schauen);
  document.addEventListener("visibilitychange", aufSichtbarkeit);
  return () => {
    window.removeEventListener("focus", schauen);
    document.removeEventListener("visibilitychange", aufSichtbarkeit);
  };
}
