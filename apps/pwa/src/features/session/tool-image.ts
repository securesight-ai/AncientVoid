import type { NormalizedEvent } from "../../shared/ws.ts";

/** Sitzung, wie die Sitzungsansicht sie kennt: eigene Id plus Projektwurzel. */
export type SessionRef = { id: string; project: string };

/** Ziel für `/api/code/raw`: Zielart (Projekt oder Sitzungs-Arbeitsverzeichnis) und der relative Pfad. */
export type ToolImageRef = {
  /** Query-Teil für `/api/code/raw` — `project=…` oder `session=…`. */
  target: string;
  /** Pfad relativ zur Zielwurzel (nie absolut). */
  path: string;
  /** Dateiname für Beschriftung. */
  name: string;
};

const BILD_ENDUNG = /\.(png|jpe?g|gif|webp|bmp|avif)$/i;

/**
 * Bildpfade, die ein Werkzeug nur als **Text** nennt (Nutzerfund 2026-11-23: ein
 * `bash`-Lauf gab `neonsunset_shot1.png 200 65140 …` zurück — die Dateien waren da,
 * aber im Chat führte kein Weg hin). Pfade ohne Leerzeichen; alles mit `://` oder
 * `..` wird bewusst verworfen, weil der Hub es nicht ausliefern würde.
 */
const BILD_PFAD_IN_TEXT = /\/?[A-Za-z0-9_.+@%-]*(?:\/[A-Za-z0-9_.+@%-]+)*\.(?:png|jpe?g|gif|webp|bmp|avif)(?![A-Za-z0-9])/g;

/** Unbrauchbar: URLs, Verstecke, Sprünge über die Wurzel hinaus. */
function untauglicherPfad(pfad: string): boolean {
  if (!pfad || pfad.includes("//")) return true;
  return pfad.split("/").some((segment) => segment === ".." || (segment.length > 1 && segment.startsWith(".")));
}

/** Werkzeuge, deren Ausgabe Dateinamen im Text nennt (Shell-Schale aller Adapter). */
const SCHALEN_WERKZEUGE = new Set(["bash", "shell", "exec", "exec_command", "local_shell_call", "container.exec"]);

/** Hochstens so viele Vorschläge pro Werkzeugausgabe — sonst zugemüllte Chats. */
const MAX_VORSCHLAEGE = 6;

/**
 * `cd` in einer zusammengesetzten Schalenzeile; das **letzte** zählt. Verlangt eine
 * Befehlsposition (Zeilenanfang, `;`, `|`, `&&`, Klammer) — sonst verschluckt ein
 * Argument wie `sed 's/cd alt/cd neu/' file && ls` ein `cd`, das nie ausgeführt wurde.
 */
const CD_IM_BEFEHL = /(?:^|[;&|\n\r(])\s*cd\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|)]+))/g;

/** Der Befehl einer Schalen-Nutzung (Schlüssel je nach Adapter verschieden). */
function befehlAusEingabe(eingabe: unknown): string {
  if (typeof eingabe !== "object" || eingabe === null) return "";
  const r = eingabe as Record<string, unknown>;
  for (const schlüssel of ["command", "cmd", "shell", "script"]) {
    if (typeof r[schlüssel] === "string") return r[schlüssel] as string;
  }
  return "";
}

/**
 * Von welcher Wurzel aus die **relativen** Namen in einer Schalen-Ausgabe zu lesen
 * sind. Ein `cd` verschiebt sie, und ohne das zu beachten zeigen Vorschauen ins
 * Leere: eigene Sitzung 7d3df295 (Arbeitsverzeichnis `/home/kaib/repos/ancientvoid-suche`)
 * lieferte `cd /home/kaib/repos/AncientVoid && ls -1 apps/pwa/public/icons/*.png` —
 * über die Sitzungsroute hätte es 404 heißen müssen, denn unter der Sitzungs­wurzel
 * gibt es diese Pfade nicht. `null` heißt: Wurzel nicht bestimmbar (relatives `cd`,
 `~`, Shell-Variable, Ziel außerhalb des Projekts) — dann lieber gar keine Vorschau
 * als eine, die ins Leere zeigt.
 */
function ausgabeWurzel(befehl: string, ref: SessionRef): { praefix: string } | null {
  let aktuell: string | undefined;
  let verschoben = false;
  for (const treffer of befehl.matchAll(CD_IM_BEFEHL)) {
    const ziel = (treffer[1] ?? treffer[2] ?? treffer[3] ?? "").trim().replace(/[,;)\]]+$/, "");
    verschoben = true;
    if (!ziel || ziel === ".") continue;
    if (!ziel.startsWith("/") && aktuell === undefined) return null; // ausgehend von einer unbekannten Wurzel raten
    const teil = ziel.startsWith("/") ? ziel.split("/") : `${aktuell}`.split("/").concat(ziel.split("/"));
    const sauber: string[] = [];
    for (const segment of teil) {
      if (!segment || segment === ".") continue;
      if (segment === "..") sauber.pop();
      else if (segment.includes("$") || segment.startsWith("~")) return null; // Variable oder Home → unbekannt
      else sauber.push(segment);
    }
    aktuell = `/${sauber.join("/")}`;
  }
  if (!verschoben || aktuell === undefined) return { praefix: "" };
  const wurzel = ref.project.endsWith("/") ? ref.project : `${ref.project}/`;
  if (!aktuell.startsWith(wurzel)) return null;
  const praefix = aktuell.slice(wurzel.length);
  return { praefix: praefix ? `${praefix}/` : "" };
}

/**
 * Welche Sitzung darf eine Vorschau bekommen? Nur die eigene des laufenden Hubs.
 * Sitzungsdatensatz **und** fremder Rechner werden getrennt betrachtet: jeder
 * Datensatz trägt eine `hostId`, auch der eigene Hub (Nachweis live: Sitzung
 * 7d3df295 hat `hostId: "cachyos-ai"`). Wer nur prüft, ob `hostId` gesetzt ist,
 * schließt die eigenen Sitzungen aus — genau das war der Fehler am
 * 23.11.2026: die Bildvorschau erschien nirgends, obwohl Route und Detektor
 * funktionierten. Deshalb entscheidet hier der Vergleich mit der eigenen
 * `hostId`, nicht die Frage, ob überhaupt eine dasteht.
 */
export function sessionRefFor(
  session: { id: string; project?: string | null; hostId?: string | null } | undefined,
  fremderRechner: string | null,
): SessionRef | undefined {
  if (!session || fremderRechner) return undefined;
  if (!session.project) return undefined;
  return { id: session.id, project: session.project };
}

function pfadAusEingabe(input: unknown): string {
  if (typeof input !== "object" || input === null) return "";
  const r = input as Record<string, unknown>;
  for (const schlüssel of ["path", "file_path", "file", "filePath"]) {
    if (typeof r[schlüssel] === "string" && r[schlüssel] !== "") return String(r[schlüssel]);
  }
  return "";
}

/**
 * Ein Pfad → das, was der Hub ausliefern kann: absolute Pfade nur innerhalb der
 * Projektwurzel (Projekt-Route), relative relativ zum Arbeitsverzeichnis der
 * Sitzung (Sitzungs-Route). Alles andere bewusst `null`.
 */
function refFuerPfad(pfad: string, ref: SessionRef, praefix = ""): ToolImageRef | null {
  if (untauglicherPfad(pfad)) return null;
  const name = pfad.split("/").pop() ?? pfad;
  if (pfad.startsWith("/")) {
    const wurzel = ref.project.endsWith("/") ? ref.project : `${ref.project}/`;
    if (!pfad.startsWith(wurzel)) return null;
    return { target: `project=${encodeURIComponent(ref.project)}`, path: pfad.slice(wurzel.length), name };
  }
  if (praefix) {
    return { target: `project=${encodeURIComponent(ref.project)}`, path: `${praefix}${pfad}`, name };
  }
  return { target: `session=${encodeURIComponent(ref.id)}`, path: pfad, name };
}

/**
 * Nutzerfund 2026-11-23: ein Bild-Lesevorgang erschien im Chat als
 * `Read image file [image/png][image]` — der reine Hinweis, das Bild selbst war
 * nirgends zu sehen oder zu öffnen. Der Werkzeug-Aufruf trägt aber den Pfad, und
 * die Hub-Rohroute liefert die Bytes jeder erlaubten Projektdatei. Also: dasselbe
 * Bild als Vorschau und als vollen Link, ohne neue Rechte (gleiche Route, gleicher
 * Token, gleiche Projekt-Allowlist wie der Datei-Betrachter).
 *
 * Zurückgegeben wird nur, was der Hub auch ausliefern *kann*: relative Pfade
 * laufen über die Sitzungsroute (Wurzel = Arbeitsverzeichnis der Sitzung),
 * absolute nur, wenn sie innerhalb der Projektwurzel liegen. Alles andere liefert
 * bewusst `null`, damit keine Vorschau ins Leere zeigt.
 */
export function toolImageRef(event: NormalizedEvent, result: NormalizedEvent | undefined, ref: SessionRef | undefined): ToolImageRef | null {
  if (event.type !== "tool_use" || !ref) return null;
  const payload = event.payload as { name?: unknown; input?: unknown };
  if (payload.name !== "read") return null;
  const pfad = pfadAusEingabe(payload.input);
  if (!pfad || !BILD_ENDUNG.test(pfad)) return null;
  // Ein fehlgeschlagenes Lesen hat kein Bild — die Fehlerzeile bleibt stehen.
  if (result && (result.payload as { isError?: boolean }).isError === true) return null;

  return refFuerPfad(pfad, ref);
}

/** Text einer Werkzeugausgabe — Inhalte sind String oder Blöcke. */
function werkzeugText(event: NormalizedEvent): string {
  const payload = event.payload as { content?: unknown; summary?: unknown };
  if (typeof payload.content === "string") return payload.content;
  if (Array.isArray(payload.content)) {
    return payload.content
      .map((block) => (typeof block === "string" ? block : typeof (block as { text?: unknown })?.text === "string" ? String((block as { text: string }).text) : ""))
      .join("\n");
  }
  return typeof payload.summary === "string" ? payload.summary : "";
}

/**
 * Bilder, die ein Werkzeug **erfolgreich gelesen** hat (direkt, als Vorschau) und
 * solche, die es nur im Ausgabe-Text erwähnt (Vorschlag als Chip-Kette). Die
 * Vorschläge holen erst Bytes, wenn der Nutzer sie öffnet — eine Liste aus 30
 * Dateinamen in einer `ls`-Ausgabe lädt also nicht 30 Bilder.
 */
export function toolImageHits(
  event: NormalizedEvent,
  result: NormalizedEvent | undefined,
  ref: SessionRef | undefined,
): { direkt: ToolImageRef[]; vorschlaege: ToolImageRef[]; nichtGezeigt: number } {
  const direkt: ToolImageRef[] = [];
  const vorschlaege: ToolImageRef[] = [];
  let nichtGezeigt = 0;
  if (!ref) return { direkt, vorschlaege, nichtGezeigt };
  const gelesen = toolImageRef(event, result, ref);
  if (gelesen) direkt.push(gelesen);
  if (!result) return { direkt, vorschlaege, nichtGezeigt };

  const nutzung = event.type === "tool_use" ? (event.payload as { name?: unknown }) : undefined;
  const werkzeug = typeof nutzung?.name === "string" ? nutzung.name.toLowerCase() : "";
  if (!SCHALEN_WERKZEUGE.has(werkzeug)) return { direkt, vorschlaege, nichtGezeigt };

  const wurzel = ausgabeWurzel(befehlAusEingabe((event.payload as { input?: unknown }).input), ref);
  if (!wurzel) return { direkt, vorschlaege, nichtGezeigt };

  const schon = new Set(direkt.map((b) => bildpfad(b)));
  const kandidaten: ToolImageRef[] = [];
  for (const kandidat of werkzeugText(result).match(BILD_PFAD_IN_TEXT) ?? []) {
    const bild = refFuerPfad(kandidat, ref, wurzel.praefix);
    if (!bild) continue;
    const schluessel = `${bild.target}\u0000${bildpfad(bild)}`;
    if (schon.has(schluessel)) continue;
    schon.add(schluessel);
    kandidaten.push(bild);
  }
  vorschlaege.push(...kandidaten.slice(0, MAX_VORSCHLAEGE));
  // Eine `ls` mit 40 Namen zeigt sechs Chips — aber sie verheimlicht nicht, dass
  // noch 34 warten. Stillschweigend kürzen wäre eine Lüge über die Datenmenge.
  nichtGezeigt = Math.max(0, kandidaten.length - MAX_VORSCHLAEGE);
  return { direkt, vorschlaege, nichtGezeigt };
}

/** Schlüssel für Chips: Ziel **und** Pfad, sonst öffnen zwei gleich benannte
 * Dateien (eine im Projekt, eine im Sitzungsordner) immer zusammen. */
export function bildpfad(bild: ToolImageRef): string {
  return `${bild.target}\u0000${bild.path}`;
}
