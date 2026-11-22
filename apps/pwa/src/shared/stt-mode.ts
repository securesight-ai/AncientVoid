import { t } from "./i18n/index.ts";
/**
 * Spracheingabe: Quelle pro Geraet waehlen (ADR-0094).
 *
 * Der Hub meldet nur, OB eine lokale Erkennung da ist (BUG-0212). Welche Quelle ein
 * Geraet benutzt, war bisher allein diese Auskunft — und weil die App diese Auskunft
 * beim Start holt und haelt, blieb ein Geraet unter Umstaenden in der Browser-/Cloud-
 * Erkennung stehen, obwohl laengst lokale Erkennung am Hub lief. Kai will das aus-
 * druecklich: Handy ueber den Browser (schnell, Cloud), Tablet ueber den Hub (lokal).
 *
 * Deshalb eine gespeicherte Wahl pro Geraet: "auto" (bisheriges Verhalten), "lokal"
 * (nur der Hub, sonst klare Ansage) und "browser" (absichtliche Cloud, auch wenn
 * der Hub koennte). Nie eine stillschweigende Wolke, wenn jemand "lokal" gewaehlt hat.
 */

export type SttModus = "auto" | "lokal" | "browser";
export type SttPfad = "lokal" | "browser" | "kein";

export interface SttFaehigkeiten {
  /** Der Hub hat eine erreichbare eigene Erkennung. */
  lokalVerfuegbar: boolean;
  /** Dieses Geraet kann aufnehmen (Mikrofon + MediaRecorder/AudioWorklet). */
  aufnahmeMoeglich: boolean;
  /** Dieser Browser bringt eigene Spracherkennung mit (meist Cloud). */
  browserFaehig: boolean;
}

const SCHLUESSEL = "ancientvoid.stt-modus.v1";
const ERLAUBT: readonly SttModus[] = ["auto", "lokal", "browser"] as const;

/** Eigener Name, damit andere Offnungen der App die Wahl sofort hoeren. */
export const EREIGNIS = "ancientvoid:stt-modus";

function speicher(): Storage | null {
  try {
    const s = (globalThis as { localStorage?: Storage }).localStorage;
    if (!s) return null;
    s.getItem(SCHLUESSEL);
    return s;
  } catch {
    return null; // Privacy-Modus / gesperrter Speicher: laeuft ohne Merken weiter.
  }
}

/** Gibt die Wahl an andere Offnungen derselben App weiter, wenn der Trog das kann. */
function verteile(ereignis: string) {
  try {
    const g = globalThis as { dispatchEvent?: (e: Event) => void };
    if (typeof g.dispatchEvent === "function") g.dispatchEvent(new Event(ereignis));
  } catch {
    /* Dispatch kann in sonderbaren Trogen fehlen — die eigene Offnung kennt den Wert. */
  }
}

export function liesstModus(): SttModus {
  const s = speicher();
  if (!s) return "auto";
  let rohwert: string | null = null;
  try {
    rohwert = s.getItem(SCHLUESSEL);
  } catch {
    return "auto";
  }
  return (ERLAUBT as readonly string[]).includes(rohwert ?? "") ? (rohwert as SttModus) : "auto";
}

/** Setzt die Wahl und gibt zurueck, was tatsaechlich gilt (ohne Speicher: "auto"). */
export function setzeModus(modus: SttModus): SttModus {
  const s = speicher();
  if (!s || !(ERLAUBT as readonly string[]).includes(modus)) return liesstModus();
  try {
    s.setItem(SCHLUESSEL, modus);
  } catch {
    return "auto";
  }
  verteile(EREIGNIS);
  return modus;
}

/** Die Entscheidung: welche Quelle kommt beim Draufdruecken zum Zug? */
export function waehlePfad(modus: SttModus, f: SttFaehigkeiten): SttPfad {
  if (modus === "browser") return f.browserFaehig ? "browser" : "kein";
  const lokalGeht = f.lokalVerfuegbar && f.aufnahmeMoeglich;
  if (modus === "lokal") return lokalGeht ? "lokal" : "kein";
  if (lokalGeht) return "lokal";
  return f.browserFaehig ? "browser" : "kein";
}

/** Ehrlicher Satz fuer den Fall, dass die gewaehlte Quelle nicht geht. */
export function grund(modus: SttModus, f: SttFaehigkeiten): string {
  const lokalGeht = f.lokalVerfuegbar && f.aufnahmeMoeglich;
  if (modus === "lokal" && !lokalGeht) {
    return f.lokalVerfuegbar
      ? t("stt.device_cannot_record")
      : t("stt.local_unreachable_switch");
  }
  if (modus === "browser" && !f.browserFaehig) return t("stt.browser_none_switch");
  if (!lokalGeht && !f.browserFaehig) return t("stt.none_available");
  return "";
}

/**
 * Titel des Mikro-Knopfs: beschreibt, was ein Druck TUN wird — inklusive Wolke.
 * Die Einstellung selbst steht an der Eingabe (Automatisch/Lokal/Browser), der
 * Knopf nennt die Quelle, die jetzt tatsächlich drankommt.
 */
export function titelDesKnopfs(pfad: SttPfad, engine?: string): string {
  if (pfad === "lokal") return t("stt.btn_local", { engine: engine ?? "whisper" });
  if (pfad === "browser") return t("stt.btn_browser");
  return t("stt.btn_none");
}

/** Kurzer, ehrlicher Hinweis unter der Eingabe: was gerade gilt. */
export function modusHinweis(modus: SttModus, f: SttFaehigkeiten, engine?: string): string {
  const pfad = waehlePfad(modus, f);
  if (pfad === "lokal") return engine ? `${t("stt.hint_local")}: ${engine}` : t("stt.hint_local");
  if (pfad === "browser") return t("stt.hint_browser");
  return grund(modus, f) || t("stt.hint_none");
}
