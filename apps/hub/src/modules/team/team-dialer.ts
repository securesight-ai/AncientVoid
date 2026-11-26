import { connect as tlsConnect, type TLSSocket } from "node:tls";
import WebSocket from "ws";
import {
  TEAM_PATH,
  checkTeamAddressLiteral,
  resolveTeamAddress,
  teamClientTlsOptions,
  type TeamLink,
  type TeamTlsMaterial,
} from "@ancientvoid/core";
import type { TeamPeerPin } from "@ancientvoid/contracts";
import { wsTeamLink } from "./team-listener.ts";

/**
 * EPIC-P83 T83.2 (ADR-0118 §3/§4): Der Team-Dialer — wählt einen gepinnten
 * Peer. Das Ziel wird nach der Namensauflösung geprüft und die geprüfte
 * Adresse gewählt (kein DNS-Rebinding); öffentliche und Wildcard-Ziele sind
 * Fehler. Je Verbindung entsteht ein frischer TLS-Kontext — keine
 * Wiederverwendung von Sitzungen durch den Client. Die TLS-Optionen (inkl.
 * SPKI-Pin statt Namensprüfung) gehen über createConnection direkt in
 * tls.connect — kein Agent-Cache, keine Agent-Optionen-Semantik.
 */
export interface DialResult {
  link: TeamLink;
  address: string;
}

export async function dialTeamPeer(
  material: TeamTlsMaterial,
  pin: TeamPeerPin,
  timeoutMs: number,
): Promise<DialResult> {
  if (!pin.address || !pin.port) throw new Error("Pin ohne Adresse/Port — erst koppeln (T83.3)");
  const port: number = pin.port;
  const resolved = await resolveTeamAddress(pin.address, port);
  if ("error" in resolved) throw new Error(resolved.message);
  // Doppelt geprüft: Literal aus der Auflösung muss erlaubt bleiben.
  if (checkTeamAddressLiteral(resolved.address) !== "allowed") {
    throw new Error(`Aufgelöstes Ziel ${resolved.address} ist nicht erlaubt`);
  }
  const tlsOptions = teamClientTlsOptions(material, pin);
  // Executor-Form: lib ist ES2023, Promise.withResolvers noch nicht typisiert.
  const opened = new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(`wss://${resolved.address}:${port}${TEAM_PATH}`, {
      handshakeTimeout: timeoutMs,
      perMessageDeflate: false,
      maxPayload: 64 * 1024,
      createConnection: (): TLSSocket => tlsConnect({
        ...tlsOptions,
        host: resolved.address,
        port,
        // Servername absichtlich leer: Identität kommt aus Pin und CA, nicht aus DNS.
        servername: undefined,
      }),
    });
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`Wählen von ${resolved.address}:${port} nach ${timeoutMs} ms abgebrochen`));
    }, timeoutMs);
    ws.once("open", () => { clearTimeout(timer); resolve(ws); });
    ws.once("error", (err: Error) => { clearTimeout(timer); reject(err); });
  });
  return { link: wsTeamLink(await opened), address: resolved.address };
}
