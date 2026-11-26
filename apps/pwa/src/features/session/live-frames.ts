import type { StreamFrameView } from "../../shared/ws.ts";

/** Was die Anzeige während eines laufenden Zugrahmens zeigt (angesammerte Teiltexte). */
export interface LiveText {
  assistant: string;
  thinking: string;
}

/** Was eine Rahmen-Serie für die Live-Anzeige bedeutet. Rein — keine Hooks, kein DOM:
 *  der einzige Ort, der entscheidet, welche Teiltexte in die wachsende Blase gehören.
 *  ADR-0083: Rahmen sind transiente Teiltexte; der Block bleibt das einzige persistierte
 *  Ereignis. Ein Rahmen ohne Text verändert nichts. */
export interface LiveZuwachs {
  assistant: string;
  thinking: string;
  /** turnIds, die gerade laufen (nach dieser Serie). */
  offen: string[];
  /** turnIds, deren Block mit dieser Serie eingetroffen ist. */
  geschlossen: string[];
}

/** Zählt die Teiltexte einer Rahmen-Serie und führt die offenen Ströme mit.
 *  `offenVorher` wird nicht verändert — die Funktion liefert die neue Menge. */
export function liveZuwachs(frames: StreamFrameView[] | undefined, offenVorher: ReadonlySet<string> = new Set()): LiveZuwachs {
  const offen = new Set(offenVorher);
  const geschlossen: string[] = [];
  let assistant = "";
  let thinking = "";
  for (const f of frames ?? []) {
    if (f.turnId && f.stream) {
      if (f.final) {
        offen.delete(f.turnId);
        geschlossen.push(f.turnId);
      } else {
        offen.add(f.turnId);
      }
    }
    if (!f.text) continue;
    if (f.stream === "assistant") assistant += f.text;
    else if (f.stream === "thinking") thinking += f.text;
  }
  return { assistant, thinking, offen: [...offen], geschlossen };
}
