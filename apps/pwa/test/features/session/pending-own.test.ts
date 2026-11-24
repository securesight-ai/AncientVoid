import { describe, expect, it } from "vitest";
import type { QueuedPrompt } from "../../../src/shared/api.ts";
import { pendingOwnRows } from "../../../src/features/session/pending-own.ts";

// BUG-0280: Eine vorgemerkte eigene Eingabe soll im Chat als eigene Zeile mit
// Status sichtbar sein — mit vollem Text, in der Reihenfolge des Hubs.

function item(id: string, text: string, extra: Partial<QueuedPrompt> = {}): QueuedPrompt {
  return { id, text, createdAt: `2026-11-24T00:0${id}:00Z`, actor: null, attachments: 0, position: Number(id), ...extra };
}

describe("pendingOwnRows (BUG-0280)", () => {
  it("liefert volle Texte in der Reihenfolge des Hubs", () => {
    const rows = pendingOwnRows([item("1", "zweite Meldung", { position: 1 }), item("0", "dritte Meldung", { position: 0 })]);
    expect(rows.map((r) => r.text)).toEqual(["dritte Meldung", "zweite Meldung"]);
  });

  it("kürzt den Text nicht (die Streifen-Ansicht darf kürzen, die Chat-Zeile nicht)", () => {
    const lang = "x".repeat(300);
    expect(pendingOwnRows([item("0", lang)])[0]!.text).toBe(lang);
  });

  it("zeigt den Status: wartend oder Annahme unklar", () => {
    const rows = pendingOwnRows([item("0", "a"), item("1", "b", { delivery: "unknown" })]);
    expect(rows[0]!.status).toBe("waiting");
    expect(rows[1]!.status).toBe("unknown");
  });

  it("ohne Warteschlange keine Zeilen", () => {
    expect(pendingOwnRows([])).toEqual([]);
  });
});
