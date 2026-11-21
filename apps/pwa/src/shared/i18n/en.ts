// EPIC-P61 (ADR-0101): Katalog Englisch — typgeprüft gegen de.ts; fehlt ein
// Key, ist das ein tsc-Fehler. Bereichs-Dateien in en/ werden hier aggregiert.
import type { de } from "./de.ts";
import { en as dock } from "./en/dock.ts";
import { en as notifications } from "./en/notifications.ts";
import { en as common } from "./en/common.ts";
import { en as inference } from "./en/inference.ts";

export const en: Record<keyof typeof de, string> = {
  ...dock,
  ...notifications,
  ...common,
  ...inference,

  "settings.language.title": "Language",
  "settings.language.hint": "Per-device setting; follows the system on first use. Changing it reloads the app — drafts are kept.",
  "settings.language.auto": "Automatic",

  "error.adapter_not_allowed": "Loop adapters are not allowed as team workers.",
  "error.rate_limited.one": "Too many requests — retry in {n} second.",
  "error.rate_limited.other": "Too many requests — retry in {n} seconds.",
};
