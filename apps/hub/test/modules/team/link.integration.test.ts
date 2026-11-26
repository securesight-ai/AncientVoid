import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:https";
import { connect as tlsConnect, type TLSSocket } from "node:tls";
import { type TeamLink } from "@ancientvoid/core";
import type { TeamPeerPin } from "@ancientvoid/contracts";
import { startTeamListener, type TeamListener } from "../../../src/modules/team/team-listener.ts";
import { dialTeamPeer } from "../../../src/modules/team/team-dialer.ts";

/**
 * EPIC-P83 T83.2 (ADR-0118 §2/§4): Der Team-Link gegen einen echten
 * TLS-1.3-Listener — beidseitig, gepinnt, ALPN-gefiltert, ohne `/api`,
 * ohne Session-Wiederverwendung. Läuft auf Loopback mit echten Sockets.
 */
import { loadOrCreateTeamIdentity, spkiSha256Hex, type TeamTlsMaterial } from "@ancientvoid/core";

function material(dir: string): Promise<TeamTlsMaterial> {
  return loadOrCreateTeamIdentity(dir).then((f) => ({ identity: f.identity, privateKey: f.privateKey, publicKey: f.publicKey }));
}

function pinOf(m: TeamTlsMaterial, address: string, port: number): TeamPeerPin {
  return {
    instanceId: m.identity.instanceId,
    spkiSha256: spkiSha256Hex(m.publicKey),
    certPem: m.identity.certPem,
    address,
    port,
    state: "disconnected",
    pinnedAt: new Date().toISOString(),
  };
}

/** Executor-Form: lib ist ES2023, Promise.withResolvers noch nicht typisiert. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function tlsFailFast(opts: Record<string, unknown>): Promise<Error> {
  const { promise, resolve, reject } = deferred<Error>();
  const socket = tlsConnect({ ...opts, host: "127.0.0.1", port: listener.port }) as TLSSocket;
  socket.once("secureConnect", () => reject(new Error("Verbindung wurde akzeptiert")));
  socket.once("error", (err: Error) => resolve(err));
  return promise;
}

let listener: TeamListener;

describe("EPIC-P83 T83.2 — Team-Listener/Dialer (ADR-0118 §2/§4)", () => {
  let root: string;
  let server: TeamTlsMaterial;
  let client: TeamTlsMaterial;
  let stranger: TeamTlsMaterial;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "av-t83-link-"));
    server = await material(join(root, "a"));
    client = await material(join(root, "b"));
    stranger = await material(join(root, "c"));
    listener = await startTeamListener({
      address: "127.0.0.1",
      port: 0,
      material: server,
      pins: [pinOf(client, "127.0.0.1", 0)],
      onLink: () => undefined,
    });
  });

  afterAll(async () => {
    await listener.close().catch(() => undefined);
    rmSync(root, { recursive: true, force: true });
  });

  it("TLS 1.2 wird abgewiesen (minVersion 1.3, ADR-0118 §4)", async () => {
    const err = await tlsFailFast({
      minVersion: "TLSv1.2",
      maxVersion: "TLSv1.2",
      cert: client.identity.certPem,
      key: client.privateKey.export({ type: "pkcs8", format: "pem" }),
      ca: [server.identity.certPem],
      ALPNProtocols: ["av-team/1"],
      rejectUnauthorized: true,
    });
    expect(String(err)).toBeTruthy();
  });

  it("fremder Schlüssel (nicht gepinnt) wird abgewiesen", async () => {
    // Stranger wählt den Server: Server-CA enthält nur das Client-Zertifikat,
    // also scheitert der Handshake am ungepinnten Client-Schlüssel.
    const strangerPin = pinOf(server, "127.0.0.1", listener.port);
    await expect(dialTeamPeer(stranger, strangerPin, 3000)).rejects.toThrow();
  });

  it("fehlender ALPN wird abgewiesen (nur av-team/1)", async () => {
    const err = await tlsFailFast({
      minVersion: "TLSv1.3",
      cert: client.identity.certPem,
      key: client.privateKey.export({ type: "pkcs8", format: "pem" }),
      ca: [server.identity.certPem],
      rejectUnauthorized: true,
      // absichtlich ohne ALPNProtocols
    });
    expect(String(err)).toBeTruthy();
  });

  it("gültiger Dial: Verbindung, beidseitige Nachrichten, dann sauber zu", async () => {
    const serverSide = deferred<{ instanceId: string; link: TeamLink }>();
    const serverGot = deferred<Uint8Array>();
    const secondListener = await startTeamListener({
      address: "127.0.0.1",
      port: 0,
      material: server,
      pins: [pinOf(client, "127.0.0.1", 0)],
      onLink: (link, peer) => {
        link.onMessage((bytes) => serverGot.resolve(bytes));
        serverSide.resolve({ instanceId: peer.instanceId, link });
      },
    });
    try {
      const dial = await dialTeamPeer(client, pinOf(server, "127.0.0.1", secondListener.port), 5000);
      expect(dial.address).toBe("127.0.0.1");
      const got = deferred<Uint8Array>();
      dial.link.onMessage((bytes) => got.resolve(bytes));
      const side = await serverSide.promise;
      expect(side.instanceId).toBe(client.identity.instanceId);
      // Client → Server …
      await dial.link.send(new Uint8Array([1, 2, 3]));
      expect(Array.from(await serverGot.promise)).toEqual([1, 2, 3]);
      // … und Server → Client über dieselbe Verbindung.
      await side.link.send(new Uint8Array([9, 9]));
      expect(Array.from(await got.promise)).toEqual([9, 9]);
      await dial.link.close();
    } finally {
      await secondListener.close();
    }
  });

  it("keine Session-Wiederverwendung: mehrere Wahlen, resume bleibt 0 (ADR-0118 §4)", async () => {
    const before = listener.resumeCount;
    for (let i = 0; i < 3; i++) {
      const dial = await dialTeamPeer(client, pinOf(server, "127.0.0.1", listener.port), 5000);
      await dial.link.send(new Uint8Array([i]));
      await dial.link.close();
    }
    expect(listener.resumeCount).toBe(before);
  });

  it("kein /api: der Team-Server kennt nur /team/v1 — /api antwortet 404", async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        {
          host: "127.0.0.1",
          port: listener.port,
          path: "/api/teams",
          method: "GET",
          createConnection: (): TLSSocket => tlsConnect({
            host: "127.0.0.1",
            port: listener.port,
            minVersion: "TLSv1.3",
            cert: client.identity.certPem,
            key: client.privateKey.export({ type: "pkcs8", format: "pem" }),
            ca: [server.identity.certPem],
            rejectUnauthorized: true,
            ALPNProtocols: ["av-team/1"],
            // Identität kommt aus Pin/CA — Namensprüfung aus (Zertifikat ohne SAN).
            checkServerIdentity: () => undefined,
          }),
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.once("error", reject);
      req.end();
    });
    expect(status).toBe(404);
  });
});
