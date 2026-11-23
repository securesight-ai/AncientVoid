import { describe, expect, it } from "vitest";
import { createAdapter } from "../src/index.ts";

/** ADR-0042/P25: maki-Commands hängen an der Host-seitigen init.lua-Brücke —
 * deklariert wird nur mit bridgeCommands:true, sonst bleibt die Liste leer. */
describe("acp capabilities().commands — maki-Brücke (bridgeCommands)", () => {
  it("ohne Flag: maki deklariert nichts (fail loud für Hosts ohne Brücke)", () => {
    const caps = createAdapter({ preset: "maki" }).capabilities();
    expect(caps.commands).toBeUndefined();
  });

  it("mit Flag: genau die Brücken-Commands, wohlgeformt", () => {
    const caps = createAdapter({ preset: "maki", bridgeCommands: true }).capabilities();
    const names = (caps.commands ?? []).map((c) => c.name);
    // BUG-0079: deklariert ist nur, was der Adapter belegt ausführt —
    // /compact und /rename haben im getriebenen Modus keinen Beleg.
    expect(names).toEqual(["/new"]);
    for (const c of caps.commands ?? []) {
      expect(c.scope).toBe("both");
      expect(c.description.length).toBeGreaterThan(3);
    }
  });

  it("andere Presets bleiben unberührt (copilot ja, maki-ohne-Flag nein)", () => {
    expect(createAdapter({ preset: "copilot" }).capabilities().commands?.map((c) => c.name)).toEqual(["/compact", "/usage"]);
    expect(createAdapter({ preset: "maki", bridgeCommands: false }).capabilities().commands).toBeUndefined();
  });
});

/** BUG-0192: opencode führt advertised Commands im getriebenen ACP-Modus als
 * Prompt-Text aus — live belegt 17.11.2026 gegen opencode 2.1.4: /compact
 * lief als Command (compaction started→completed, reason "manual", kein
 * Modellturn), /init und /review advertised über dieselbe Registry. */
describe("acp capabilities().commands — preset opencode (BUG-0192)", () => {
  it("deklariert genau die belegten Commands, wohlgeformt", () => {
    const caps = createAdapter({ preset: "opencode" }).capabilities();
    const names = (caps.commands ?? []).map((c) => c.name);
    expect(names).toEqual(["/init", "/review", "/compact"]);
    for (const c of caps.commands ?? []) {
      expect(c.scope).toBe("both");
      expect(c.description.length).toBeGreaterThan(3);
      expect(c.name).toMatch(/^\/[a-z0-9-]+$/);
    }
  });

  it("/new ist kein Agent-Command von opencode — wird nie deklariert", () => {
    const names = createAdapter({ preset: "opencode" }).capabilities().commands?.map((c) => c.name) ?? [];
    expect(names).not.toContain("/new");
  });

  it("custom command ohne Preset deklariert weiter nichts (unbekannter Harness)", () => {
    expect(createAdapter({ command: ["opencode"], env: {} }).capabilities().commands).toBeUndefined();
  });
});

it("advertises /fresh for OMP ACP 19.1.1, which dispatches /fresh and rejects /new", () => {
  const commands = createAdapter({ preset: "omp" }).capabilities().commands;
  expect(commands?.map(({ name, scope }) => [name, scope])).toEqual([["/fresh", "both"], ["/compact", "both"]]);
});
