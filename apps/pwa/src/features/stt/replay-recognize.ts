import { dropRecording, getRecording, type ReplaySummary } from "../../shared/stt-replay.ts";
import { hubApi } from "../../shared/api.ts";
import { replaceOrPasteTranscript } from "./paste-target.ts";

/**
 * ADR-0092 (Nachtrag 21.11.2026): „neu erkennen“ lebt in der Ablage — dieselbe
 * Aufnahme ein zweites Mal durch die eigene Erkennung schicken und den alten Text
 * ersetzen, wenn er noch unveraendert im Feld steht. Kein zusätzlicher Platz am
 * Eingabefeld; die Zahl am Ablage-Knopf zeigt, dass etwas wartet.
 */

/** Laeuft die Neu-Erkennung gerade? (Taste darf nicht zweimal druecken.) */
let beschaeftigt = false;

/**
 * Neu erkennen. Rueckgabe ist der Hinweis fuer die Ablage — ehrlich darueber, was
 * mit dem Feld passiert ist: ersetzt, angehaengt, oder gar nicht (kein Feld).
 */
export async function reRecognize(aufnahme: ReplaySummary): Promise<{ ok: boolean; note: string }> {
  if (beschaeftigt) return { ok: false, note: "läuft schon" };
  const voll = await getRecording(aufnahme.id);
  if (!voll) return { ok: false, note: "Aufnahme ist nicht mehr da" };
  beschaeftigt = true;
  try {
    const t = await hubApi.transcribe(voll.blob);
    if (!t.text) return { ok: false, note: "wieder nichts erkannt — Aufnahme bleibt gemerkt" };
    const ergebnis = await replaceOrPasteTranscript(voll.text, t.text, { origin: "diktat" });
    const wie = ergebnis.mode === "replace" ? "ersetzt" : voll.text ? "angehängt — das Feld war von Hand geändert" : "eingefügt";
    const wo = ergebnis.where === "pasted" ? "" : " · nur Zwischenablage";
    await dropRecording(aufnahme.id);
    return { ok: true, note: `${t.engine} · ${(t.latencyMs / 1000).toFixed(1)} s · ${wie}${wo}` };
  } catch (err) {
    return { ok: false, note: `${err instanceof Error ? err.message : "Neu-Erkennung fehlgeschlagen"} — Aufnahme bleibt gemerkt` };
  } finally {
    beschaeftigt = false;
  }
}

export async function discardReplay(aufnahme: ReplaySummary): Promise<void> {
  await dropRecording(aufnahme.id);
}
