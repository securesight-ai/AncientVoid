// EPIC-P61 T61.7 (ADR-0101): kleiner Server-Katalog — nur für hub-seitig
// gerenderte Push-Texte (der Hub rendert Push selbst, kein Client-Code beim
// Empfang). Auswahl über `locale` des Abos. Die PWA hat ihren eigenen,
// größeren Katalog (apps/pwa/src/shared/i18n/); dieser hier enthält nur, was
// der Hub über die Leitung bringt. Parität de↔en prüft ein Core-Test.
import { de } from "./de.ts";
import { en } from "./en.ts";

export type ServerMessageKey = keyof typeof de;
type Catalog = Record<string, string>;

const catalogs: Record<"de" | "en", Catalog> = { de, en };

export function serverCatalog(locale: "de" | "en"): Catalog {
  return catalogs[locale] ?? catalogs.de;
}

/** Interpolation `{name}` — fehlende Params bleiben als Platzhalter stehen. */
export function renderServerMessage(key: ServerMessageKey | string, locale: "de" | "en", params: Record<string, string | number> = {}): string {
  const template = serverCatalog(locale)[key] ?? serverCatalog("de")[key] ?? "";
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (params[name] !== undefined ? String(params[name]) : whole));
}
