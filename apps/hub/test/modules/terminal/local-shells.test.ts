import { describe, expect, it } from "vitest";
import { detectLocalShells, mergeLocalShells } from "../../../src/modules/terminal/local-shells.ts";

/** ADR-0087 Nachtrag 2026-11-23: Nutzerwunsch — installierte Shells auf der
 * Maschine automatisch zur Auswahl stellen, statt nur die Config-Allowlist. */
describe("detectLocalShells", () => {
  it("liest /etc/shells: Kommentare weg, nicht ausführbare Pfade weg, nach Name dedupliziert", () => {
    const shells = detectLocalShells(
      () => [
        "# Kommentar",
        "/bin/sh",
        "/bin/bash",
        "/usr/bin/bash", // Duplikat zu /bin/bash
        "/usr/bin/zsh",
        "/opt/kein-exec-bit/fish",
        "relativer/pfad",
      ],
      (p) => !p.startsWith("/opt/"),
    );
    expect(shells).toEqual([
      { name: "bash", path: "/bin/bash" },
      { name: "zsh", path: "/usr/bin/zsh" },
      { name: "sh", path: "/bin/sh" },
    ]);
  });

  it("Reihenfolge: bash, zsh, fish, sh, dash — Rest alphabetisch dahinter", () => {
    const shells = detectLocalShells(
      () => ["/bin/nu", "/bin/dash", "/bin/fish", "/bin/zsh", "/bin/bash", "/bin/sh"],
      () => true,
    );
    expect(shells.map((s) => s.name)).toEqual(["bash", "zsh", "fish", "sh", "dash", "nu"]);
  });

  it("ohne /etc/shells: Fallback-Sonde auf ausführbare Kandidaten", () => {
    const shells = detectLocalShells(
      () => null,
      (p) => p === "/usr/bin/zsh" || p === "/bin/bash",
    );
    expect(shells).toEqual([
      { name: "bash", path: "/bin/bash" },
      { name: "zsh", path: "/usr/bin/zsh" },
    ]);
  });

  it("nichts installiert: leere Liste, kein Wurf", () => {
    expect(detectLocalShells(() => null, () => false)).toEqual([]);
    expect(detectLocalShells(() => [], () => true)).toEqual([]);
  });
});

describe("mergeLocalShells", () => {
  it("config first, erkannte Shells dahinter; Default-Shell bash zählt als belegt", () => {
    const merged = mergeLocalShells(
      [{ id: "hub", label: "Hub-Host", local: true }],
      [
        { name: "bash", path: "/bin/bash" },
        { name: "zsh", path: "/usr/bin/zsh" },
      ],
    );
    expect(merged).toEqual([{ id: "local-zsh", label: "zsh (Hub-Host)", local: true, shell: "/usr/bin/zsh" }]);
  });

  it("konfigurierte Shell (Pfad oder Name) und belegte ids werden übersprungen; ssh bleibt unberührt", () => {
    const merged = mergeLocalShells(
      [
        { id: "hub", label: "Hub-Host", local: true, shell: "/usr/bin/fish" },
        { id: "local-zsh", label: "Eigenes zsh", local: true, shell: "zsh" },
        { id: "evo", label: "evox2", ssh: "evo" },
      ],
      [
        { name: "fish", path: "/usr/bin/fish" },
        { name: "zsh", path: "/usr/bin/zsh" },
        { name: "dash", path: "/bin/dash" },
      ],
    );
    expect(merged).toEqual([{ id: "local-dash", label: "dash (Hub-Host)", local: true, shell: "/bin/dash" }]);
  });

  it("leere Config: alles Erkannte kommt durch", () => {
    const merged = mergeLocalShells([], [{ name: "bash", path: "/bin/bash" }]);
    expect(merged).toEqual([{ id: "local-bash", label: "bash (Hub-Host)", local: true, shell: "/bin/bash" }]);
  });
});
