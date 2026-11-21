import { describe, expect, it } from "vitest";
import { formatMainSyncApply, formatMainSyncCheck } from "../src/main-sync.ts";
import type { MainSyncApplyResult, MainSyncCheckResult } from "@ancientvoid/contracts";

// Ausgabe-Assertions sind sprachfest — Sprache hier pinnen (EPIC-P61 T61.8).
process.env.AV_LANG = "de";

const check = (patch: Partial<MainSyncCheckResult>): MainSyncCheckResult => ({
  sessionId: "s1",
  branch: "main",
  behind: 0,
  ahead: 0,
  clean: true,
  conflicts: null,
  checkedAt: "2026-11-18T12:00:00.000Z",
  lastSyncedAt: null,
  ...patch,
});

describe("EPIC-P67 T67.9 — hubctl main-sync (Formatierung)", () => {
  it("Check: aktuell mit Probelauf-Schluss und Abgleichsstand", () => {
    expect(formatMainSyncCheck(check({ lastSyncedAt: "2026-11-18T11:00:00.000Z" }), "abc")).toEqual([
      "abc · origin/main: aktuell",
      "probelauf: sauber",
      expect.stringMatching(/zuletzt abgeglichen: .+/),
    ]);
  });

  it("Check: Rückstand, Ungesichertes und Konfliktliste werden genannt", () => {
    const lines = formatMainSyncCheck(check({ behind: 3, ahead: 1, clean: false, conflicts: ["a.ts", "b.ts"] }), "abc");
    expect(lines[0]).toBe("abc · origin/main: 3 hinten, 1 vorn · Worktree hat Ungesichertes");
    expect(lines[1]).toBe("konflikt (Probelauf): a.ts, b.ts");
  });

  it("Apply: alle vier Ausgänge als Zeile", () => {
    expect(formatMainSyncApply({ outcome: "applied", from: "aaa", to: "bbb", files: ["x.ts"] } as MainSyncApplyResult)).toBe("ok: origin/main eingemischt (aaa → bbb, 1 Datei)");
    expect(formatMainSyncApply({ outcome: "conflict", files: ["a.ts"] } as MainSyncApplyResult)).toBe("konflikt in a.ts — nichts verändert, in der Session lösen");
    expect(formatMainSyncApply({ outcome: "skipped", reason: "session-busy", detail: "Session ist working" } as MainSyncApplyResult)).toBe("übersprungen (session-busy: Session ist working)");
    expect(formatMainSyncApply({ outcome: "failed", reason: "offline" } as MainSyncApplyResult)).toBe("gescheitert (offline)");
  });
});
