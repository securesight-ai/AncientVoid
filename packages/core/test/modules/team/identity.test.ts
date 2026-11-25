import { describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { X509Certificate, createHash } from "node:crypto";
import { loadOrCreateTeamIdentity, spkiSha256Hex } from "../../../src/modules/team/identity.ts";
/** EPIC-P83 T83.2 (ADR-0118 §5): Instanzidentität — Schlüssel, Zertifikat, Ablage, Rechte. */

describe("EPIC-P83 T83.2 — Instanzidentität (ADR-0118 §5)", () => {
  it("erzeugt ECDSA-P-256-Schlüssel, instanceId = SHA-256(SPKI) base64url, selbstsigniertes Zertifikat mit CN=instanceId, 180 Tage", async () => {
    const dir = mkdtempSync(join(tmpdir(), "av-t83-id-"));
    const files = await loadOrCreateTeamIdentity(dir);
    expect(files.identity.instanceId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // instanceId ist der SPKI-Hash des eigenen Schlüssels.
    expect(createHash("sha256").update(files.publicKey.export({ type: "spki", format: "der" })).digest("base64url")).toBe(files.identity.instanceId);
    const cert = new X509Certificate(files.identity.certPem);
    expect(cert.subject).toContain(files.identity.instanceId);
    expect(cert.publicKey.asymmetricKeyType).toBe("ec");
    expect(cert.validTo).toBeTruthy();
    // 180 Tage ± 1 Tag Toleranz.
    const days = (Date.parse(cert.validTo) - Date.parse(cert.validFrom)) / 86_400_000;
    expect(Math.abs(days - 180)).toBeLessThan(1);
    expect(cert.checkPrivateKey(files.privateKey)).toBe(true);
  });

  it("lädt die Identität erneut: gleiche instanceId, gleiches Zertifikat, gleicher Schlüssel", async () => {
    const dir = mkdtempSync(join(tmpdir(), "av-t83-reload-"));
    const first = await loadOrCreateTeamIdentity(dir);
    const second = await loadOrCreateTeamIdentity(dir);
    expect(second.identity.instanceId).toBe(first.identity.instanceId);
    expect(second.identity.certPem).toBe(first.identity.certPem);
    expect(spkiSha256Hex(second.publicKey)).toBe(spkiSha256Hex(first.publicKey));
  });

  it("Ablage unter data/teams/identity mit 0600/0700", async () => {
    const dir = mkdtempSync(join(tmpdir(), "av-t83-perm-"));
    await loadOrCreateTeamIdentity(dir);
    const idDir = join(dir, "teams", "identity");
    expect(statSync(join(idDir, "cert.pem")).mode & 0o777).toBe(0o600);
    expect(statSync(idDir).mode & 0o777).toBe(0o700);
  });

  it("zu offene Schlüsselrechte sind ein Startfehler (fail loud)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "av-t83-open-"));
    await loadOrCreateTeamIdentity(dir);
    chmodSync(join(dir, "teams", "identity", "key.pem"), 0o644);
    await expect(loadOrCreateTeamIdentity(dir)).rejects.toThrow(/0600|zu offen/);
  });

  it("abgelaufenes Zertifikat verweigert den Start (Rotation ist T83.5)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "av-t83-exp-"));
    const files = await loadOrCreateTeamIdentity(dir);
    const identity = JSON.parse(readFileSync(join(dir, "teams", "identity", "identity.json"), "utf8")) as Record<string, unknown>;
    identity.notAfter = "2020-01-01T00:00:00.000Z";
    writeFileSync(join(dir, "teams", "identity", "identity.json"), JSON.stringify(identity));
    expect(files.identity.instanceId).toBeTruthy();
    await expect(loadOrCreateTeamIdentity(dir)).rejects.toThrow(/abgelaufen/);
  });

  it("identity.json, das nicht zum Schlüssel passt, verweigert den Start", async () => {
    const dir = mkdtempSync(join(tmpdir(), "av-t83-mismatch-"));
    await loadOrCreateTeamIdentity(dir);
    const other = mkdtempSync(join(tmpdir(), "av-t83-mismatch-b-"));
    const otherFiles = await loadOrCreateTeamIdentity(other);
    const identityPath = join(dir, "teams", "identity", "identity.json");
    writeFileSync(identityPath, JSON.stringify({ ...JSON.parse(readFileSync(identityPath, "utf8") as string), instanceId: otherFiles.identity.instanceId }));
    await expect(loadOrCreateTeamIdentity(dir)).rejects.toThrow(/passt nicht zum Schlüssel/);
  });
});
