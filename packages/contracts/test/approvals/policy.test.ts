import { describe, expect, it } from "vitest";
import { POLICY, POLICY_OPERATIONS, actorKind, policyFor } from "../../src/approvals/policy.ts";
import { displayTokenAllows } from "../../src/approvals/display.ts";

describe("policy table (T7.4)", () => {
  it("reads the actor from the token label", () => {
    expect(actorKind("pixel-9")).toBe("human");
    expect(actorKind("agent:mcp")).toBe("agent");
    expect(actorKind("bridge:abc")).toBe("bridge");
    expect(actorKind("fleet:workstation")).toBe("fleet");
    expect(actorKind("companion:workstation")).toBe("companion");
    expect(actorKind("display:nyx")).toBe("display");
    expect(actorKind(null)).toBe("human");
  });

  it("invariant: an agent never writes directly — at most it requests", () => {
    const READ_OP: Record<string, true> = { read: true, "team.read": true, "knowledge.read": true, "scan.read": true };
    for (const op of POLICY_OPERATIONS) {
      // Lese-Operationen mit demselben Allow-Set wie das generische `read`
      // der Fläche (ADR-0077 Teams, ADR-0096 Nachtrag Knowledge) — kein Schreiben.
      if (READ_OP[op]) continue;
      expect(POLICY[op].agent, op).not.toBe("allow");
    }
  });

  it("EPIC-P74 (ADR-0096 Nachtrag): Agenten lesen Wissen, schreiben nur mit Freigabe", () => {
    expect(policyFor("knowledge.read", "agent:mcp")).toBe("allow");
    expect(policyFor("knowledge.read", "bridge:s1")).toBe("deny");
    expect(policyFor("knowledge.add", "agent:mcp")).toBe("approve");
    expect(policyFor("knowledge.add", "pixel-9")).toBe("allow");
    expect(policyFor("knowledge.add", "display:nyx")).toBe("deny");
  });

  it("invariant: only humans (and a home hub acting for one) decide approvals; the bridge does nothing but ask", () => {
    expect(policyFor("approvals.decide", "agent:mcp")).toBe("deny");
    expect(policyFor("approvals.decide", "bridge:s1")).toBe("deny");
    expect(policyFor("approvals.decide", "pixel-9")).toBe("allow");
    for (const op of POLICY_OPERATIONS) expect(POLICY[op].bridge, op).toBe(op === "tools.ask" ? "allow" : "deny");
    expect(policyFor("tools.ask", "pixel-9"), "a human never answers in the provider's place").toBe("deny");
  });

  it("P27: resume is an explicit human decision, never an agent self-resume", () => {
    expect(policyFor("sessions.resume", "pixel-9")).toBe("allow");
    expect(policyFor("sessions.resume", "fleet:home")).toBe("allow");
    for (const label of ["agent:mcp", "bridge:s1", "display:nyx", "companion:pc"]) {
      expect(policyFor("sessions.resume", label)).toBe("deny");
    }
  });

  it("the emergency stop stays immediate for a human", () => {
    expect(policyFor("sessions.stop", "pixel-9")).toBe("allow");
    expect(policyFor("sessions.stop", "agent:mcp")).toBe("approve");
  });

  it("EPIC-P29 T29.6: Workspace-Retry ist menschlich (ADR-0051 §3) — Preview sehen Mensch und Fleet-Handy", () => {
    expect(policyFor("workspace.retry", "pixel-9")).toBe("allow");
    for (const label of ["agent:mcp", "bridge:s1", "display:nyx", "companion:pc", "fleet:home"]) {
      expect(policyFor("workspace.retry", label)).toBe("deny");
    }
    expect(policyFor("workspace.preview", "pixel-9")).toBe("allow");
    expect(policyFor("workspace.preview", "fleet:home")).toBe("allow");
    for (const label of ["agent:mcp", "bridge:s1", "display:nyx", "companion:pc"]) {
      expect(policyFor("workspace.preview", label)).toBe("deny");
    }
  });

  it("EPIC-P11: the companion does its one job and nothing else; only a person makes it type", () => {
    for (const op of POLICY_OPERATIONS) expect(POLICY[op].companion, op).toBe(op === "desktop.companion" ? "allow" : "deny");
    expect(policyFor("desktop.act", "pixel-9")).toBe("allow");
    expect(policyFor("desktop.act", "agent:mcp")).toBe("deny");
    expect(policyFor("desktop.act", "fleet:workstation")).toBe("deny");
  });

  it("ADR-0048/0069: a display reads, decides write approvals, and may write drafts — nothing else", () => {
    const allow = new Set(["read", "team.read", "knowledge.read", "scan.read", "approvals.decide", "drafts.write"]);
    for (const op of POLICY_OPERATIONS) expect(POLICY[op].display, op).toBe(allow.has(op) ? "allow" : "deny");
    expect(policyFor("approvals.decide", "display:nyx")).toBe("allow");
    expect(policyFor("drafts.write", "display:nyx")).toBe("allow");
    expect(policyFor("sessions.stop", "display:nyx")).toBe("deny");
    expect(policyFor("tokens.manage", "display:nyx")).toBe("deny");
  });

  it("ADR-0048/0069: the display token reaches read routes, write-decide, and session draft", () => {
    for (const [m, p] of [["GET", "/api/sessions"], ["GET", "/api/sessions/s1"], ["GET", "/api/approvals"], ["GET", "/api/approvals/a1"], ["GET", "/api/notifications"], ["POST", "/api/approvals/a1/decide"], ["GET", "/api/sessions/s1/draft"], ["PUT", "/api/sessions/s1/draft"]] as const) {
      expect(displayTokenAllows(m, p), `${m} ${p}`).toBe(true);
    }
    for (const [m, p] of [["POST", "/api/sessions"], ["POST", "/api/sessions/s1/stop"], ["POST", "/api/approvals/a1/webauthn/decide"], ["GET", "/api/tokens"], ["GET", "/api/sessions/s1/events"], ["DELETE", "/api/approvals/a1"], ["POST", "/api/sessions/s1/steer"]] as const) {
      expect(displayTokenAllows(m, p), `${m} ${p}`).toBe(false);
    }
  });
});

describe("policy table — prompt cost loop (BUG-0110)", () => {
  it("enhance/recommendation/feedback is no read for agents: it costs money and writes learning data", () => {
    expect(policyFor("prompt.enhance", "agent:mcp")).toBe("deny");
    expect(policyFor("prompt.enhance", "pixel-9")).toBe("allow");
    expect(policyFor("prompt.enhance", "fleet:home")).toBe("allow");
  });
});

describe("policy table — Projektanlage über die Flotte (BUG-0188)", () => {
  it("projects.create gehört dem Menschen und seinem Fleet-Handy — niemand sonst", () => {
    expect(policyFor("projects.create", "pixel-9")).toBe("allow");
    expect(policyFor("projects.create", "fleet:home")).toBe("allow");
    for (const label of ["agent:mcp", "bridge:s1", "display:nyx", "companion:pc"]) {
      expect(policyFor("projects.create", label)).toBe("deny");
    }
  });
});
