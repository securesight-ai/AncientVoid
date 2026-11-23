import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, HubConfig } from "../../src/platform/config.ts";

/** ADR-0087 Nachtrag 2026-11-23: terminals[].shell + terminalAutodetect. */
describe("HubConfig terminals (ADR-0087)", () => {
  it("lokale Ziele dürfen eine Shell (Pfad oder Name) benennen", () => {
    const cfg = HubConfig.parse({
      terminals: [
        { id: "hub", label: "Hub-Host", local: true, shell: "/usr/bin/zsh" },
        { id: "hub2", label: "Zweites", local: true, shell: "fish" },
      ],
    });
    expect(cfg.terminals[0]?.shell).toBe("/usr/bin/zsh");
    expect(cfg.terminals[1]?.shell).toBe("fish");
  });

  it("shell nur für local=true — auf ssh-Zielen ein Parse-Fehler (fail loud)", () => {
    expect(() =>
      HubConfig.parse({ terminals: [{ id: "evo", label: "evo", ssh: "evo", shell: "zsh" }] }),
    ).toThrow(/shell nur für local/);
  });

  it("shell mit Whitespace/Metazeichen wird abgelehnt (wandert in script -c)", () => {
    expect(() =>
      HubConfig.parse({ terminals: [{ id: "hub", label: "H", local: true, shell: "bash; rm -rf /" }] }),
    ).toThrow();
  });

  it("terminalAutodetect: Default an, explizit abschaltbar", () => {
    expect(DEFAULT_CONFIG.terminalAutodetect).toBe(true);
    expect(HubConfig.parse({}).terminalAutodetect).toBe(true);
    expect(HubConfig.parse({ terminalAutodetect: false }).terminalAutodetect).toBe(false);
  });
});
