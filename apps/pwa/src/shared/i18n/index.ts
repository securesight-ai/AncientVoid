// EPIC-P61 (ADR-0101): i18n-Laufzeit der PWA. Kein Framework — Kataloge als
// Daten, `t()` als Map-Lookup (K2: kein Frame-Lag), Plural über
// Intl.PluralRules, fehlender Schlüssel: sichtbarer Fallback auf de +
// console.warn im Dev-Build, nie leerer Text.
import { de } from "./de.ts";
import { en } from "./en.ts";

export type I18nKey = keyof typeof de;
export type LanguageCode = "de" | "en";

export interface LanguageEntry {
  code: LanguageCode;
  /** Eigenbezeichnung — Sprachoptionen nennen sich immer in ihrer Sprache. */
  label: string;
  /** Browsersprach-Match über das Präfix (de-AT → de). */
  aliases: readonly string[];
  catalog: Record<string, string>;
  /**Migration abgeschlossen (check-i18n-Baseline leer) — bis dahin nur Dev-Flag. */
  complete: boolean;
}

// Die modulare Sprachliste (Nutzerentscheid 17.11.2026): eine Sprache = ein
// Eintrag hier plus Katalogdatei. Der Browsersprach-Match gilt automatisch
// für jede neue Sprache.
export const availableLanguages: LanguageEntry[] = [
  { code: "de", label: "Deutsch", aliases: ["de"], catalog: de, complete: true },
  { code: "en", label: "English", aliases: ["en"], catalog: en, complete: false },
];

export const LANGUAGE_SETTING_KEY = "ancientvoid.language";
export type LanguageSetting = "auto" | LanguageCode;

// ADR-0101: Geräte-Einstellung wie die Presets, try/catch-Fallback auf
// „Automatisch" (Privacy-Modus wirft auf localStorage-Zugriff).
export function getLanguageSetting(): LanguageSetting {
  try {
    const raw = globalThis.localStorage?.getItem(LANGUAGE_SETTING_KEY);
    return raw === "de" || raw === "en" ? raw : "auto";
  } catch {
    return "auto";
  }
}

export function setLanguageSetting(setting: LanguageSetting): void {
  try {
    if (setting === "auto") globalThis.localStorage?.removeItem(LANGUAGE_SETTING_KEY);
    else globalThis.localStorage?.setItem(LANGUAGE_SETTING_KEY, setting);
  } catch {
    /* Gerät ohne Persistenz: bleibt bei auto. */
  }
}

/** Browsersprache gegen die Sprachliste matchen (Sprachpräfix), ohne Treffer Englisch. */
export function matchBrowserLanguage(browserLanguage: string | undefined): LanguageCode {
  const prefix = (browserLanguage ?? "").toLowerCase().split(/[-_]/)[0];
  for (const entry of availableLanguages) if (entry.aliases.includes(prefix)) return entry.code;
  return "en";
}

/** Die Sprache, in der die Oberfläche gerade spricht. */
export function resolveLanguage(setting: LanguageSetting = getLanguageSetting(), browserLanguage?: string): LanguageCode {
  if (setting !== "auto") return setting;
  return matchBrowserLanguage(browserLanguage ?? (typeof navigator !== "undefined" ? navigator.language : undefined));
}

export function languageEntry(code: LanguageCode): LanguageEntry {
  return availableLanguages.find((l) => l.code === code) ?? availableLanguages[0];
}

/** `<html lang>` folgt der gewählten Sprache (T61.2). */
export function applyLanguage(setting: LanguageSetting = getLanguageSetting()): LanguageCode {
  const code = resolveLanguage(setting);
  if (typeof document !== "undefined") document.documentElement.lang = code;
  return code;
}

const pluralRules = new Map<LanguageCode, Intl.PluralRules>();
function rules(code: LanguageCode): Intl.PluralRules {
  let r = pluralRules.get(code);
  if (!r) {
    r = new Intl.PluralRules(code);
    pluralRules.set(code, r);
  }
  return r;
}

function lookup(code: LanguageCode, key: string): string | undefined {
  // Fallback-Kette (ADR-0101): gewählte Sprache → en → de. de ist die
  // Quelle; ein fehlender Schlüssel ist trotzdem ein Fail-loud-Fall.
  const chain: LanguageCode[] = code === "en" ? ["en", "de"] : [code, "en", "de"];
  for (const c of chain) {
    const v = languageEntry(c).catalog[key];
    if (v !== undefined) return v;
  }
  return undefined;
}

function warnMissing(key: string): void {
  if (typeof import.meta !== "undefined" && (import.meta as { env?: { DEV?: boolean } }).env?.DEV) console.warn(`i18n: fehlender Schlüssel „${key}“`);
}

function interpolate(template: string, params: Record<string, string | number | undefined> | undefined): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (params[name] !== undefined ? String(params[name]) : whole));
}

/**
 * Übersetzung für `key`. Plural: Schlüssel-Suffixe `.one`/`.other` (usw.) —
 * vorhanden wenn `params.count` eine Zahl ist und ein Suffix-Schlüssel
 * existiert; Auswahl über Intl.PluralRules der Zielsprache.
 */
export function t(key: I18nKey | string, params?: Record<string, string | number | undefined>): string {
  const code = resolveLanguage();
  let found = key as string;
  if (typeof params?.count === "number") {
    const pluralKey = `${key}.${rules(code).select(params.count)}`;
    if (lookup(code, pluralKey) !== undefined) found = pluralKey;
    else if (lookup(code, `${key}.other`) !== undefined) found = `${key}.other`;
  }
  const value = lookup(code, found);
  if (value === undefined) {
    warnMissing(String(key));
    return String(key); // fail loud, nie leer
  }
  return interpolate(value, params);
}

/** Für Tests und Settings: vollständige Schlüsselmenge der Quelle. */
export function catalogKeys(): string[] {
  return Object.keys(de).sort();
}

/**
 * EPIC-P61 T61.7 / ADR-0101: Hub-Nachrichten rendern — Katalogschlüssel zuerst,
 * ein unbekannter Schlüssel zeigt den mitgelieferten Titel (fail-loud nur im
 * Dev-Konsolen-Warnpfad von t(), hier schlichter Fallback).
 */
export function resolveNotificationTitle(n: { title: string; messageKey?: string | null; params?: Record<string, string | number> | null }): string {
  if (!n.messageKey) return n.title;
  const template = lookup(resolveLanguage(), n.messageKey);
  return template === undefined ? n.title : interpolate(template, n.params ?? undefined);
}

/**
 * EPIC-P61 T61.7 / ADR-0101: API-Fehler mit strukturiertem code werden über
 * `error.<code>` übersetzt; ein unbekannter Code zeigt den Hub-Text unverändert.
 */
export function errorText(code: string | undefined, hubMessage: string, params?: Record<string, string | number | undefined>): string {
  if (!code) return hubMessage;
  const template = lookup(resolveLanguage(), `error.${code}`);
  return template === undefined ? hubMessage : interpolate(template, params);
}
