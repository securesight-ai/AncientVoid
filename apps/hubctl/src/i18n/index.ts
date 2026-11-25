// hubctl-eigener Katalog (EPIC-P61 T61.8, ADR-0101): --lang > AV_LANG > LANG, Standard en.
// t() ist Lookup + Interpolation (K2); unbekannte Schlüssel werfen (fail loud).
// --json-Ausgabe bleibt sprachneutral — hier hängen nur Menschaltexte dran.
import { de, type HubctlMsgKey } from "./de.ts";
import { en } from "./en.ts";

export type HubctlLang = "de" | "en";
export type { HubctlMsgKey } from "./de.ts";

const catalogs: Record<HubctlLang, Record<string, string>> = { de, en };

export function resolveLang(cliLang?: string, avLang?: string, sysLang?: string): HubctlLang {
  for (const value of [cliLang, avLang, sysLang]) {
    if (!value) continue;
    const lower = value.toLowerCase();
    if (lower.startsWith("de")) return "de";
    if (lower.startsWith("en")) return "en";
  }
  return "en";
}

let cliLang: string | undefined;

export function setCliLang(value: string | undefined): void {
  cliLang = value;
}

function currentLang(): HubctlLang {
  return resolveLang(cliLang, process.env.AV_LANG, process.env.LANG);
}

export function translate(lang: HubctlLang, key: string, params?: Record<string, string | number | undefined>): string {
  const raw = catalogs[lang][key];
  if (raw === undefined) throw new Error(`hubctl-i18n: unknown key "${key}"`);
  return raw.replace(/\{(\w+)\}/g, (whole, name: string) => String(params?.[name] ?? whole));
}

export function t(key: HubctlMsgKey, params?: Record<string, string | number | undefined>): string {
  return translate(currentLang(), key, params);
}
