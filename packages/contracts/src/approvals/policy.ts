import { BRIDGE_TOKEN_PREFIX } from "./tool-permission.ts";
import { FLEET_TOKEN_PREFIX } from "../fleet/fleet.ts";
import { COMPANION_TOKEN_PREFIX } from "../desktop/desktop.ts";
import { DISPLAY_TOKEN_PREFIX } from "./display.ts";

/**
 * T7.4: who acts, and what each actor may do — one table for every route,
 * the MCP gateway included. The server checks it; a hidden button protects
 * nothing (ADR-0018).
 *
 * Actors come from the token label:
 * - `agent:<name>` — an AI agent (e.g. the MCP gateway): may read, and
 *   request writes, but every write waits for a human; never decides.
 * - `bridge:<session>` — the permission bridge: asks and waits only
 *   (routes restricted in auth).
 * - `fleet:<home>` — a home hub forwarding a human's phone (ADR-0017).
 * - `companion:<pc>` — the desktop companion (ADR-0031): fetches what a
 *   person asked it to type and reports back; nothing else.
 * - `display:<name>` — a status display (ADR-0048): reads and decides `write`
 *   approvals by touch; never `destructive` (the route checks the class).
 * - anything else — a human's device.
 */
export const AGENT_TOKEN_PREFIX = "agent:";

export type ActorKind = "human" | "fleet" | "agent" | "bridge" | "companion" | "display";

export function actorKind(label: string | null | undefined): ActorKind {
  if (!label) return "human";
  if (label.startsWith(AGENT_TOKEN_PREFIX)) return "agent";
  if (label.startsWith(BRIDGE_TOKEN_PREFIX)) return "bridge";
  if (label.startsWith(FLEET_TOKEN_PREFIX)) return "fleet";
  if (label.startsWith(COMPANION_TOKEN_PREFIX)) return "companion";
  if (label.startsWith(DISPLAY_TOKEN_PREFIX)) return "display";
  return "human";
}

/** allow: runs now · approve: waits for a human decision · deny: 403 */
export type PolicyDecision = "allow" | "approve" | "deny";

export const POLICY_OPERATIONS = [
  "read",
  "sessions.create",
  "loops.start",
  "loops.onboard",
  "factory.start",
  "factory.control",
  "sessions.prompt",
  "sessions.park",
  "sessions.stop",
  "sessions.resume",
  "sessions.activity",
  "sessions.budget",
  "sessions.apply",
  "sessions.archive",
  /** EPIC-P29 T29.6: Setup-Retry führt genehmigte argv erneut aus — der Mensch entscheidet (ADR-0051 §3). */
  "workspace.retry",
  /** EPIC-P29 T29.6: Preview-Ticket für einen registrierten Service — das Handy des Menschen (auch via Fleet). */
  "workspace.preview",
  /** EPIC-P67 / ADR-0088: origin/Hauptbranch in eine Session einmischen —
   * Menschen (PWA-Knopf, Aktionsknopf der Benachrichtigung) und Agenten
   * (hubctl main-sync --apply, T67.9); History-Umschreibung gibt es nicht. */
  "main-sync.apply",
  "approvals.decide",
  "tokens.manage",
  "fleet.manage",
  "fleet.unpair",
  /** BUG-0188 (T-PJ1): Projektordner mit git init in den projectRoots dieses
   * Hosts anlegen — das Gerät des Menschen, auch über seinen Heim-Hub
   * (ADR-0017 führt „Projekte" in der Positivliste); Agenten nie. */
  "projects.create",
  "skills.write",
  "tools.ask",
  "attachments.upload",
  "settings.manage",
  "actions.run",
  "drafts.write",
  "push.subscribe",
  "voice.transcribe",
  /** EPIC-P75 (ADR-0097): Sprachausgabe — der TTS-Dienst ist der Kanal eines
   * Menschen; Agenten, Flotte und Displays beschallen ihn nicht. */
  "voice.speak",
  /** EPIC-P10.5: the hub fetches and analyses a video — a person's request. */
  "media.analyze",
  /** BUG-0110 (T1.5/T3.9/T5.10): enhance/recommendation/feedback cost real
   * money (one-shot CLI runs) and write learning data — not a read. */
  "prompt.enhance",
  /** EPIC-P41 / ADR-0064: Definition, Aktivierung, Generation — ein Mensch entscheidet (K1). */
  "automations.manage",
  /** EPIC-P41 §3.3: Run jetzt ist seine eigene Operation und nutzt die vorhandene Approval-Pipeline. */
  "automations.runNow",
  "desktop.act",
  "desktop.companion",
  /** EPIC-P40 (ADR-0064 §4), EPIC-P60 (ADR-0077): Teams starten/antworten/stopen darf nur der Mensch; Lesen dürfen Agenten. */
  "team.manage",
  /** EPIC-P60 (ADR-0077): Lese-Seite der Teams — Allow-Set identisch zum bisherigen generischen `read` der Fläche (reine Benennung). */
  "team.read",
  /** EPIC-P74 (ADR-0096 Nachtrag, T74.7): Wissens-Quellen lesen und befragen —
   * Agenten dürfen (via gateway-mcp), die Quellen-VERWALTUNG (CRUD, Geheimnisse)
   * bleibt settings.manage. */
  "knowledge.read",
  /** EPIC-P74: Notiz in eine Wissens-Quelle schreiben — schreibt in ein fremdes,
   * ggf. geteiltes Backend: IMMER Freigabe, auch für den Menschen am Panel
   * (EPIC-P74 §3.6 „Write-Pfad nie ohne Freigabe"). */
  "knowledge.add",
] as const;
export type PolicyOperation = (typeof POLICY_OPERATIONS)[number];

const HUMAN: PolicyDecision = "allow";

/**
 * The table. Humans (and a home hub acting for them) act directly — the
 * emergency stop above all. An agent requests; a human decides.
 */
export const POLICY: Readonly<Record<PolicyOperation, Readonly<Record<ActorKind, PolicyDecision>>>> = {
  read: { human: HUMAN, fleet: "allow", agent: "allow", bridge: "deny", companion: "deny", display: "allow" },
  "sessions.create": { human: HUMAN, fleet: "allow", agent: "approve", bridge: "deny", companion: "deny", display: "deny" },
  /** EPIC-P19 (AC-P19-8): ein Loop hat Außenwirkung (Merge in `dark`) — nur ein Mensch am eigenen Gerät. */
  "loops.start": { human: HUMAN, fleet: "deny", agent: "deny", bridge: "deny", companion: "deny", display: "deny" },
  /** Legt eine Linie mit Repo-Token an (Außenwirkung auf dem Host): nur ein Mensch. */
  "loops.onboard": { human: HUMAN, fleet: "deny", agent: "deny", bridge: "deny", companion: "deny", display: "deny" },
  /** ADR-0043 (T26.5): Factory-Lauf = Treiber-Session im Projekt + Beobachter — Außenwirkung, nur ein Mensch. */
  "factory.start": { human: HUMAN, fleet: "deny", agent: "deny", bridge: "deny", companion: "deny", display: "deny" },
  /** ADR-0043 (T26.6): Steuerung aus fester Allowlist (Modus, Fortsetzen, Lauf beenden) — nur ein Mensch, jeder Befehl auditiert. */
  "factory.control": { human: HUMAN, fleet: "deny", agent: "deny", bridge: "deny", companion: "deny", display: "deny" },
  "sessions.prompt": { human: HUMAN, fleet: "allow", agent: "approve", bridge: "deny", companion: "deny", display: "deny" },
  "sessions.park": { human: HUMAN, fleet: "allow", agent: "approve", bridge: "deny", companion: "deny", display: "deny" },
  "sessions.resume": { human: HUMAN, fleet: "allow", agent: "deny", bridge: "deny", companion: "deny", display: "deny" },
  /** ADR-0076: work reports contain no commands and cannot resume a session. */
  "sessions.activity": { human: HUMAN, fleet: "allow", agent: "deny", bridge: "deny", companion: "deny", display: "deny" },
  "sessions.stop": { human: HUMAN, fleet: "allow", agent: "approve", bridge: "deny", companion: "deny", display: "deny" },
  "sessions.budget": { human: HUMAN, fleet: "allow", agent: "approve", bridge: "deny", companion: "deny", display: "deny" },
  "sessions.apply": { human: HUMAN, fleet: "allow", agent: "deny", bridge: "deny", companion: "deny", display: "deny" },
  "sessions.archive": { human: HUMAN, fleet: "allow", agent: "deny", bridge: "deny", companion: "deny", display: "deny" },
  /** T29.6/ADR-0051 §3: „Retry nur menschlich" — keine zweite Ausführung durch Agenten, Displays oder die Fleet. */
  "workspace.retry": { human: HUMAN, fleet: "deny", agent: "deny", bridge: "deny", companion: "deny", display: "deny" },
  /** EPIC-P67 / ADR-0088: origin/Hauptbranch in eine Session einmischen —
   * ein Mensch entscheidet (PWA-Knopf, Aktionsknopf, hubctl mit Menschen-
   * Token). Agenten fragen über den Verlauf/GOTO, schreiben nie direkt
   * (Policy-Invariante „an agent never writes directly"); GET bleibt read. */
  "main-sync.apply": { human: HUMAN, fleet: "deny", agent: "deny", bridge: "deny", companion: "deny", display: "deny" },
  /** T29.6/ADR-0051 §6: Preview eines registrierten Service — ein Mensch (ggf. über den Heim-Hub), sonst niemand. */
  "workspace.preview": { human: HUMAN, fleet: "allow", agent: "deny", bridge: "deny", companion: "deny", display: "deny" },
  "approvals.decide": { human: HUMAN, fleet: "allow", agent: "deny", bridge: "deny", companion: "deny", display: "allow" },
  "tokens.manage": { human: HUMAN, fleet: "deny", agent: "deny", bridge: "deny", companion: "deny", display: "deny" },
  "fleet.manage": { human: HUMAN, fleet: "deny", agent: "deny", bridge: "deny", companion: "deny", display: "deny" },
  /** A paired home hub removes its own pairing (ADR-0017). */
  "fleet.unpair": { human: HUMAN, fleet: "allow", agent: "deny", bridge: "deny", companion: "deny", display: "deny" },
  /** BUG-0188 (T-PJ1): git init in den projectRoots dieses Hosts — Mensch
   * oder Fleet-Handy (ADR-0017 Positivliste „Projekte"); Agenten nie. */
  "projects.create": { human: HUMAN, fleet: "allow", agent: "deny", bridge: "deny", companion: "deny", display: "deny" },
  "skills.write": { human: HUMAN, fleet: "allow", agent: "deny", bridge: "deny", companion: "deny", display: "deny" },
  /** T7.2: a provider asks before a tool runs — the bridge's only job. */
  "tools.ask": { human: "deny", fleet: "deny", agent: "deny", bridge: "allow", companion: "deny", display: "deny" },
  /** T7.10: files into sessions — from a person's device (or their home hub). */
  "attachments.upload": { human: HUMAN, fleet: "allow", agent: "deny", bridge: "deny", companion: "deny", display: "deny" },
  /** T7.10: hub settings incl. the Gemini key — this hub's own devices only. */
  "settings.manage": { human: HUMAN, fleet: "deny", agent: "deny", bridge: "deny", companion: "deny", display: "deny" },
  /** T7.6: registered test/git/tool actions — a person's button. An agent
   * runs its tools inside its own harness, gated there (T7.2). */
  "actions.run": { human: HUMAN, fleet: "allow", agent: "deny", bridge: "deny", companion: "deny", display: "deny" },
  /** T8.4: a person's unsent reply — agents neither read nor write it. */
  // ADR-0069: Display may fill the shared composer draft (never auto-send).
  "drafts.write": { human: HUMAN, fleet: "allow", agent: "deny", bridge: "deny", companion: "deny", display: "allow" },
  /** T8.3: a device subscribes itself to Web Push. */
  "push.subscribe": { human: HUMAN, fleet: "deny", agent: "deny", bridge: "deny", companion: "deny", display: "deny" },
  /** T10.2: a person's own voice — not something an agent sends in. */
  "voice.transcribe": { human: HUMAN, fleet: "allow", agent: "deny", bridge: "deny", companion: "deny", display: "deny" },
  /** EPIC-P75 (ADR-0097): read-aloud goes to a person's ears — not an agent
   * output channel, not fleet/display speakers. */
  "voice.speak": { human: HUMAN, fleet: "deny", agent: "deny", bridge: "deny", companion: "deny", display: "deny" },
  /** EPIC-P10.5: the hub fetches and analyses a video — a person's request. */
  "media.analyze": { human: HUMAN, fleet: "allow", agent: "deny", bridge: "deny", companion: "deny", display: "deny" },
  /** BUG-0110: paid CLI runs and the learning log — not a read operation.
   * Agent and display are denied (ADR-0048 invariant); humans and their fleet
   * keep the buttons. */
  "prompt.enhance": { human: HUMAN, fleet: "allow", agent: "deny", bridge: "deny", companion: "deny", display: "deny" },
  /** ADR-0064: Aktivieren/definieren nur Mensch (auch via Fleet-Handy); Agenten nie. */
  "automations.manage": { human: HUMAN, fleet: "allow", agent: "deny", bridge: "deny", companion: "deny", display: "deny" },
  /** EPIC-P41 §3.3: Run jetzt — gleiche Actor-Regel wie die Aktivisierung. */
  "automations.runNow": { human: HUMAN, fleet: "allow", agent: "deny", bridge: "deny", companion: "deny", display: "deny" },
  /** EPIC-P11: a person's dictation typed on a PC — never an agent's. */
  "desktop.act": { human: HUMAN, fleet: "deny", agent: "deny", bridge: "deny", companion: "deny", display: "deny" },
  /** EPIC-P11: the companion fetches its work and reports — its only job. */
  "desktop.companion": { human: "deny", fleet: "deny", agent: "deny", bridge: "deny", companion: "allow", display: "deny" },
  /** EPIC-P40/EPIC-P60 (ADR-0064 §4, ADR-0077): Teams verwalten — nur der Mensch. */
  "team.manage": { human: HUMAN, fleet: "deny", agent: "deny", bridge: "deny", companion: "deny", display: "deny" },
  /** EPIC-P60 (ADR-0077): Teams lesen — wie das bisherige generische `read` der Fläche. */
  "team.read": { human: HUMAN, fleet: "allow", agent: "allow", bridge: "deny", companion: "deny", display: "allow" },
  /** EPIC-P74 (ADR-0096 Nachtrag): Lesen/Befragen wie das generische `read`
   * der Fläche — Quellen-Verwaltung bleibt settings.manage (deny für Agenten). */
  "knowledge.read": { human: HUMAN, fleet: "allow", agent: "allow", bridge: "deny", companion: "deny", display: "allow" },
  /** EPIC-P74: Schreiben in den Brain — Agent fragt an (approve), Mensch/Fleet
   * legt an; die Route legt für jeden Akteur eine Freigabe an (ein Code-Pfad). */
  "knowledge.add": { human: HUMAN, fleet: "allow", agent: "approve", bridge: "deny", companion: "deny", display: "deny" },
};

export function policyFor(operation: PolicyOperation, label: string | null | undefined): PolicyDecision {
  return POLICY[operation][actorKind(label)];
}
