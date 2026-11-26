import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadOrCreateTeamIdentity, type TeamTlsMaterial } from "@ancientvoid/core";
import { TeamPairingService } from "../../../src/modules/team/team-pairing-service.ts";

/**
 * EPIC-P83 T83.3 (ADR-0118 §7, AC-P83-2): Kopplungszweck über den echten
 * Dienst — zwei Instanzen auf Loopback: Einladung (Text, 10 Min, einmalig,
 * nur Hash gespeichert) → Beitritt → gleiche Codes aus dem Exporter →
 * Code-Eingabe beidseitig → Pin erst danach. Fehlende Faktoren (falscher
 * Code) scheitern ohne gespeicherten Pin. Signale statt Pollen: der Dienst
 * resolved den Beitritt.
 */

function material(dir: string): Promise<TeamTlsMaterial> {
  return loadOrCreateTeamIdentity(dir).then((f) => ({ identity: f.identity, privateKey: f.privateKey, publicKey: f.publicKey }));
}

describe("EPIC-P83 T83.3 — Kopplungsdienst (AC-P83-2)", () => {
  let root: string;
  let a: TeamTlsMaterial;
  let b: TeamTlsMaterial;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "av-t83-svc-"));
    a = await material(join(root, "a"));
    b = await material(join(root, "b"));
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("vollständige Kopplung: Einladung → Beitritt → Codes → beide Bestätigungen → Pin gespeichert", async () => {
    const serviceA = new TeamPairingService({ dataDir: join(root, "a"), material: a, pairPort: 0 });
    const serviceB = new TeamPairingService({ dataDir: join(root, "b"), material: b, pairPort: 0 });
    // 1. A legt die Einladung an (Text; das Fenster öffnet den Kopplungsserver).
    const { inviteText, joined } = await serviceA.openInvitation("Nordlicht");
    expect(inviteText.startsWith("avteam1.")).toBe(true);
    // Vor dem Beitritt: kein Pin.
    expect(serviceA.pins()).toHaveLength(0);
    // 2. B tritt bei (liefert B-seitige Codes; A bekommt das Signal).
    const joinResult = await serviceB.joinFromInvite(inviteText, "Bens Hub");
    expect(joinResult.ok, JSON.stringify(joinResult)).toBe(true);
    await joined;
    const statusA = serviceA.status();
    expect(statusA.state).toBe("joined");
    expect(statusA.peerLabel).toBe("Bens Hub");
    // A liest Code A vor (A-Seite), B liest Code B vor (B-Seite) — beide achtstellig.
    expect(statusA.codeA).toMatch(/^\d{8}$/);
    const statusB = serviceB.status();
    expect(statusB.codeA).toMatch(/^\d{8}$/);
    expect(statusB.codeA).not.toBe(statusA.codeA); // unterschiedliche Vorlese-Codes
    // 3. Falscher Code (A tippt) scheitert, ohne die Kopplung zu killen.
    const wrong = serviceA.typeCodeB("00000000");
    expect(wrong.ok).toBe(false);
    // 4. A tippt den Code, den B vorliest (statusB.codeA ist B-seitig der Vorlese-Code B).
    const typedOk = serviceA.typeCodeB(statusB.codeA!);
    expect(typedOk.ok, JSON.stringify(typedOk)).toBe(true);
    // 5. B tippt den vorgelesenen Code A und sendet den Confirm-Frame.
    expect((await serviceB.typeCodeA(statusA.codeA!)).ok).toBe(true);
    // 6. Erst nach beiden Seiten (A lokal + B-Frame) wird gepinnt.
    expect((await serviceA.complete()).ok).toBe(true);
    expect(serviceA.pins()).toHaveLength(1);
    expect(serviceA.pins()[0]!.instanceId).toBe(b.identity.instanceId);
    expect(existsSync(join(root, "a", "teams", "pins.json"))).toBe(true);
    const stored = JSON.parse(readFileSync(join(root, "a", "teams", "pins.json"), "utf8")) as { teams: { members: unknown[] }[] };
    expect(stored.teams[0]!.members).toHaveLength(1);
    await serviceB.close();
    await serviceA.close();
  });

  it("fehlender Faktor: dreimal falscher Code B schließt die Eingabe ab — kein Pin", async () => {
    const serviceA = new TeamPairingService({ dataDir: join(root, "a2"), material: a, pairPort: 0 });
    const serviceB = new TeamPairingService({ dataDir: join(root, "b2"), material: b, pairPort: 0 });
    const { inviteText, joined } = await serviceA.openInvitation("Test");
    expect((await serviceB.joinFromInvite(inviteText, "B")).ok).toBe(true);
    await joined;
    // Dreimal falsch tippen → exhausted; complete scheitert; kein Pin.
    for (let i = 0; i < 3; i++) expect(serviceA.typeCodeB("00000000").ok).toBe(false);
    const statusB = serviceB.status();
    expect(serviceA.typeCodeB(statusB.codeA!).ok).toBe(false);
    expect((await serviceA.complete(50)).ok).toBe(false);
    expect(serviceA.pins()).toHaveLength(0);
    await serviceB.close();
    await serviceA.close();
  });
});
