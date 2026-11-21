import { describe, expect, it } from "vitest";
import { formatWorkspaceStatus } from "../src/workspace.ts";
import type { WorkspaceStatus } from "@ancientvoid/contracts";

// Ausgabe-Assertions sind deutsch festgemacht (EPIC-P61 T61.8).
process.env.AV_LANG = "de";

/** EPIC-P29 T29.6: hubctl workspace — Status-Formatierung (rein, K5-kurz). */
describe("hubctl workspace", () => {
  const base: WorkspaceStatus = {
    sessionId: "s1",
    phase: "ready",
    baseSha: "0123456789abcdef0123456789abcdef01234567",
    manifestHash: "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
    services: [
      { id: "web", state: "ready", port: 4321, pid: 4711, updatedAt: "2026-11-07T09:00:00.000Z" },
      { id: "api", state: "failed", port: null, pid: null, failure: { step: "api", kind: "port", detail: "Fixport belegt", logBlobRef: null }, updatedAt: "2026-11-07T09:01:00.000Z" },
    ],
    operationId: null,
    updatedAt: "2026-11-07T09:01:00.000Z",
  };

  it("nennt Phase, gekürzte Hashes und jede Service-Zeile mit Zustand und Port", () => {
    const lines = formatWorkspaceStatus(base);
    expect(lines[0]).toBe("phase: bereit  (Basis 01234567 · Manifest fedcba98)");
    expect(lines).toContain("service web: ready port=4321 (Stand 2026-11-07T09:00:00.000Z)");
    expect(lines.some((l) => l.includes("service api: failed") && !l.includes("port="))).toBe(true);
  });

  it("Fehler nennen Art, Schritt, Exitcode und Log-Blob (AC-P29-3)", () => {
    const failed: WorkspaceStatus = {
      ...base,
      phase: "failed",
      services: [],
      failure: { step: "install", kind: "exit", exitCode: 1, detail: "npm ERR", logBlobRef: "sha256:abc" },
    };
    const lines = formatWorkspaceStatus(failed);
    expect(lines[1]).toBe("fehler: exit (Exit 1) in „install“ — npm ERR · Log sha256:abc");
    expect(lines).toContain("services: keine");
  });
});
