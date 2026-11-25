import { BRIDGE_TOKEN_PREFIX, COMPANION_TOKEN_PREFIX, DISPLAY_TOKEN_PREFIX, FLEET_TOKEN_PREFIX, bridgeTokenAllows, companionTokenAllows, displayTokenAllows, isFleetRoutable } from "@ancientvoid/contracts";
import type { FastifyRequest, FastifyReply } from "fastify";
import { hashToken, type TokenService } from "@ancientvoid/core";

/**
 * Auth (PRD §8): Tailnet-only deployment, device-token bearer auth.
 * When `enforceTailnetIdentity` is on, requests must carry the Tailscale
 * identity headers injected by `tailscale serve` — direct LAN hits bounce.
 */
export interface AuthOptions {
  tokens: TokenService;
  enforceTailnetIdentity: boolean;
}

declare module "fastify" {
  interface FastifyContextConfig {
    sessionTail?: "ticket" | "upgrade";
  }
  interface FastifyRequest {
    authenticatedTokenHash?: string;
  }
}

const TAILSCALE_LOGIN_HEADER = "tailscale-user-login";

/**
 * EPIC-P29 T29.6: die Preview-Route des Workspace-Proxys. Ein iframe kann
 * keinen Bearer-Header setzen — diese eine URL authentifiziert sich mit dem
 * kurzlebigen, gebundenen Ticket aus der preview-ticket-Route (STT-Muster).
 * Freistellung NUR mit `ticket=`-Parameter und nur für GET/HEAD; ohne
 * gültiges Ticket antwortet die Route selbst mit 401.
 */
const WORKSPACE_PROXY_TICKET_PATH = /^\/api\/sessions\/[0-9a-fA-F-]{36}\/workspace\/services\/[a-z][a-z0-9-]{0,39}\/proxy(\/[^?]*)?$/;

/** ADR-0087: der Terminal-Stream — ids wie in der Config (zod: kleine Buchstaben, Ziffern, -/_). */
const TERMINAL_STREAM_PATH = /^\/api\/terminals\/[a-z0-9][a-z0-9_-]{0,63}\/stream$/;

export function isWorkspaceProxyTicketRequest(method: string, url: string): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  const [path, query = ""] = url.split("?");
  return (method === "GET" || method === "HEAD") && WORKSPACE_PROXY_TICKET_PATH.test(path ?? "") && query.split("&").some((part) => part === "ticket" || part === "ticket=" || part.startsWith("ticket="));
}

export function extractToken(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice("Bearer ".length).trim();
  if (req.routeOptions.config.sessionTail) return null;
  const q = (req.query as Record<string, string> | undefined)?.token;
  return typeof q === "string" && q.length > 0 ? q : null;
}

function checkAuth(req: FastifyRequest, opts: AuthOptions): { ok: true } | { ok: false; status: number; reason: string } {
  const token = extractToken(req);
  // T7.2: the permission bridge runs on this machine and talks to the hub
  // directly, not through tailscale serve.
  // EPIC-P11: so does a desktop companion on the hub's own machine.
  // ADR-0048: and a status display's bridge process (USB on this machine).
  const tokenLabel = token !== null ? (opts.tokens.identify(token)?.label ?? "") : "";
  const bridgeOnLoopback = (tokenLabel.startsWith(BRIDGE_TOKEN_PREFIX) || tokenLabel.startsWith(COMPANION_TOKEN_PREFIX) || tokenLabel.startsWith(DISPLAY_TOKEN_PREFIX)) && /^(127\.|::1$|::ffff:127\.)/.test(req.ip);
  if (opts.enforceTailnetIdentity && !req.headers[TAILSCALE_LOGIN_HEADER] && !bridgeOnLoopback) {
    return { ok: false, status: 401, reason: "missing tailnet identity (serve via tailscale)" };
  }
  if (!token) return { ok: false, status: 401, reason: "missing device token" };
  if (!opts.tokens.verify(token)) return { ok: false, status: 401, reason: "invalid device token" };
  // ADR-0017: a hub's fleet token only reaches what a home hub may forward.
  const label = tokenLabel;
  const path = req.url.split("?")[0] ?? req.url;
  if (label.startsWith(FLEET_TOKEN_PREFIX) && !isFleetRoutable(path) && path !== "/api/fleet/pairing") {
    return { ok: false, status: 403, reason: "fleet token not allowed here" };
  }
  // T7.2: the permission bridge may ask and wait for its own session only —
  // never decide, never read anything else.
  if (label.startsWith(BRIDGE_TOKEN_PREFIX) && !bridgeTokenAllows(label, path)) {
    return { ok: false, status: 403, reason: "bridge token not allowed here" };
  }
  // EPIC-P11: the companion fetches its work and reports — nothing else.
  if (label.startsWith(COMPANION_TOKEN_PREFIX) && !companionTokenAllows(path)) {
    return { ok: false, status: 403, reason: "companion token not allowed here" };
  }
  // ADR-0048: a display reads the hub's state and decides write approvals — nothing else.
  if (label.startsWith(DISPLAY_TOKEN_PREFIX) && !displayTokenAllows(req.method, path)) {
    return { ok: false, status: 403, reason: "display token not allowed here" };
  }
  if (req.routeOptions.config.sessionTail) req.authenticatedTokenHash = hashToken(token);
  return { ok: true };
}

export function authHook(opts: AuthOptions) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    // health/ready stay open for tailnet and process probes (ADR-0010).
    // Strip the query string — `/api/health?foo` must not fall through to 401.
    const path = req.url.split("?")[0] ?? req.url;
    // A ticket upgrade proves its authorization in the stream route. Requests
    // with a Bearer header still take the full auth and policy path.
    if (req.ws && req.routeOptions.config.sessionTail === "upgrade" && !req.headers.authorization) return;
    // STT WebSocket upgrades authenticate with a short-lived, single-use
    // ticket instead of putting the reusable device token in the URL.
    if (req.method === "GET" && path === "/api/stt/stream") return;
    // ADR-0087: Terminal-Streams genauso — ein Browser-WebSocket kann keinen
    // Bearer-Header tragen, und das wiederverwendbare Device-Token gehört
    // nie in die URL (BUG-0028). Die Route prüft ihr kurzlebiges, an die
    // Ziel-id gebundenes Ticket selbst und weist alles Ungültige ab (4401).
    if (req.method === "GET" && TERMINAL_STREAM_PATH.test(path)) return;
    // EPIC-P29 T29.6: preview iframe — ticket statt Bearer (s. oben). Die
    // Route prüft das Ticket selbst; jeder andere /api/-Pfad bleibt dicht.
    if (isWorkspaceProxyTicketRequest(req.method, req.url)) return;
    // ADR-0017: hello tells other hubs who this is; no data, no token needed.
    // Pairing is guarded by its one-time code, not a device token.
    if (path === "/api/health" || path === "/api/ready" || path === "/api/fleet/hello" || path === "/api/fleet/pair") return;
    // BUG-0006: everything, including the static PWA shell (index.html,
    // its JS/CSS bundle, manifest, service worker), used to require a
    // device token — but a real browser only carries a URL's ?token= on
    // the document request, never on the <script>/<link> requests that
    // request triggers. A brand-new device could reach TokenGate's own
    // markup at most once (the HTML, via ?token=) and then 401 on the
    // bundle that renders it. The actual protected surface is the API,
    // not the app shell — a SPA's static files are public the same way
    // any other app's install artifact is; auth happens at the data
    // calls. Exempt everything outside /api/ instead of the app shell
    // needing a token it has no way to keep carrying.
    if (!req.url.startsWith("/api/")) return;
    const res = checkAuth(req, opts);
    if (!res.ok) {
      await reply.code(res.status).send({ error: res.reason });
    }
  };
}
