// EPIC-P61 (ADR-0101): Katalog Englisch — typgeprüft gegen de.ts; fehlt ein
// Key, ist das ein tsc-Fehler. Bereichs-Dateien in en/ werden hier aggregiert.
import type { de } from "./de.ts";
import { en as dock } from "./en/dock.ts";
import { en as inference } from "./en/inference.ts";

export const en: Record<keyof typeof de, string> = {
  ...dock,
  ...inference,

  "settings.language.title": "Language",
  "settings.language.hint": "Per-device setting; follows the system on first use. Changing it reloads the app — drafts are kept.",
  "settings.language.auto": "Automatic",

  "error.rate_limited.one": "Too many requests — retry in {n} second.",
  "error.rate_limited.other": "Too many requests — retry in {n} seconds.",
};
