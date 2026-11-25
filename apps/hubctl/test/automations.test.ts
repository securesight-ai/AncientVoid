import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { buildAutomationDefinition, buildAutomationUpdate, formatAutomationLine, formatHistoryLine, type AutomationInfo } from "../src/automations.ts";
import type { AutomationDefinition } from "@ancientvoid/contracts";

// Ausgabe-Assertions sind sprachfest — Sprache hier pinnen (EPIC-P61 T61.8).
process.env.AV_LANG = "de";

/** EPIC-P41 T41.5: Definitions- und Format-Helfer des hubctl-automations-Commands. */

const SESSION_JSON = {
  label: "Morgen-Briefing",
  hostId: "host-a",
  schedule: { kind: "cron", cron: "30 8 * * *", timezone: "Europe/Berlin" },
  target: { kind: "session", harness: "dummy", workdir: "worktree", project: "/tmp/repo", promptBlobSha256: "" },
  precheckDeadlineMs: 60_000,
  grant: { maxParallel: 1, missedGraceMs: 0 },
};

describe("buildAutomationDefinition", () => {
  it("ergänzt id/generation/enabled/createdAt und setzt den Prompt-Blob-Verweis (K5)", () => {
    const def = buildAutomationDefinition(JSON.stringify(SESSION_JSON), "Mein Prompt") as unknown as {
      id: string; generation: number; enabled: boolean; createdAtUtc: string;
      target: { promptBlobSha256: string };
    };
    expect(def.id.length).toBeGreaterThan(10);
    expect(def.generation).toBe(1);
    expect(def.enabled).toBe(false); // Neuanfang-Zustand: Aktivierung ist die separate Freigabe.
    expect(def.createdAtUtc.length).toBeGreaterThanOrEqual(20);
    expect(def.target.promptBlobSha256).toBe(createHash("sha256").update("Mein Prompt").digest("hex"));
  });

  it("übernimmt vorhandene id/createdAt und lässt Swarm-Ziele ohne Prompt zu (ADR-0123: run- und team-Aliase normalisieren)", () => {
    const def = buildAutomationDefinition(
      JSON.stringify({ ...SESSION_JSON, id: "fest-1", createdAtUtc: "2026-11-12T08:00:00.000Z", target: { kind: "run", templateId: "tpl-1" } }),
      null,
    ) as { id: string; createdAtUtc: string; target: { kind: string } };
    expect(def.id).toBe("fest-1");
    expect(def.createdAtUtc).toBe("2026-11-12T08:00:00.000Z");
    expect(def.target.kind).toBe("swarm");
    const viaTeam = buildAutomationDefinition(JSON.stringify({ ...SESSION_JSON, target: { kind: "team", templateId: "tpl-2" } }), null) as { target: { kind: string } };
    expect(viaTeam.target.kind).toBe("swarm");
    const native = buildAutomationDefinition(JSON.stringify({ ...SESSION_JSON, target: { kind: "swarm", templateId: "tpl-3" } }), null) as { target: { kind: string } };
    expect(native.target.kind).toBe("swarm");
  });

  it("verweigert Session-Ziel ohne Prompt-Text und ohne vorhandenen Blob-Verweis", () => {
    expect(() => buildAutomationDefinition(JSON.stringify(SESSION_JSON), null)).toThrow(/Prompt-Text/);
  });

  it("verweigert kaputtes JSON und Ziel ohne kind", () => {
    expect(() => buildAutomationDefinition("{kein json", null)).toThrow(/ungültig/);
    expect(() => buildAutomationDefinition(JSON.stringify({ label: "x" }), null)).toThrow(/target/);
  });

  it("lässt Skript-Ziele zu und erzwingt project + actionId (ADR-0080)", () => {
    const built = buildAutomationDefinition(JSON.stringify({ ...SESSION_JSON, target: { kind: "script", project: "/tmp/repo", actionId: "npm-test" } }), null) as { target: { kind: string; project: string; actionId: string } };
    expect(built.target).toEqual({ kind: "script", project: "/tmp/repo", actionId: "npm-test" });
    expect(() => buildAutomationDefinition(JSON.stringify({ ...SESSION_JSON, target: { kind: "script", project: "/tmp/repo" } }), null)).toThrow(/actionId/);
    expect(() => buildAutomationDefinition(JSON.stringify({ ...SESSION_JSON, target: { kind: "script", actionId: "npm-test" } }), null)).toThrow(/actionId/);
  });
});

describe("formatAutomationLine", () => {
  const info: AutomationInfo = {
    definition: {
      id: "0123456789abcdef", label: "Morgen-Briefing", generation: 1, enabled: true, hostId: "host-a",
      schedule: { kind: "cron", cron: "30 8 * * *", timezone: "Europe/Berlin" },
      target: { kind: "session", harness: "dummy", workdir: "worktree", project: "/tmp/repo", promptBlobSha256: "" },
      precheckDeadlineMs: 60_000, grant: { maxParallel: 1, missedGraceMs: 0 }, createdAtUtc: "2026-11-12T07:00:00.000Z",
    },
    nextOccurrences: [{ utc: "2026-11-13T07:30:00.000Z", local: "2026-11-13 08:30" }],
    lastOccurrence: { utc: "2026-11-12T07:30:00.000Z", state: "dispatched", sessionId: "s-1" },
  };

  it("zeigt Label, Zustand, Plan, Zeitzone, nächsten Termin und letztes Ergebnis", () => {
    const line = formatAutomationLine(info);
    expect(line).toContain("an");
    expect(line).toContain("Morgen-Briefing");
    expect(line).toContain("30 8 * * *");
    expect(line).toContain("Europe/Berlin");
    expect(line).toContain("2026-11-13T07:30:00.000Z");
    expect(line).toContain("dispatched");
  });

  it("zeigt aus/Striche bei frischer deaktivierter Automation", () => {
    const line = formatAutomationLine({
      ...info,
      definition: { ...info.definition, enabled: false },
      nextOccurrences: [],
      lastOccurrence: null,
    });
    expect(line).toContain("aus");
    expect(line).toContain("next —");
    expect(line).toContain("last —");
  });
});

describe("buildAutomationUpdate", () => {
  const previous = {
    id: "fest-1", label: "alt", generation: 3, enabled: true, hostId: "host-a",
    schedule: { kind: "cron", cron: "30 8 * * *", timezone: "Europe/Berlin" },
    target: { kind: "session", harness: "dummy", project: "/tmp/repo", workdir: "worktree", promptBlobSha256: "a".repeat(64) },
    precheckDeadlineMs: 60_000, grant: { maxParallel: 1, missedGraceMs: 0 },
    createdAtUtc: "2026-11-12T07:00:00.000Z",
  } as unknown as AutomationDefinition;

  it("hält id/generation/enabled/createdAt an previous fest, auch gegen den Patch", () => {
    const out = buildAutomationUpdate(JSON.stringify({ label: "neu", generation: 99, enabled: false, createdAtUtc: "2020-01-01T00:00:00.000Z" }), previous, null);
    expect(out).toMatchObject({ id: "fest-1", generation: 3, enabled: true, createdAtUtc: "2026-11-12T07:00:00.000Z", label: "neu" });
  });

  it("setzt den Prompt-Blob nur bei neuem Text und merged schedule/grant feldweise", () => {
    const mitText = buildAutomationUpdate(JSON.stringify({ grant: { missedGraceMs: 90_000 } }), previous, "Neuer Prompt");
    expect((mitText.target as { promptBlobSha256: string }).promptBlobSha256).toBe(createHash("sha256").update("Neuer Prompt").digest("hex"));
    expect(mitText.grant).toEqual({ maxParallel: 1, missedGraceMs: 90_000 });
    const ohneText = buildAutomationUpdate(JSON.stringify({ label: "x" }), previous, null);
    expect((ohneText.target as { promptBlobSha256: string }).promptBlobSha256).toBe("a".repeat(64));
  });

  it("lehnt Nicht-Objekte laut ab", () => {
    expect(() => buildAutomationUpdate("[1,2]", previous, null)).toThrow(/Objekt/);
  });
});

describe("formatHistoryLine", () => {
  const base = { claimKey: "a:1:x", automationId: "a", generation: 1, occurrenceUtc: "2026-11-12T07:30:00.000Z", at: "2026-11-12T07:30:05.000Z" } as const;

  it("zeigt bei unklarem Start die Begründung statt eines leeren Zustands", () => {
    const line = formatHistoryLine({ ...base, state: "unknown", detail: "Neustart nach Claim ohne bestätigte Dispatch-Referenz; kein Replay" });
    expect(line).toContain("unknown");
    expect(line).toContain("kein Replay");
  });

  it("zeigt Grund, Ergebnis, Referenzen, Art und zusammengefasste verpasste Termine", () => {
    expect(formatHistoryLine({ ...base, state: "skipped", reason: "missed", missedThroughUtc: "2026-11-12T07:29:00.000Z", kind: "catchup" }))
      .toMatch(/skipped\/missed {2}catchup {2}verpasst bis 2026-11-12T07:29:00.000Z/);
    expect(formatHistoryLine({ ...base, state: "settled", outcome: "failed", swarmId: "r-1" })).toMatch(/settled failed {2}swarm r-1/);
  });
});
