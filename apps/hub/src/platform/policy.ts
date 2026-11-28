import type { FastifyReply, FastifyRequest } from "fastify";
import { policyFor, type PolicyDecision, type PolicyOperation } from "@ancientvoid/contracts";
import type { TokenService } from "@ancientvoid/core";
import { extractToken } from "./auth.ts";

/**
 * T7.4: every API route maps to one policy operation; the decision comes
 * from the shared table (contracts/approvals/policy.ts). `deny` ends here
 * with 403; `approve` is left to the route (it files an approval instead
 * of acting). Unmapped writes count as deny for agents — fail closed.
 */
export function operationOf(method: string, url: string, body: unknown): PolicyOperation | null {
  const path = url.split("?")[0] ?? url;
  // Asking and polling alike: the bridge's own route, nobody else's.
  if (/^\/api\/sessions\/[^/]+\/tool-permissions/.test(path)) return "tools.ask";
  // T8.4: drafts are a person's, reading included.
  if (/^\/api\/sessions\/[^/]+\/draft$/.test(path)) return "drafts.write";
  // EPIC-P11: the companion's long poll is a GET, but not a read.
  if (path.startsWith("/api/desktop/companion/")) return "desktop.companion";
  // EPIC-P49 (ADR-0063 §4): Der Vault ist eine Menschenfläche — auch das Lesen
  // ist keine allgemeine Lese-Operation, sondern settings.manage (Agenten: deny).
  if (path.startsWith("/api/vault")) return "settings.manage";
  // Verbindungs-Registry (VoidWarden-Tokens, Endpoint-Schlüssel-Hinweise):
  // ebenfalls eine Menschenfläche — Lesen wie Schreiben (Muster Vault).
  if (path.startsWith("/api/connections")) return "settings.manage";
  // EPIC-P74 (ADR-0096 + Nachtrag T74.7): Verwaltung der Quellen (Geheimnisse,
  // fremder Text) bleibt Menschenfläche; Befragen (Liste/Prüfen/Suchen/Lesen/
  // Graph) dürfen Agenten über die gateway-mcp-Meta-Tools (knowledge.read).
  // Schreiben ist immer eine Freigabe (knowledge.add) — auch für Menschen (§3.6).
  if (path.startsWith("/api/knowledge")) {
    if (/^\/api\/knowledge\/sources\/[^/]+\/(probe|search|read|graph)$/.test(path)) return "knowledge.read";
    if (/^\/api\/knowledge\/sources\/[^/]+\/add$/.test(path)) return "knowledge.add";
    if (path === "/api/knowledge/sources" && (method === "GET" || method === "HEAD")) return "knowledge.read";
    return "settings.manage";
  }
  // EPIC-P80 (ADR-0118): Pentest — lesen wie das generische read der Fläche;
  // der Scan selbst ist die Tat (Policy-Tabelle: Agent erfragt, Mensch/Fleet tun).
  if (path === "/api/pentest/scan" && method === "POST") return "scan.run";
  if (path.startsWith("/api/pentest/")) return "scan.read";
  // EPIC-P40/EPIC-P60 (ADR-0064 §4, ADR-0077), EPIC-P83 (ADR-0123): Swarms steuern nur Menschen;
  // Lesen ist eine eigene Operation mit dem Allow-Set des bisherigen generischen `read`.
  if (path.startsWith("/api/swarms")) return method === "GET" || method === "HEAD" ? "swarm.read" : "swarm.manage";
  // EPIC-P75 (ADR-0097): Sprachausgabe — Status wie Synthese sind die Fläche
  // eines Menschen; Agenten/Flotte/Displays beschallen den Dienst nicht.
  if (path === "/api/tts") return "voice.speak";
  if (/^\/api\/sessions\/[^/]+\/(evaluation|focus)$/.test(path)) return "settings.manage";
  if (path === "/api/evaluation/runs") return "settings.manage";
  if (method === "GET" || method === "HEAD") return "read";
  if ((path === "/api/stt" || path === "/api/stt/stream-ticket") && method === "POST") return "voice.transcribe";
  if (path.startsWith("/api/media/")) return "media.analyze";
  if (path.startsWith("/api/desktop/")) return "desktop.act";
  // T9.3: planning is reading; executing runs every step through the real
  // route with the caller's own token — that route's policy decides.
  if (path.startsWith("/api/commands/")) return "read";
  if (/^\/api\/sessions\/[^/]+\/actions\/[^/]+$/.test(path) || /^\/api\/sessions\/[^/]+\/actions\/runs\/[^/]+\/stop$/.test(path)) return "actions.run";
  if (/^\/api\/loops\/[^/]+\/onboard$/.test(path)) return "loops.onboard";
  // ADR-0043: Factory-Lauf starten/steuern — Außenwirkung, nur Menschen (Policy-Tabelle).
  if (path === "/api/factory/start") return "factory.start";
  if (/^\/api\/factory\/[^/]+\/command$/.test(path)) return "factory.control";
  if (path === "/api/sessions") return (body as { loop?: unknown } | undefined)?.loop ? "loops.start" : "sessions.create";
  if (/^\/api\/sessions\/[^/]+\/steer$/.test(path)) {
    const kind = (body as { kind?: unknown } | undefined)?.kind;
    return kind === "resume" ? "sessions.resume" : kind === "park" ? "sessions.park" : kind === "stop" ? "sessions.stop" : "sessions.prompt";
  }
  if (/^\/api\/sessions\/[^/]+\/resume$/.test(path)) return "sessions.resume";
  // EPIC-P15/ADR-0085: die eigene Warteschlange ändern — Text, Stelle, streichen,
  // sofort senden. Ohne Mapping galt der Fail-closed-Fallback und die Flotte war
  // draußen (Nutzerfund 23.11.2026: „editieren und löschen geht nicht“).
  if (/^\/api\/sessions\/[^/]+\/queue(\/[^/]+(\/send)?)?$/.test(path)) return "sessions.queue";
  if (/^\/api\/sessions\/[^/]+\/activity$/.test(path)) return "sessions.activity";
  if (/^\/api\/sessions\/[^/]+\/stop$/.test(path)) return "sessions.stop";
  if (/^\/api\/sessions\/[^/]+\/budget$/.test(path)) return "sessions.budget";
  if (/^\/api\/sessions\/[^/]+\/apply$/.test(path)) return "sessions.apply";
  if (method === "DELETE" && /^\/api\/sessions\/[^/]+$/.test(path)) return "sessions.archive";
  if (/^\/api\/sessions\/[^/]+\/(archive|meta)$/.test(path)) return "sessions.archive";
  // EPIC-P29 T29.6: Workspace-Retry führt genehmigte argv erneut aus —
  // nur ein Mensch (ADR-0051 §3); Preview-Ticket ebenso an die Person gebunden.
  if (/^\/api\/sessions\/[^/]+\/workspace\/retry$/.test(path)) return "workspace.retry";
  // EPIC-P67 T67.6: Main-Sync an einer Session anwenden (Mensch + Agent, Policy-Tabelle).
  if (/^\/api\/sessions\/[^/]+\/main-sync$/.test(path) && method !== "GET" && method !== "HEAD") return "main-sync.apply";
  if (/^\/api\/sessions\/[^/]+\/workspace\/services\/[^/]+\/preview-ticket$/.test(path)) return "workspace.preview";
  if (/^\/api\/approvals\/[^/]+\/(decide|webauthn\/)/.test(path)) return "approvals.decide";
  if (path.startsWith("/api/tokens") || path.startsWith("/api/webauthn/register")) return "tokens.manage";
  if (path === "/api/fleet/pairing") return "fleet.unpair";
  if (path.startsWith("/api/fleet/")) return "fleet.manage";
  // BUG-0188 (T-PJ1): Projekt anlegen (git init in projectRoots dieses Hosts)
  // — ohne Mapping galt hier fail-closed deny, auch für den Heim-Hub eines
  // Menschen (ADR-0017 Positivliste „Projekte").
  if (path === "/api/projects" && method === "POST") return "projects.create";
  if (path === "/api/skills") return "skills.write";
  // EPIC-P68: a revision proposal writes nothing — it is a rewrite call like enhance.
  if (path === "/api/skills/revise") return "prompt.enhance";
  if (path.startsWith("/api/attachments")) return "attachments.upload";
  // Nur dieser Hub, nur von Hand: Bild aus dem lokalen Dateisystem holen.
  if (path.startsWith("/api/local-files")) return "files.readLocal";
  if (path.startsWith("/api/settings") || path.startsWith("/api/vault") || path === "/api/push/enabled") return "settings.manage";
  if (path.startsWith("/api/push/")) return "push.subscribe";
  if (path === "/api/prompt-enhance" || path === "/api/prompt-recommendation" || path === "/api/prompt-optimizer/feedback") return "prompt.enhance";
  // EPIC-P41 (ADR-0064): Verwaltung und Run-now — die Tabelle entscheidet (Mensch+Flotte; Agenten deny).
  if (path === "/api/automations" && method === "POST") return "automations.manage";
  if (/^\/api\/automations\/[^/]+\/run-now$/.test(path)) return "automations.runNow";
  if (/^\/api\/automations\/[^/]+\/resolve$/.test(path)) return "automations.manage";
  if (/^\/api\/automations\/[^/]+\/enable$/.test(path) || (path.startsWith("/api/automations/") && method === "PATCH")) return "automations.manage";
  return null;
}

declare module "fastify" {
  interface FastifyRequest {
    /** T7.4: set when this actor may only request, not act. */
    policy?: { decision: PolicyDecision; actor: string };
  }
}

export function policyHook(tokens: TokenService) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.url.startsWith("/api/")) return;
    const token = extractToken(req);
    const label = token ? (tokens.identify(token)?.label ?? null) : null;
    // BUG-0108: a token that verifies but carries no label is no actor —
    // it must not silently inherit the human row (actorKind("") would).
    // Unattributable means fail closed, no route left.
    if (token && label === "") {
      await reply.code(403).send({ error: "Token ohne Label — nicht zuordenbar, fail closed" });
      return;
    }
    if (!label) return; // public routes (auth already let them through)
    const operation = req.routeOptions.config.sessionTail === "ticket" ? "read" : operationOf(req.method, req.url, req.body);

    const decision: PolicyDecision = operation ? policyFor(operation, label) : policyFor("tokens.manage", label) === "allow" ? "allow" : "deny";
    if (decision === "deny") {
      await reply.code(403).send({ error: `Nicht erlaubt für ${label}: ${operation ?? `${req.method} ${req.url.split("?")[0]}`}` });
      return;
    }
    req.policy = { decision, actor: label };
  };
}
