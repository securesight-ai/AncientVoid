import "reflect-metadata";
import { createHash, createPrivateKey, createPublicKey, randomUUID, type KeyObject } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { X509CertificateGenerator } from "@peculiar/x509";
import { type TeamIdentity } from "@ancientvoid/contracts";

/**
 * EPIC-P83 T83.2 (ADR-0118 §5): Instanzidentität für Team-Links —
 * ECDSA-P-256-Schlüssel, instanceId = SHA-256 über den SPKI (base64url),
 * selbstsigniertes Zertifikat (CN = instanceId, 180 Tage) via @peculiar/x509.
 * Ablage `data/teams/identity/` mit 0600/0700; falsche Rechte sind ein
 * Startfehler (fail loud). Der Schlüssel liegt im Klartext daneben —
 * Codes/Einladungen gibt es nur als Hash, nie in dieser Datei.
 */

const CERT_DAYS = 180;

export interface TeamIdentityFiles {
  identity: TeamIdentity;
  privateKey: KeyObject;
  publicKey: KeyObject;
}

/** SHA-256 über den SPKI-DER, hex (Pin-Vergleich je Verbindung, ADR-0118 §4). */
export function spkiSha256Hex(publicKey: KeyObject): string {
  return createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("hex");
}

async function generate(filesDir: string): Promise<TeamIdentityFiles> {
  // WebCrypto-Keypaar, weil @peculiar/x509 WebCrypto-Keys verlangt; für TLS
  // werden Node-KeyObjects daraus abgeleitet.
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const instanceId = createHash("sha256").update(spki).digest("base64url");
  const notBefore = new Date();
  const notAfter = new Date(notBefore.getTime() + CERT_DAYS * 86_400_000);
  const cert = await X509CertificateGenerator.createSelfSigned({
    serialNumber: randomUUID().replace(/-/g, ""),
    name: `CN=${instanceId}`,
    notBefore,
    notAfter,
    keys: pair,
    extensions: [],
  });
  const certPem = cert.toString("pem");
  const identity: TeamIdentity = { v: 1, instanceId, certPem, notAfter: notAfter.toISOString(), createdAt: notBefore.toISOString() };
  // Erst Verzeichnis, dann Dateien — Rechte sofort restriktiv setzen.
  mkdirSync(filesDir, { recursive: true, mode: 0o700 });
  chmodSync(filesDir, 0o700);
  const privateKey = createPrivateKey({ key: Buffer.from(pkcs8), format: "der", type: "pkcs8" });
  const publicKey = createPublicKey({ key: Buffer.from(spki), format: "der", type: "spki" });
  writeFileSync(join(filesDir, "key.pem"), privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  writeFileSync(join(filesDir, "cert.pem"), certPem, { mode: 0o600 });
  writeFileSync(join(filesDir, "identity.json"), JSON.stringify(identity), { mode: 0o600 });
  return { identity, privateKey, publicKey };
}
/** Lädt oder erzeugt die Instanzidentität. Falsche Dateirechte oder ein
 * abgelaufenes Zertifikat sind ein Startfehler (ADR-0118 §5; Rotation ist T83.5). */
export async function loadOrCreateTeamIdentity(dataDir: string): Promise<TeamIdentityFiles> {
  const dir = join(dataDir, "teams", "identity");
  const keyPath = join(dir, "key.pem");
  const certPath = join(dir, "cert.pem");
  const idPath = join(dir, "identity.json");
  if (!existsSync(keyPath) || !existsSync(certPath) || !existsSync(idPath)) {
    return generate(dir);
  }
  // Rechte-Prüfung: Group/Other dürfen weder Verzeichnis noch Schlüssel lesen.
  if ((statSync(dir).mode & 0o077) !== 0) throw new Error(`Team-Identität: Verzeichnis ${dir} ist zu offen (0${(statSync(dir).mode & 0o777).toString(8)}); Start verweigert (ADR-0118 §5)`);
  if ((statSync(keyPath).mode & 0o777) !== 0o600) throw new Error(`Team-Identität: Schlüssel ${keyPath} braucht 0600; Start verweigert (ADR-0118 §5)`);
  const identity = JSON.parse(readFileSync(idPath, "utf8")) as TeamIdentity;
  if (new Date(identity.notAfter).getTime() <= Date.now()) {
    throw new Error(`Team-Identität: Zertifikat abgelaufen (${identity.notAfter}); Rotation/Neukopplung nötig (ADR-0118 §10)`);
  }
  const privateKey = createPrivateKey(readFileSync(keyPath));
  const publicKey = createPublicKey(readFileSync(certPath));
  // Konsistenz: instanceId muss zum geladenen Schlüssel passen — sonst ist der
  // Bestand inkonsistent und wir starten nicht blind.
  if (spkiSha256Hex(publicKey) !== Buffer.from(identity.instanceId, "base64url").toString("hex")) {
    throw new Error("Team-Identität: instance.json passt nicht zum Schlüssel; Start verweigert");
  }
  return { identity, privateKey, publicKey };
}
