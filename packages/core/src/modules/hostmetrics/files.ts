import { readFile, readdir, realpath } from "node:fs/promises";
import { basename, join } from "node:path";

/** Lesender Zugriff auf einen Host-Baum: lokal über node:fs, beim NAS über einen Abzug. */
export interface HostFiles {
  /** `denied` trennt „kein Recht“ von „gibt es nicht“. */
  read(path: string): Promise<{ text: string | null; denied: boolean }>;
  list(dir: string): Promise<string[]>;
  /** Name des Geräts hinter einem sysfs-Link, z. B. `0000:2d:00.0`. */
  linkName(path: string): Promise<string | null>;
}

export function localFiles(root = "/"): HostFiles {
  return {
    async read(path) {
      try {
        return { text: (await readFile(join(root, path), "utf8")).trim(), denied: false };
      } catch (err) {
        const code = (err as { code?: string }).code;
        return { text: null, denied: code === "EACCES" || code === "EPERM" };
      }
    },
    async list(dir) {
      try {
        return (await readdir(join(root, dir))).sort();
      } catch {
        return [];
      }
    },
    async linkName(path) {
      try {
        return basename(await realpath(join(root, path)));
      } catch {
        return null;
      }
    },
  };
}

/** Ein Abzug kennt nur die Dateien, die der fremde Host geschickt hat. */
export function snapshotFiles(files: ReadonlyMap<string, string>): HostFiles {
  return {
    read: async (path) => ({ text: files.get(path) ?? null, denied: false }),
    list: async (dir) => {
      const prefix = `${dir}/`;
      const names = new Set<string>();
      for (const path of files.keys()) if (path.startsWith(prefix)) names.add(path.slice(prefix.length).split("/")[0]!);
      return [...names].sort();
    },
    linkName: async (path) => (files.has(path) ? basename(files.get(path)!) : null),
  };
}

export async function readText(files: HostFiles, path: string): Promise<string | null> {
  return (await files.read(path)).text;
}

export async function readNumber(files: HostFiles, path: string): Promise<number | null> {
  const text = await readText(files, path);
  const n = text ? Number(text) : NaN; // leere Datei ist keine 0 (ADR-0023)
  return Number.isFinite(n) ? n : null;
}
