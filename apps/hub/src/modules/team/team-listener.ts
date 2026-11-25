import Fastify from "fastify";
import type { Server as HttpsServer } from "node:https";
import type { TLSSocket } from "node:tls";
import fastifyWebsocket from "@fastify/websocket";
import type { WebSocket } from "ws";
import {
  TEAM_PATH,
  TEAM_ALPN,
  peerSpkiSha256,
  teamServerTlsOptions,
  type TeamLink,
  type TeamTlsMaterial,
} from "@ancientvoid/core";
import type { TeamPeerPin } from "@ancientvoid/contracts";

/**
 * EPIC-P83 T83.2 (ADR-0118 §2/§4): Der Team-Listener — ein eigener
 * TLS-1.3-Server (beidseitig), getrennt von der Fastify-App; Peers erhalten
 * kein Device-Token und erreichen keine `/api`-Route. Genau ein
 * WebSocket-Pfad `/team/v1`; ALPN `av-team/1`; `permessage-deflate` aus;
 * maxPayload 64 KiB; SPKI-Pin je Verbindung vor der ersten Nachricht.
 * Ohne `team.listen` wird dieser Server nie gestartet (main prüft).
 */
export interface TeamListener {
  /** TLS-Server für Ereignistests (secureConnection/resume). */
  readonly tls: HttpsServer;
  readonly port: number;
  /** Resume-Ereignisse der TLS-Schicht — sichtbar, keine Session-Wiederverwendung (ADR-0118 §4). */
  readonly resumeCount: number;
  close(): Promise<void>;
}


export interface TeamListenerOptions {
  address: string;
  port: number;
  material: TeamTlsMaterial;
  /** Gepinnte Peers — Änderungen (Kopplung/Widerruf) bauen den Server neu. */
  pins: readonly TeamPeerPin[];
  /** Je verbundenem Peer ein Link (Nachrichtenvektorisierung kommt mit T83.4). */
  onLink: (link: TeamLink, peer: { instanceId: string }) => void;
  log?: (line: string) => void;
}

export async function startTeamListener(opts: TeamListenerOptions): Promise<TeamListener> {
  const pinnedSpki = new Map(opts.pins.map((p) => [p.spkiSha256, p.instanceId] as const));
  let resumeCount = 0;

  const app = Fastify<HttpsServer>({
    https: teamServerTlsOptions(opts.material, opts.pins),
    logger: false,
  });
  await app.register(fastifyWebsocket, { options: { maxPayload: 64 * 1024, perMessageDeflate: false } });

  // ADR-0118 §4: SPKI-Vergleich je Verbindung VOR der ersten Nachricht und
  // ALPN-Filter — in der TLS-Schicht, nicht erst im WebSocket-Handler.
  // Die geprüfte Instanz-ID wird am TLSSocket notiert; der WebSocket-Handler
  // liest sie vom Unterbau (ws: _socket).
  const tls = app.server;
  tls.on("secureConnection", (socket: TLSSocket) => {
    if ((socket.alpnProtocol ?? "") !== TEAM_ALPN) {
      opts.log?.(`team link: ALPN ${socket.alpnProtocol || "(leer)"} abgewiesen`);
      socket.destroy();
      return;
    }
    const cert = socket.getPeerCertificate();
    const spki = peerSpkiSha256(cert);
    const instanceId = spki === null ? undefined : pinnedSpki.get(spki);
    if (instanceId === undefined) {
      opts.log?.(`team link: ungepinnter Client-Schlüssel ${spki?.slice(0, 16) ?? "unlesbar"}… abgewiesen`);
      socket.destroy();
      return;
    }
    (socket as TLSSocket & { teamInstanceId?: string }).teamInstanceId = instanceId;
  });
  tls.on("resume", () => { resumeCount++; });

  app.get(TEAM_PATH, { websocket: true }, (socket: WebSocket) => {
    const tlsSocket = (socket as unknown as { _socket?: TLSSocket & { teamInstanceId?: string } })._socket;
    const instanceId = tlsSocket?.teamInstanceId;
    if (!instanceId) {
      socket.close(1008, "unpinned");
      return;
    }
    opts.onLink(wsTeamLink(socket), { instanceId });
  });

  await app.listen({ host: opts.address, port: opts.port });
  const bound = (app.server.address() as { port: number }).port;
  return {
    tls,
    port: bound,
    get resumeCount(): number {
      return resumeCount;
    },
    async close(): Promise<void> {
      await app.close();
    },
  };
}

/** Ein Team-Link über einen WebSocket (Dialer-Seite oder Testpaar). */
export function wsTeamLink(socket: WebSocket): TeamLink {
  let handler: ((bytes: Uint8Array) => void) | null = null;
  let closed = false;
  socket.on("message", (data: Buffer) => {
    if (handler) handler(new Uint8Array(data));
  });
  return {
    async send(bytes: Uint8Array): Promise<void> {
      if (closed) throw new Error("Link geschlossen");
      // Executor-Form: lib ist ES2023, Promise.withResolvers noch nicht typisiert.
      await new Promise<void>((resolve, reject) => socket.send(bytes, (err) => (err ? reject(err) : resolve())));
    },
    onMessage(h: (bytes: Uint8Array) => void): void {
      handler = h;
    },
    async close(): Promise<void> {
      closed = true;
      socket.close(1000);
    },
  };
}
