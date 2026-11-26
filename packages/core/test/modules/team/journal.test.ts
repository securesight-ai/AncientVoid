import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TeamEvent } from "@ancientvoid/contracts";
import { encodeTeamEvent, teamEventHash, teamGenesisPrevHash } from "../../../src/modules/team/envelope.ts";
import { openTeamJournal } from "../../../src/modules/team/journal.ts";

/** EPIC-P83 T83.4 S2 (ADR-0119 §4, K7): Journal — Append/fsync, Truncate, Freeze. */

function ev(seq: number, prevHash: string, extras: Partial<TeamEvent> = {}): TeamEvent {
  return {
    v: 1,
    teamId: "team-j",
    stream: "task:1",
    epoch: 1,
    seq,
    prevHash,
    at: new Date().toISOString(),
    kind: "task.offered",
    command: null,
    commandSig: null,
    body: { n: seq },
    ...extras,
  };
}

describe("EPIC-P83 T83.4 — Journal", () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "av-journal-")); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it("hängt Ereignisse an, fsynced, überlebt Reload mit gleichem Kopf", () => {
    const j = openTeamJournal({ dataDir: root, teamId: "team-j", stream: "task:1" });
    const e0 = ev(0, teamGenesisPrevHash());
    expect(j.append(e0).ok).toBe(true);
    const e1 = ev(1, teamEventHash(encodeTeamEvent(e0)));
    const r1 = j.append(e1);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    j.persist();
    expect(existsSync(join(root, "teams", "team-j", "snapshot.json"))).toBe(true);

    const re = openTeamJournal({ dataDir: root, teamId: "team-j", stream: "task:1" });
    expect(re.entries).toHaveLength(2);
    expect(re.headHash()).toBe(r1.hash);
    expect(re.frozen).toBe(false);
  });

  it("schneidet defekte letzte Zeile ab und meldet truncatedTail", () => {
    const j = openTeamJournal({ dataDir: root, teamId: "team-j", stream: "task:1" });
    const e0 = ev(0, teamGenesisPrevHash());
    expect(j.append(e0).ok).toBe(true);
    const path = join(root, "teams", "team-j", "events.jsonl");
    writeFileSync(path, readFileSync(path, "utf8") + "{not-json\n");

    const re = openTeamJournal({ dataDir: root, teamId: "team-j", stream: "task:1" });
    expect(re.truncatedTail).toBe(true);
    expect(re.entries).toHaveLength(1);
    expect(re.frozen).toBe(false);
  });

  it("friert bei Hash-Bruch in der Mitte ein", () => {
    const j = openTeamJournal({ dataDir: root, teamId: "team-j", stream: "task:1" });
    const e0 = ev(0, teamGenesisPrevHash());
    j.append(e0);
    const bad = ev(1, "a".repeat(64));
    const path = join(root, "teams", "team-j", "events.jsonl");
    writeFileSync(path, readFileSync(path, "utf8") + Buffer.from(encodeTeamEvent(bad)).toString("utf8") + "\n");

    const re = openTeamJournal({ dataDir: root, teamId: "team-j", stream: "task:1" });
    expect(re.frozen).toBe(true);
    expect(re.entries).toHaveLength(1);
    expect(re.append(ev(1, teamEventHash(encodeTeamEvent(e0)))).ok).toBe(false);
  });
});
