import type { DocSearchHit, HubSearchStatus, SessionTextHit } from "@ancientvoid/contracts";
import { peerGetJson } from "../fleet/fleet-proxy.ts";

/**
 * Cross-Hub-Suche (2026-11-23): ein Begriff, der auf einem anderen Rechner des
 * Fleet gewachsen ist, ist auf diesem Hub nicht im Index — die Sitzung liegt in
 * dessen `dataDir`. Dieses Modul fragt die gekoppelten Hub-Rechner und fasst die
 * Antwort ehrlich zusammen: ein nicht erreichbarer Rechner ist ein Ergebnis,
 * keine stille Lücke.
 *
 * Über die Fleet-Tür (`isFleetRoutable` lässt `/api/search` zu) läuft dafür das
 * bereits gespeicherte Peer-Token; neue Rechte entstehen nicht.
 */

/** Die Suche braucht antwortende Rechner, aber kein Warten auf tote: acht Sekunden
 * pro Peer, parallel, danach ist die Runde fertig. */
const PEER_SEARCH_TIMEOUT_MS = 8_000;

export interface PeerLike {
  hostId: string;
  url: string;
  token: string;
}

export interface FanOutOptions {
  q: string;
  scope: "all" | "docs" | "sessions";
  limit: number;
  roles?: string;
  /** Der Kreuz „nur dieses Projekt“ ist eine Aussage über **diesen** Rechner —
   * auf einem fremden Hub dieselbe Pfadschnur zu verlangen wäre falsch. */
  projectScoped: boolean;
}

export interface FanOutResult {
  hubs: HubSearchStatus[];
  sessions: SessionTextHit[];
  docs: DocSearchHit[];
}

/** Rechnername aus der Peer-URL (`kaisgamingdesk.tail…ts.net`), weil die Zahl
 * `hostId` niemandem etwas sagt. */
export function peerLabel(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export async function searchPeers(peers: readonly PeerLike[], opts: FanOutOptions): Promise<FanOutResult> {
  if (!peers.length) return { hubs: [], sessions: [], docs: [] };
  if (opts.projectScoped) {
    return {
      hubs: peers.map((peer) => ({
        hostId: peer.hostId,
        label: peerLabel(peer.url),
        state: "skipped" as const,
        sessions: 0,
        docs: 0,
        note: "project_scope",
      })),
      sessions: [],
      docs: [],
    };
  }

  const runs = await Promise.all(
    peers.map(async (peer): Promise<{ status: HubSearchStatus; sessions: SessionTextHit[]; docs: DocSearchHit[] }> => {
      const label = peerLabel(peer.url);
      const query = new URLSearchParams({ q: opts.q, scope: opts.scope, limit: String(opts.limit), allProjects: "1" });
      if (opts.roles) query.set("roles", opts.roles);
      let res: Awaited<ReturnType<typeof peerGetJson>>;
      try {
        res = await peerGetJson(peer, `/api/search/all?${query.toString()}`, PEER_SEARCH_TIMEOUT_MS);
      } catch {
        return { status: { hostId: peer.hostId, label, state: "offline", sessions: 0, docs: 0 }, sessions: [], docs: [] };
      }
      const empty = (state: HubSearchStatus["state"], note?: string) => ({
        status: { hostId: peer.hostId, label, state, sessions: 0, docs: 0, ...(note ? { note } : {}) },
        sessions: [] as SessionTextHit[],
        docs: [] as DocSearchHit[],
      });
      if (res.status === 401 || res.status === 403) return empty("denied");
      if (res.status === 404) return empty("unsupported");
      if (res.status !== 200 || !res.json) return empty("error", `HTTP ${res.status}`);
      const body = res.json as { sessions?: SessionTextHit[]; docs?: DocSearchHit[]; sessionTotal?: number; docTotal?: number };
      const sessions = (body.sessions ?? []).map((hit) => ({ ...hit, hub: peer.hostId, hubUrl: peer.url }));
      const docs = (body.docs ?? []).map((hit) => ({ ...hit, hub: peer.hostId, hubUrl: peer.url }));
      return {
        status: {
          hostId: peer.hostId,
          label,
          state: "ok",
          sessions: body.sessionTotal ?? sessions.length,
          docs: body.docTotal ?? docs.length,
        },
        sessions,
        docs,
      };
    }),
  );

  return {
    // Eigene Fundstellen zuerst, dann die der Peers in deren eigener Reihenfolge:
    // Ränge zweier Hubs sind nicht vergleichbar, und eine scheinbar gemischte
    // Trefferliste würde eine gemeinsame Wertung vortäuschen.
    hubs: runs.map((run) => run.status),
    sessions: runs.flatMap((run) => run.sessions),
    docs: runs.flatMap((run) => run.docs),
  };
}
