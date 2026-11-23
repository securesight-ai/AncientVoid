/**
 * EPIC-P6 / ADR-0017: several hubs in one fleet. Each hub stays the only
 * source of truth for its own sessions; a home hub aggregates and routes.
 */
export const FLEET_PROTOCOL_VERSION = 1;

/** Lowercase slug, stable across restarts, unique within the fleet. */
export const HOST_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

export const HOST_STATES = ["reachable", "stale", "offline", "incompatible", "unauthorized"] as const;
export type HostState = (typeof HOST_STATES)[number];

/** Public answer of every hub: who am I, which protocol do I speak. */
export interface FleetHello {
  hostId: string;
  /** 2026-10-26: the remote's own readable name (its hostname). */
  label?: string;
  protocolVersion: number;
  hubVersion: string;
  serverTime: string;
}

/** Turns any machine name into a valid host id. */
export function toHostId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
  return slug.length > 0 ? slug : "hub";
}

/** Token labels of hubs paired with this one: `fleet:<home hostId>`. */
export const FLEET_TOKEN_PREFIX = "fleet:";

/**
 * The only paths a fleet token may use on a peer, and the only ones a home
 * hub forwards (ADR-0017). Never: tokens, WebAuthn, metrics, fleet admin.
 */
const FLEET_ROUTABLE = /^\/api\/(code\/(tree|meta|range|raw|find|line|archive|office)|sessions|events|adapters|approvals|attachments|discovery|inventory|notifications|projects|search|skills|prompt-enhance|prompt-recommendation|prompt-optimizer|aimetrics|hostmetrics)(\/|$)/;

export function isFleetRoutable(path: string): boolean {
  const bare = path.split("?")[0] ?? path;
  return FLEET_ROUTABLE.test(bare) && !bare.includes("/webauthn");
}

/** A paired hub as the home hub shows it — never with its token. */
export interface FleetPeerView {
  hostId: string;
  url: string;
  protocolVersion: number;
  pairedAt: string;
}

/** One host in the fleet overview (T6.3). */
export interface FleetHostView {
  hostId: string;
  /** 2026-10-26: human-readable host name — own hostname, or the peer's
   * URL host (e.g. "bmax.tail…"). Absent = unknown, the UI falls back to
   * the short hostId. */
  label?: string;
  self: boolean;
  url: string | null;
  state: HostState;
  /** Last successful sync — kept when the host goes away (AC-P6-3). */
  lastSyncAt: string | null;
  detail: string | null;
  sessions: number;
}
