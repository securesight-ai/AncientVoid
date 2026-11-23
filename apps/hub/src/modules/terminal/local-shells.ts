import { accessSync, readFileSync, constants } from "node:fs";
import { basename } from "node:path";

/**
 * ADR-0087 Nachtrag 2026-11-23: Shells auf dem Hub-Host automatisch als
 * lokale Terminal-Ziele anbieten. Erkennung aus /etc/shells (root-verwaltet),
 * Fallback-Sonde häufiger Pfade, wenn die Datei fehlt/leer ist.
 */

export interface LocalShell {
  /** Basename des Pfads, z. B. „zsh“ — Slug für id und Dupe-Erkennung. */
  name: string;
  /** Absoluter Pfad, an `script -c` übergeben. */
  path: string;
}

/** Bevorzugte Reihenfolge im Auswahl-Menü; Unbekannte alphabetisch dahinter. */
const PREFERRED = ["bash", "zsh", "fish", "sh", "dash"] as const;

/** Sonde, wenn /etc/shells fehlt oder leer ist (NixOS, Container). */
const FALLBACK_PATHS = [
  "/bin/bash",
  "/usr/bin/bash",
  "/bin/zsh",
  "/usr/bin/zsh",
  "/usr/bin/fish",
  "/bin/fish",
  "/bin/sh",
  "/bin/dash",
] as const;

function readEtcShells(): string[] | null {
  try {
    const lines = readFileSync("/etc/shells", "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("/"));
    return lines.length > 0 ? lines : null;
  } catch {
    return null;
  }
}

function isExecutableFile(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Installierte Login-Shells, dedupliziert nach Name, deterministisch
 * sortiert (bash, zsh, fish, sh, dash, dann Rest alphabetisch).
 * Pfade mit Whitespace werden verworfen — sie wandern in einen
 * `script -c`-Befehl und dürfen kein Wortsplitting erlauben.
 */
export function detectLocalShells(
  readShellsFile: () => string[] | null = readEtcShells,
  executable: (path: string) => boolean = isExecutableFile,
): LocalShell[] {
  const candidates = readShellsFile() ?? [...FALLBACK_PATHS];
  const byName = new Map<string, LocalShell>();
  for (const path of candidates) {
    // Nur absolute Pfade: relative würden als cwd-relative Befehle scheitern.
    if (!path.startsWith("/") || /\s/.test(path)) continue;
    const name = basename(path);
    if (!name || name === "." || name === "..") continue;
    if (byName.has(name) || !executable(path)) continue;
    byName.set(name, { name, path });
  }
  return [...byName.values()].sort((a, b) => {
    const pa = PREFERRED.indexOf(a.name as (typeof PREFERRED)[number]);
    const pb = PREFERRED.indexOf(b.name as (typeof PREFERRED)[number]);
    if (pa !== -1 || pb !== -1) return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
    return a.name.localeCompare(b.name);
  });
}

export interface LocalShellTarget {
  id: string;
  label: string;
  local: true;
  shell: string;
}

/**
 * Erkannte Shells an die konfigurierte Allowlist anhängen — config first,
 * damit `terminals[0]` der PWA-Auswahl vom Betreiber bleibt. Übersprungen:
 * Shells, die ein lokales Config-Ziel schon startet (Default bash), und
 * ids, die die Config schon belegt.
 */
export function mergeLocalShells<T extends { id: string; local?: boolean | undefined; shell?: string | undefined }>(
  configured: readonly T[],
  detected: readonly LocalShell[],
): LocalShellTarget[] {
  const takenIds = new Set(configured.map((t) => t.id));
  const takenShells = new Set(
    configured.filter((t) => t.local === true).map((t) => basename(t.shell ?? "bash")),
  );
  const added: LocalShellTarget[] = [];
  for (const shell of detected) {
    if (takenShells.has(shell.name)) continue;
    const id = `local-${shell.name}`;
    if (takenIds.has(id)) continue;
    takenIds.add(id);
    takenShells.add(shell.name);
    added.push({ id, label: `${shell.name} (Hub-Host)`, local: true, shell: shell.path });
  }
  return added;
}
