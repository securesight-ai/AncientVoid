import { describe, expect, it } from "vitest";
import { Swarm } from "@ancientvoid/contracts";
import { readSwarmSnapshot, swarmCacheKey, writeSwarmSnapshot } from "../../../src/features/swarm/swarm-cache.ts";

const mem = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => mem.get(key) ?? null,
    setItem: (key: string, value: string) => void mem.set(key, value),
    removeItem: (key: string) => void mem.delete(key),
  },
});

function swarm(id: string): Swarm {
  return {
    id,
    title: `Swarm ${id}`,
    goal: "Ziel",
    project: "/tmp/p",
    frame: { adapters: ["dummy"], coordinatorAdapter: null, models: ["m1"], maxTasks: 8, maxDispatchesPerTask: 2, maxParallel: 2 },
    planSource: "given",
    coordinatorSessionId: null,
    origin: null,
    status: "done",
    tasks: [],
    gates: [],
    deliveries: [],
    createdAt: "2026-11-14T10:00:00.000Z",
    updatedAt: "2026-11-14T10:05:00.000Z",
    endedAt: null,
  };
}

describe("EPIC-P60/P83 — Swarms-Offlinekopie (K10)", () => {
  it("schreibt und liest einen Snapshot formtreu zurück", () => {
    const key = "ancientvoid.swarms.v1:test:k";
    writeSwarmSnapshot(key, { at: "2026-11-14T12:00:00.000Z", list: [swarm("t-1"), swarm("t-2")] });
    const back = readSwarmSnapshot(key);
    expect(back?.at).toBe("2026-11-14T12:00:00.000Z");
    expect(back?.list.map((t) => t.id)).toEqual(["t-1", "t-2"]);
    expect(back?.list[0]?.frame.models).toEqual(["m1"]);
    localStorage.removeItem(key);
  });

  it("verwirft unlesbare/kaputte Kopien fail-loud-ersatzweise als null (nie halbe Projektion)", () => {
    localStorage.setItem("ancientvoid.swarms.v1:test:x", "{kaputt");
    expect(readSwarmSnapshot("ancientvoid.swarms.v1:test:x")).toBeNull();
    localStorage.setItem("ancientvoid.swarms.v1:test:y", JSON.stringify({ at: "not-a-date", list: [] }));
    expect(readSwarmSnapshot("ancientvoid.swarms.v1:test:y")).toBeNull();
    localStorage.removeItem("ancientvoid.swarms.v1:test:x");
    localStorage.removeItem("ancientvoid.swarms.v1:test:y");
  });

  it("Cache-Schlüssel enthält Scope und Token-Hash, nie den Token-Klartext", async () => {
    const key = await swarmCacheKey("/api/swarms", "geheim-token");
    expect(key).toContain("/api/swarms");
    expect(key).not.toContain("geheim-token");
    expect(key.length).toBeGreaterThan("/api/swarms".length + 10);
  });
});
