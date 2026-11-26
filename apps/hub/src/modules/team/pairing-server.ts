import { createHash, X509Certificate } from "node:crypto";
import { connect as tlsConnect, createServer, type Server as TlsServer, type TLSSocket } from "node:tls";
import { TeamJoinMessage, type TeamJoinProfile, type TeamPairingError, type TeamInviteData } from "@ancientvoid/contracts";
import { acceptJoin, pairingExporterContext, type PairingWindow, type TeamTlsMaterial } from "@ancientvoid/core";

/**
 * EPIC-P83 T83.3 (ADR-0118 §7.2): Der Kopplungsserver — lauscht nur im
 * offenen Fenster auf `team.pairPort` (ALPN `av-team-pair/1`; Node prüft
 * Zertifikate je Server, nicht je ALPN — deshalb ein eigener Server). Er
 * nimmt unbekannte Zertifikate an, ausschließlich für die eine
 * Kopplungsnachricht, mit 5 s Frist; danach wird der Socket geschlossen.
 * Die Codes werden nie übertragen: beide Seiten leiten sie aus dem
 * TLS-Exporter derselben Verbindung ab (RFC 9266, ADR-0118 §7.4).
 * Nach dem Beitritt bleibt die Verbindung offen, bis B nach Code-Eingabe
 * einen Confirm-Frame sendet (ADR-0118 §7.6: Pins erst nach beiden
 * Bestätigungen) — Invite-TTL als Obergrenze.
 */
const PAIR_ALPN = "av-team-pair/1";
const PAIR_LABEL_A = "EXPERIMENTAL-ancientvoid-team-pair-a";
const PAIR_LABEL_B = "EXPERIMENTAL-ancientvoid-team-pair-b";
const PAIR_DEADLINE_MS = 5_000;
const CONFIRM_DEADLINE_MS = 10 * 60_000;
const MAX_JOIN_BYTES = 16_384;

function code8(bytes: Uint8Array): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return (view.getUint32(0) % 100_000_000).toString().padStart(8, "0");
}

/** Längenpräfix (u32 BE) + UTF-8-JSON — Join-Request und Confirm-Frame. */
function writePairingFrame(socket: TLSSocket, payload: unknown): Promise<void> {
  const body = Buffer.from(JSON.stringify(payload));
  const frame = Buffer.alloc(4 + body.length);
  frame.writeUInt32BE(body.length, 0);
  body.copy(frame, 4);
  return new Promise((resolve, reject) => {
    socket.write(frame, (err) => (err ? reject(err) : resolve()));
  });
}

/** B → A: Bestätigung nach korrekter Code-A-Eingabe (Codes selbst nie auf der Leitung). */
export function sendPairingConfirm(socket: TLSSocket): Promise<void> {
  return writePairingFrame(socket, { confirm: true });
}

/** Codes aus einem Ende der Kopplungsverbindung (Exporter, je Label). */
function derivePairingCodes(socket: TLSSocket, teamId: string, spkiA: string, spkiB: string): { codeA: string; codeB: string } {
  const context = pairingExporterContext(teamId, spkiA, spkiB);
  // Node-Typing: exportKeyingMaterial(length, label, context).
  const a = new Uint8Array(socket.exportKeyingMaterial(32, PAIR_LABEL_A, context));
  const b = new Uint8Array(socket.exportKeyingMaterial(32, PAIR_LABEL_B, context));
  return { codeA: code8(a), codeB: code8(b) };
}

export interface PairingServer {
  server: TlsServer;
  port: number;
  close(): Promise<void>;
}

/** Kopplungsserver starten: eine Nachricht, fünf Sekunden Frist, dann zu. */
export async function startPairingServer(opts: {
  port: number;
  material: TeamTlsMaterial;
  window: PairingWindow;
  ownSpkiSha256: string;
  onJoined: (outcome: { codes: { codeA: string; codeB: string }; profile: TeamJoinProfile; socket: TLSSocket }) => void;
  /** B hat lokal Code A bestätigt und den Confirm-Frame gesendet. */
  onBConfirmed?: () => void;
  log?: (line: string) => void;
}): Promise<PairingServer> {
  /** Offene Sockets — beim Close hart zerstören, sonst hängt server.close(). */
  const live = new Set<TLSSocket>();
  const server = createServer(
    {
      minVersion: "TLSv1.3",
      requestCert: true,
      // Unbekannte Zertifikate ausdrücklich erlaubt: der Beitrittende ist noch nicht gepinnt (ADR-0118 §7.2).
      rejectUnauthorized: false,
      cert: opts.material.identity.certPem,
      key: opts.material.privateKey.export({ type: "pkcs8", format: "pem" }),
      ALPNProtocols: [PAIR_ALPN],
      sessionTimeout: 0,
    },
    (socket) => {
      live.add(socket);
      socket.once("close", () => live.delete(socket));
      const deadline = setTimeout(() => {
        socket.destroy();
      }, PAIR_DEADLINE_MS);
      let buffer = Buffer.alloc(0);
      let joined = false;
      let confirmDeadline: ReturnType<typeof setTimeout> | null = null;
      socket.on("data", (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.length < 4) return;
        const len = buffer.readUInt32BE(0);
        if (len > MAX_JOIN_BYTES) {
          socket.write(Buffer.from(JSON.stringify({ ok: false, error: "bad_invite" satisfies TeamPairingError })));
          clearTimeout(deadline);
          if (confirmDeadline) clearTimeout(confirmDeadline);
          socket.end();
          return;
        }
        if (buffer.length < 4 + len) return;
        clearTimeout(deadline);
        const body = buffer.subarray(4, 4 + len).toString("utf8");
        buffer = buffer.subarray(4 + len);
        if (joined) {
          // Zweite Nachricht: B-Bestätigung (nach Code-Eingabe auf B-Seite).
          try {
            const confirm = JSON.parse(body) as { confirm?: boolean };
            if (confirm.confirm === true) opts.onBConfirmed?.();
          } catch {
            opts.log?.("pairing confirm frame unlesbar");
          }
          if (confirmDeadline) clearTimeout(confirmDeadline);
          socket.end();
          return;
        }
        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(body);
        } catch {
          socket.write(Buffer.from(JSON.stringify({ ok: false, error: "bad_invite" satisfies TeamPairingError })));
          socket.end();
          return;
        }
        const parsed = TeamJoinMessage.safeParse(parsedJson);
        if (!parsed.success) {
          socket.write(Buffer.from(JSON.stringify({ ok: false, error: "bad_invite" satisfies TeamPairingError })));
          socket.end();
          return;
        }
        const error = acceptJoin(opts.window, parsed.data, new Date());
        if (error !== null) {
          socket.write(Buffer.from(JSON.stringify({ ok: false, error })));
          socket.end();
          return;
        }
        // Codes aus dieser Verbindung ableiten — Kontext: teamId + beide SPKI-Hashes.
        const codes = derivePairingCodes(socket, opts.window.teamId, opts.ownSpkiSha256, parsed.data.profile.spkiSha256);
        socket.write(Buffer.from(JSON.stringify({ ok: true })));
        joined = true;
        // Menschliche Code-Zeremonie: Verbindung bleibt bis Confirm oder Invite-TTL.
        confirmDeadline = setTimeout(() => {
          socket.destroy();
        }, CONFIRM_DEADLINE_MS);
        opts.onJoined({ codes, profile: parsed.data.profile, socket });
      });
    },
  );
  await new Promise<void>((resolve) => server.listen(opts.port, "127.0.0.1", resolve));
  const bound = (server.address() as { port: number }).port;
  return {
    server,
    port: bound,
    // Sonst wartet server.close() ewig auf eine offene Pairing-TLS-Verbindung
    // (z. B. Negativpfad ohne Confirm-Frame).
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of live) s.destroy();
        live.clear();
        server.close(() => resolve());
      }),
  };
}

export type JoinResult =
  | { ok: true; codes: { codeA: string; codeB: string }; socket: TLSSocket }
  | { ok: false; error: TeamPairingError };

/** B-Seite: Kopplung wählen — Pin aus der Einladung prüfen, Beitritt senden,
 *  Antwort lesen, Codes aus dem eigenen Ende der Verbindung ableiten. */
export async function joinOverPairing(opts: {
  invite: TeamInviteData;
  material: TeamTlsMaterial;
  label: string;
  ownSpkiSha256: string;
  ownInstanceId: string;
  timeoutMs?: number;
}): Promise<JoinResult> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  // Executor-Form: lib ist ES2023, Promise.withResolvers noch nicht typisiert.
  const connected = await new Promise<TLSSocket | null>((resolve) => {
    const socket = tlsConnect({
      host: opts.invite.address,
      port: opts.invite.port,
      minVersion: "TLSv1.3",
      cert: opts.material.identity.certPem,
      key: opts.material.privateKey.export({ type: "pkcs8", format: "pem" }),
      ca: [opts.invite.certPem],
      rejectUnauthorized: true,
      // Pin aus der Einladung: SPKI-Hash statt Namensprüfung (Zertifikat ohne SAN).
      checkServerIdentity: (hostname: string, cert): Error | undefined => {
        void hostname;
        const spki = createHash("sha256").update(new X509Certificate(cert.raw).publicKey.export({ type: "spki", format: "der" })).digest("hex");
        return spki === opts.invite.spkiSha256 ? undefined : new Error("Pin aus der Einladung stimmt nicht mit dem Server-Schlüssel überein");
      },
      ALPNProtocols: [PAIR_ALPN],
    });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(null);
    }, timeoutMs);
    socket.once("secureConnect", () => { clearTimeout(timer); resolve(socket); });
    socket.once("error", () => { clearTimeout(timer); resolve(null); });
  });
  if (connected === null) return { ok: false, error: "rate_limited" };
  const message = {
    v: 1,
    teamId: opts.invite.teamId,
    secret: opts.invite.secret,
    profile: {
      v: 1,
      instanceId: opts.ownInstanceId,
      spkiSha256: opts.ownSpkiSha256,
      certPem: opts.material.identity.certPem,
      label: opts.label,
      protocolVersion: 1,
    },
  } satisfies TeamJoinMessage;
  const body = Buffer.from(JSON.stringify(message));
  const frame = Buffer.alloc(4 + body.length);
  frame.writeUInt32BE(body.length, 0);
  body.copy(frame, 4);
  connected.write(frame);
  // Executor-Form: siehe oben. Antwort ist ungerahmt (Kurz-JSON); Listener danach ab.
  const answer = await new Promise<{ ok: boolean; error?: TeamPairingError } | null>((resolve) => {
    const timer = setTimeout(() => {
      connected.destroy();
      resolve(null);
    }, timeoutMs);
    let buffer = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      try {
        const parsed = JSON.parse(buffer.toString("utf8")) as { ok: boolean; error?: TeamPairingError };
        clearTimeout(timer);
        connected.off("data", onData);
        connected.off("close", onClose);
        resolve(parsed);
      } catch {
        // noch unvollständig — weiter sammeln
      }
    };
    const onClose = () => { clearTimeout(timer); resolve(null); };
    connected.on("data", onData);
    connected.once("close", onClose);
  });
  if (answer === null) return { ok: false, error: "rate_limited" };
  if (!answer.ok) {
    connected.destroy();
    return { ok: false, error: answer.error ?? "bad_invite" };
  }
  const codes = derivePairingCodes(connected, opts.invite.teamId, opts.invite.spkiSha256, opts.ownSpkiSha256);
  return { ok: true, codes, socket: connected };
}
