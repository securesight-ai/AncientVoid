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

function pfadAusEingabe(input: unknown): string {
  if (typeof input !== "object" || input === null) return "";
  const r = input as Record<string, unknown>;
  for (const schlüssel of ["path", "file_path", "file", "filePath"]) {
    if (typeof r[schlüssel] === "string" && r[schlüssel] !== "") return String(r[schlüssel]);
  }
  return "";
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

  const name = pfad.split("/").pop() ?? pfad;
  if (pfad.startsWith("/")) {
    const wurzel = ref.project.endsWith("/") ? ref.project : `${ref.project}/`;
    if (!pfad.startsWith(wurzel)) return null;
    return { target: `project=${encodeURIComponent(ref.project)}`, path: pfad.slice(wurzel.length), name };
  }
  return { target: `session=${encodeURIComponent(ref.id)}`, path: pfad, name };
}
