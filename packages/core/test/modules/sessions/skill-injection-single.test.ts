import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Adapter } from "@ancientvoid/contracts";
import { EventStore } from "../../../src/platform/eventstore.ts";
import { SessionManager } from "../../../src/modules/sessions/session-manager.ts";
import { AdapterRegistry } from "../../../src/modules/harness/registry.ts";
import { HubDatabase } from "../../../src/platform/db.ts";
import { ProcessRunner } from "@ancientvoid/workers";
import { createAdapter as createDummy } from "@ancientvoid/adapter-dummy";

// ADR-0100 (EPIC-P72 T72.2): der Ketten-Block wird einmal geladen.
// nativeSkills-Adapter expandieren selbst — der Hub injiziert nie.
// Adapter mit fortbestehendem Kontext (nativeResume != "none") bekommen
// ihn nur im ersten Prompt; ohne Resume wird wieder injiziert.

async function waitFor(check: () => Promise<boolean>, timeoutMs = 12_000, stepMs = 20): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  if (!(await check())) throw new Error(`waitFor: condition not met within ${timeoutMs}ms`);
}

async function makeHarness(dir: string, dbFile: string, mutate: (a: Adapter) => Adapter, seen: string[], config: Record<string, unknown>) {
  const project = join(dir, `proj-${dbFile}`);
  await mkdir(join(dir, ".claude", "skills", "task"), { recursive: true });
  await writeFile(join(dir, ".claude", "skills", "task", "SKILL.md"), "---\nname: task\ndescription: form\n---\nFORM\n");
  await mkdir(join(project, ".claude", "skills", "neon"), { recursive: true });
  await writeFile(join(project, ".claude", "skills", "neon", "SKILL.md"), "---\nname: neon\ndescription: look\nextends: task\n---\nDELTA\n");
  const db = new HubDatabase(join(dir, dbFile));
  const store = new EventStore(dir);
  const registry = new AdapterRegistry();
  registry.register(
    "dummy",
    (registryConfig) => {
      const inner = mutate(createDummy(registryConfig ?? config));
      return {
        ...inner,
        start: async (spec, ctx) => {
          seen.push(spec.prompt ?? "");
          return inner.start(spec, ctx);
        },
        steer: async (handle, input, ctx) => {
          seen.push("text" in input ? input.text : `(${input.kind})`);
          return inner.steer(handle, input, ctx);
        },
      };
    },
    config,
  );
  return { manager: new SessionManager(db, store, registry, new ProcessRunner()), store };
}

async function chainSeen(manager: SessionManager, sessionId: string): Promise<boolean> {
  return (await manager.tail(sessionId, 0)).some((e) => (e.payload as { kind?: string }).kind === "session.skill_chain");
}

const live = { eventsPerSecond: 1 };
const autoStop = { eventsPerSecond: 1, autoStopAfterEvents: 1 };

describe("Skill-Kette: einmaliges Laden (ADR-0100)", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-single-inject-"));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("nativeSkills-Adapter: der Hub injiziert die Kette nie", async () => {
    const seen: string[] = [];
    const manager = (await makeHarness(dir, "native.db", (a) => ({
      ...a,
      capabilities: () => ({ ...a.capabilities(), nativeSkills: true }),
    }), seen, live)).manager;
    try {
      const record = await manager.create({ adapter: "dummy", project: join(dir, "proj-native.db"), prompt: "eins", args: { skill: "neon" } });
      await waitFor(async () => chainSeen(manager, record.id));
      expect(seen[0]).toBe("eins");
      await manager.steer(record.id, { kind: "prompt", text: "zwei" });
      await waitFor(async () => seen.length >= 2, 12_000);
      expect(seen[1]).toBe("zwei");
      // Der Ketten-Nachweis bleibt als Event erhalten (Namen, kein Body).
      const chain = (await manager.tail(record.id, 0)).find((e) => (e.payload as { kind?: string }).kind === "session.skill_chain");
      expect((chain?.payload as { names?: string[] }).names).toEqual(["task", "neon"]);
    } finally {
      await manager.shutdown();
    }
  });

  it("nativeResume != none: erster Prompt 1x, Folgeprompt 0x", async () => {
    const seen: string[] = [];
    const manager = (await makeHarness(dir, "resume.db", (a) => ({
      ...a,
      capabilities: () => ({ ...a.capabilities(), nativeResume: "native" as const }),
    }), seen, live)).manager;
    try {
      const record = await manager.create({ adapter: "dummy", project: join(dir, "proj-resume.db"), prompt: "eins", args: { skill: "neon" } });
      await waitFor(async () => chainSeen(manager, record.id));
      expect(seen[0]).toContain("FORM");
      expect(seen[0]).toContain("DELTA");
      expect(seen[0]?.endsWith("eins")).toBe(true);
      await manager.steer(record.id, { kind: "prompt", text: "zwei" });
      await waitFor(async () => seen.length >= 2, 12_000);
      expect(seen[1]).toBe("zwei");
    } finally {
      await manager.shutdown();
    }
  });

  it("ohne nativeResume und ohne nativeSkills bleibt die Injektion pro Prompt (Altfall)", async () => {
    const seen: string[] = [];
    const manager = (await makeHarness(dir, "plain.db", (a) => a, seen, live)).manager;
    try {
      const record = await manager.create({ adapter: "dummy", project: join(dir, "proj-plain.db"), prompt: "eins", args: { skill: "neon" } });
      await waitFor(async () => chainSeen(manager, record.id));
      expect(seen[0]).toContain("FORM");
      await manager.steer(record.id, { kind: "prompt", text: "zwei" });
      await waitFor(async () => seen.length >= 2, 12_000);
      expect(seen[1]).toContain("FORM");
      expect(seen[1]?.endsWith("zwei")).toBe(true);
    } finally {
      await manager.shutdown();
    }
  });

  it("liefert /compact ohne Skill-Präfix und prüft den Geltungsbereich beim Start", async () => {
    const seen: string[] = [];
    const { manager } = await makeHarness(dir, "compact.db", (a) => ({
      ...a,
      capabilities: () => ({ ...a.capabilities(), promptlessStartIdle: true, commands: [{ name: "/compact", description: "Compact", scope: "steer" }] }),
    }), seen, live);
    const spec = { adapter: "dummy", project: join(dir, "proj-compact.db"), args: { skill: "neon" } };
    try {
      await expect(manager.create({ ...spec, prompt: "/compact" })).rejects.toThrow("beim Sessionstart");
      const record = await manager.create(spec);
      await waitFor(async () => manager.get(record.id)?.status === "idle");
      expect((await manager.steer(record.id, { kind: "prompt", text: "/compact" })).ok).toBe(true);
      expect(seen).toEqual(["", "/compact"]);
      expect((await manager.steer(record.id, { kind: "prompt", text: "weiter" })).ok).toBe(true);
      expect(seen.at(-1)).toContain("FORM");
    } finally {
      await manager.shutdown();
    }
  });

  it("Neustart ohne Resume injiziert wieder — der Kontext ist dann neu", async () => {
    const seen: string[] = [];
    const mutate = (a: Adapter) => ({ ...a, capabilities: () => ({ ...a.capabilities(), nativeResume: "native" as const }) });
    const first = await makeHarness(dir, "restart.db", mutate, seen, autoStop);
    let second: Awaited<ReturnType<typeof makeHarness>> | undefined;
    try {
      const record = await first.manager.create({ adapter: "dummy", project: join(dir, "proj-restart.db"), prompt: "eins", args: { skill: "neon" } });
      await waitFor(async () => (await first.manager.tail(record.id, 0)).some((e) => e.summary === "dummy: auto-stop reached"));
      expect(seen[0]).toContain("FORM");
      await first.store.flush();
      second = await makeHarness(dir, "restart.db", mutate, seen, autoStop);
      await second.manager.recoverAll();
      const ack = await second.manager.steer(record.id, { kind: "prompt", text: "zwei" });
      expect(ack.ok).toBe(true);
      await waitFor(async () => seen.length >= 2, 12_000);
      expect(seen[1]).toContain("FORM");
      expect(seen[1]?.endsWith("zwei")).toBe(true);
    } finally {
      await second?.manager.shutdown();
      await first.manager.shutdown();
    }
  });
});
