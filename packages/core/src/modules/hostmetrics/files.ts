import { readFile, readdir, realpath } from "node:fs/promises";
import { basename } from "node:path";

const code = (err: unknown): string | undefined => (err as { code?: string }).code;

/** Fehlende oder gerade nicht lesbare Datei = null; kein Recht ist davon unterscheidbar über `readGuarded`. */
export async function readText(path: string): Promise<string | null> {
  try {
    return (await readFile(path, "utf8")).trim();
  } catch {
    return null;
  }
}

export async function readNumber(path: string): Promise<number | null> {
  const text = await readText(path);
  const n = text ? Number(text) : NaN;
  return Number.isFinite(n) ? n : null;
}

export async function readGuarded(path: string): Promise<{ text: string | null; denied: boolean }> {
  try {
    return { text: (await readFile(path, "utf8")).trim(), denied: false };
  } catch (err) {
    return { text: null, denied: code(err) === "EACCES" || code(err) === "EPERM" };
  }
}

export async function list(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).sort();
  } catch {
    return [];
  }
}

/** Name des Geräts hinter einem sysfs-Link, z. B. `0000:2d:00.0`. */
export async function deviceName(link: string): Promise<string | null> {
  try {
    return basename(await realpath(link));
  } catch {
    return null;
  }
}
