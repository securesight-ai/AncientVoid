import { describe, expect, it } from "vitest";
import { policyFor } from "@ancientvoid/contracts";
import { operationOf } from "../../src/platform/policy.ts";

/**
 * Nutzerfund 23.11.2026: Einfügen eines Bildes unter Linux/Wayland. Die neue
 * Route liest eine Datei von der Maschine des Hubs — das ist mehr als ein
 * Upload, also eine eigene Operation, und sie gilt nur für einen Menschen an
 * diesem Hub (nicht für Flotte, Agent, Brücke, Display).
 */
describe("policy: lokale Bilddatei holen (Nutzerfund 23.11.2026)", () => {
  it("die Route hat ein Mapping, nicht den Fail-closed-Fallback", () => {
    expect(operationOf("POST", "/api/local-files/bytes", { path: "/home/kaib/Bild.png" })).toBe("files.readLocal");
  });

  it("Mensch ja, alle automatischen Kanäle nein", () => {
    expect(policyFor("files.readLocal", "pc")).toBe("allow");
    expect(policyFor("files.readLocal", "fleet:kaisgamingdesk")).toBe("deny");
    expect(policyFor("files.readLocal", "agent:pi")).toBe("deny");
    expect(policyFor("files.readLocal", "bridge:x")).toBe("deny");
    expect(policyFor("files.readLocal", "companion:x")).toBe("deny");
    expect(policyFor("files.readLocal", "display:flur")).toBe("deny");
  });
});
