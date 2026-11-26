import { test, expect } from "../support/fixtures.ts";
import { TestHub } from "../support/hub.ts";

/**
 * EPIC-P83 T83.3 (AC-P83-2): zwei echte Hubs koppeln über die API —
 * Einladung (Text, nie URL) → Beitritt → gleiche Codes aus dem Exporter →
 * beidseitige Bestätigung → Pin nur danach. Fehlender Faktor (falscher Code)
 * speichert nichts. PWA-V6/Passkey folgt; hubctl team deckt denselben Pfad ab.
 */
test.describe("Team-Kopplung (EPIC-P83 T83.3)", () => {
  test("AC-P83-2: zwei Hubs koppeln Ende-zu-Ende; Pin erst nach beiden Codes", async () => {
    const a = await TestHub.start({ hostId: "team-a", label: "Nordlicht", teamListen: true });
    const b = await TestHub.start({ hostId: "team-b", label: "Bens Hub", teamListen: true });
    try {
      const opened = await a.api<{ teamId: string; inviteText: string }>("/api/teams", {
        body: { label: "Nordlicht" },
      });
      expect(opened.status).toBe(201);
      expect(opened.body.inviteText.startsWith("avteam1.")).toBe(true);
      expect(opened.body.inviteText).not.toContain("://");

      expect((await a.api<{ pins: unknown[] }>("/api/teams/pins")).body.pins).toHaveLength(0);

      const joined = await b.api<{ state: string; codeA: string }>("/api/teams/join", {
        body: { inviteText: opened.body.inviteText, label: "Bens Hub" },
      });
      expect(joined.status).toBe(200);
      expect(joined.body.state).toBe("joined");
      expect(joined.body.codeA).toMatch(/^\d{8}$/);

      // A wartet auf Beitritt (Status polled — Signal ist hub-intern).
      await a.until(async () => {
        const s = await a.api<{ state: string; codeA: string | null }>("/api/teams/pairing");
        return s.body.state === "joined" && !!s.body.codeA;
      }, "A sieht Beitritt");

      const statusA = (await a.api<{ codeA: string }>("/api/teams/pairing")).body;
      const statusB = (await b.api<{ codeA: string }>("/api/teams/pairing")).body;
      expect(statusA.codeA).not.toBe(statusB.codeA);

      // Falscher Code auf A: kein Pin.
      const wrong = await a.api("/api/teams/pairings/current/confirm", { body: { code: "00000000" } });
      expect(wrong.status).toBe(422);
      expect((await a.api<{ pins: unknown[] }>("/api/teams/pins")).body.pins).toHaveLength(0);

      // A tippt den Code, den B vorliest (statusB.codeA = Vorlese-Code B).
      const typedA = await a.api("/api/teams/pairings/current/confirm", { body: { code: statusB.codeA } });
      expect(typedA.status).toBe(200);

      // B tippt Code A → Confirm-Frame → A pinnt automatisch.
      const typedB = await b.api("/api/teams/join/confirm", { body: { code: statusA.codeA } });
      expect(typedB.status).toBe(200);

      await a.until(async () => (await a.api<{ pins: unknown[] }>("/api/teams/pins")).body.pins.length === 1, "Pin gespeichert");
      const pins = (await a.api<{ pins: { instanceId: string }[] }>("/api/teams/pins")).body.pins;
      expect(pins).toHaveLength(1);
    } finally {
      await b.stop();
      await a.stop();
    }
  });

  test("AC-P83-2 Negativ: ohne team.listen bleibt die Kopplung aus", async ({ hub }) => {
    const res = await hub.api("/api/teams", { body: { label: "Nein" } });
    expect(res.status).toBe(503);
  });
});
