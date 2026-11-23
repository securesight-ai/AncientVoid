import { compactionSettingsPath, type CompactionSettings } from "@ancientvoid/contracts";
import { errorText } from "./i18n/index.ts";
import type { PromptRecommendation, SkillArtifact, RewriteEngine, SkippedEngine, SessionActivity } from "@ancientvoid/contracts";
import type { KnowledgeOverview, KnowledgeReadResult, KnowledgeSearchResult, KnowledgeSourceInputRaw, KnowledgeSourceView } from "@ancientvoid/contracts";
export type { PromptRecommendation, SkillArtifact, RewriteEngine, SkippedEngine };
import type { DeploymentIdentity, QueueDeliveryState, AiMetricsReport, InferenceAskResult, InferenceModelStatus, InferenceModelView, InferenceSnapshot, InferenceSourceList, StatisticsReport, Team, TeamStart, AutomationDefinition, AutomationInfo, AutomationHistoryEntry, ExternalJobsResponse, BrowserAction, BrowserFeedbackInput, BrowserPick, BrowserStatus, BrowserTestCase, BrowserTestRun, DeviceAction, DeviceStatus, DeviceTestCase, DeviceTestRun, DiagnosticsResult, FileMeta, GitGraphReport, GraphDiagnosis, GraphReport, ProjectTrust, FileRange, TreeListing, LoopInfo, LoopOnboardResult, LoopSpec, ReleaseNotesDetail, ReleaseNotesListReport, SttStreamTicket, TerminalList, TerminalTarget, TerminalTicket, VaultBrowse, VaultFile, VaultListing, VaultRead, VaultState, WorkspacePreviewTicket, WorkspaceServiceLogs, WorkspaceStatus } from "@ancientvoid/contracts";
export type { TerminalTarget };
import type { TtsSettingsPatch, TtsSettingsView, TtsStatusResponse } from "@ancientvoid/contracts";
import type { SessionTextSearchResponse, TranscriptRole, UnifiedSearchResponse } from "@ancientvoid/contracts";
import { noteApprovalDecided } from "./first-run.ts";
export interface SessionRecord {
  id: string;
  adapter: string;
  project: string;
  worktreeSha: string | null;
  status: string;
  /** Detailed session response, backed by the Hub's activity register. */
  openActivities?: SessionActivity[];
  createdAt: string;
  model: string | null;
  /** ADR-0033: the permission mode the session runs in; absent on older hubs. */
  permissionMode?: string | null;
  /** ADR-0011: wer die Session führt; `mirror` = nur beobachtet (kein Arbeitsort). */
  controlMode?: "observed" | "managed" | "controllable" | "mirror";
  /** ADR-0057: belegter Arbeitsort; `unknown` = Altdaten ohne Beleg, fehlt auf älteren Hubs. */
  workspaceMode?: "worktree" | "direct" | "unknown";
  workspaceBaseline?: { checkoutId: string; head: string | null; branch: string | null; dirty: string[]; dirtyTruncated: boolean } | null;
  budgetUsd: number | null;
  adapterVersion: string;
  lastSeq: number;
  costUsd: number;
  updatedAt: string;
  /** ADR-0006 — summed from real per-event usage where an adapter reports
   * it (claude); 0 means "unreported", not "confirmed zero" (same caveat
   * as costUsd). */
  tokensEst: number;
  /** T7.7 (ADR-0023): how far costUsd/tokensEst can be trusted. Missing
   * from older hubs. */
  metrics?: {
    cost: "unknown" | "partial" | "estimated" | "native";
    tokens: "unknown" | "partial" | "estimated" | "native";
    counters: { turns: number; costTurns: number; tokenTurns: number };
  };
  /** T2.7/ADR-0008: why a "parked" session is paused — null otherwise, or
   * for a manually parked session that predates this field. */
  parkReason: "manual" | "budget" | "daily_cap" | null;
  /** Real user request (2026-09-19): continue the exact same worker from
   * a desktop terminal. Present only for a genuinely live session on a
   * genuinely tmux-backed hub (see routes.ts's withAttachCmd) — absent
   * otherwise, never a fabricated command. */
  attachCmd?: string;
  /** T5.5: terminal command that opens this provider session natively on
   * the PC; only present between turns and when the native id is known. */
  openCmd?: string;
  /** EPIC-P6: the hub this session lives on (absent on old hubs). */
  hostId?: string;
  /** First line of the start prompt (null for sessions without one). */
  title?: string | null;
  /** Session files live in their own git worktree, not the project checkout. */
  worktree?: { path: string; branch: string };
  /** Hidden from the overview until the Archiv chip is on. */
  archived?: boolean;
  /** T8.6: pinned to the top of the overview. */
  pinned?: boolean;
  /** ADR-0076 Nachtrag (Limit-Wiederaufnahme): Option dieser Session — nach
   * einem Kontingent-/Rate-Limit-Fenster automatisch fortsetzen. */
  autoResumeOnLimit?: boolean;
  /** P5: counts prompts; a plan made on an older value is refused (T9.3). */
  inputRevision?: number;
  /** T8.1: the last understandable action (absent on older hubs). */
  lastActivity?: { text: string; type: string; at: string } | null;
}

/** T2.4/ADR-0007 — mirrors `@ancientvoid/contracts`'s ApprovalRequest, same
 * duplication convention this file already uses for SessionRecord etc.
 * `read`-class never appears here — it's free and never queued. */
type ApprovalClass = "read" | "write" | "destructive";
type ApprovalStatus = "pending" | "approved" | "rejected" | "timed_out";

/** T7.2 — mirrors `@ancientvoid/contracts`'s ToolQuestion (claude AskUserQuestion). */
export interface ToolQuestion {
  question: string;
  header?: string;
  options: { label: string; description?: string }[];
  multiSelect: boolean;
  required?: boolean;
}

export interface ApprovalRequest {
  id: string;
  sessionId: string;
  class: ApprovalClass;
  action: string;
  summary: string;
  createdAt: string;
  timeoutAt: string;
  status: ApprovalStatus;
  reasonRequired: boolean;
  reason: string | null;
  decidedAt: string | null;
  decidedByLabel: string | null;
  signature: string | null;
  /** T7.2: a provider's own tool request or question. */
  tool?: { name: string; input: string; questions?: ToolQuestion[] };
  /** T7.3: what the decision released and what became of it. */
  operation?: { state: "pending" | "rejected" | "timed_out" | "dispatching" | "done" | "failed" | "uncertain"; outcome: string | null };
  /** T7.9: the gatekeeper's label (never a decision). */
  assessment?: ToolAssessment | null;
}

export interface ToolAssessment {
  toolRisk: "READ_ONLY" | "LOCAL_WRITE" | "DESTRUCTIVE" | "EXFILTRATION";
  securityGate: "CLEAN" | "WARNING" | "CRITICAL_BLOCK";
  source: "model" | "rules" | "fallback";
  confidence: { toolRisk: number | null; securityGate: number | null };
  model: string | null;
  latencyMs: number | null;
  notes: string[];
}

/** T3.8: one real qmd hit — `file` is relative to `project`, `line` is
 * the real anchor `qmd get`/a file viewer can jump to. */
export interface SearchResult {
  file: string;
  line: number;
  title: string;
  snippet: string;
  score: number;
}

interface SearchStatus {
  qmdAvailable: boolean;
  indexed: boolean;
}

interface SearchResponse {
  status: "indexing" | "ready";
  /** Welche Stufe geantwortet hat — „local“ ohne qmd, „qmd“ mit. */
  engine?: "qmd" | "local";
  results: SearchResult[];
}

/** Suche (Nachschärfe 2026-11-22): Parameter der beiden neuen Endpunkte. */
export interface SearchInput {
  q: string;
  /** Projekt der Dokuchecke. */
  project?: string;
  /** Grenze der Sitzungsseite — unabhängig von der Dokuchecke. */
  sessionProject?: string;
  projectUnder?: string;
  session?: string;
  /** Doku über alle Projekte des Hubs statt nur das aktuelle. Zusammen mit
   * `project` senden wäre widersprüchlich — die Hub-Route ignoriert dann `project`. */
  allProjects?: boolean;
  /** Auch die gekoppelten Hub-Rechner durchsuchen (Cross-Hub). */
  hubs?: boolean;
  scope?: "all" | "docs" | "sessions";
  roles?: TranscriptRole[];
  limit?: number;
  offset?: number;
}

function searchQuery(input: SearchInput): string {
  const p = new URLSearchParams();
  p.set("q", input.q);
  if (input.project) p.set("project", input.project);
  if (input.sessionProject) p.set("sessionProject", input.sessionProject);
  if (input.projectUnder) p.set("projectUnder", input.projectUnder);
  if (input.allProjects) p.set("allProjects", "1");
  if (input.hubs) p.set("hubs", "1");
  if (input.session) p.set("session", input.session);
  if (input.scope && input.scope !== "all") p.set("scope", input.scope);
  if (input.roles && input.roles.length) p.set("roles", input.roles.join(","));
  if (input.limit) p.set("limit", String(input.limit));
  if (input.offset) p.set("offset", String(input.offset));
  return p.toString();
}

export interface ProjectFile {
  path: string;
  content: string;
  lineCount: number;
}

/** Ein Dokument der Übersicht — Pfad, erste Überschrift, Größe. */
export interface ProjectDoc {
  path: string;
  title: string | null;
  bytes: number;
}

/** T7.6: which checkout a code view shows. */
export interface WorkspaceIdentity {
  kind: "session" | "project";
  sessionId: string | null;
  root: string;
  branch: string | null;
  head: string | null;
  base: string | null;
}

interface CodeMatch {
  path: string;
  line: number;
  column: number;
  text: string;
  kind: "definition" | "match";
}

export interface CodeSearchResult {
  identity: WorkspaceIdentity;
  engine: "ripgrep" | "git-grep";
  matches: CodeMatch[];
  truncated: boolean;
}

export interface CodeFile {
  identity: WorkspaceIdentity;
  path: string;
  language: string;
  bytes: number;
  lines: number;
  content: string;
  truncated: boolean;
  binary: boolean;
  blobSha: string | null;
  changed: { additions: number; deletions: number } | null;
}

export interface ActionDefinition {
  id: string;
  label: string;
  kind: "test" | "git" | "tool";
  source?: string;
  argv: string[];
  params: Record<string, { description: string; pattern: string; optional: boolean }>;
  readOnly: boolean;
  timeoutMs: number;
  longRunning?: boolean;
}

export interface ActionRun {
  id: string;
  sessionId: string;
  actionId: string;
  argv: string[];
  status: "running" | "succeeded" | "failed" | "timeout" | "stopped";
  exitCode: number | null;
  startedAt: string;
  endedAt: string | null;
  actor: string | null;
  output: string;
  outputTruncated: boolean;
}

/** T2.2: one structured hunk — `functionContext` is git's own real
 * function/section-context heuristic (absent for some hunks/languages,
 * never guessed when missing). `collapsed` means `body` is a short
 * preview under K3, not the full hunk — fetch the rest via
 * `hubApi.sessionDiffHunk()`. */
export interface DiffHunk {
  header: string;
  functionContext: string | null;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  body: string;
  collapsed: boolean;
}

/** T1.6-4/T1.6-5 → T2.2 — shared by the Bericht tab's file count and the
 * Diff tab's patch view. `error` names a real reason (no git repo, no
 * changes) rather than a silently empty result. */
export interface SessionDiffFile {
  path: string;
  additions: number;
  deletions: number;
  binary: boolean;
  hunks: DiffHunk[];
}

/** AC-P2-1: ein Commit seit baseRef mit eigenem per-File-Diff — die
 * Diff-Ansicht gliedert danach in einen Abschnitt pro Commit. */
export interface DiffCommit {
  sha: string;
  shortSha: string;
  author: string;
  date: string;
  subject: string;
  files: SessionDiffFile[];
  /** Teilbefund: Commit-Diff ueber der Groessenkante des Hubs (BUG-0204). */
  oversize?: { files: number | null; changedLines: number | null };
}

export interface WorkspacePreview {
  checkoutId: string;
  isGit: boolean;
  worktreePossible: boolean;
  branch: string | null;
  head: string | null;
  dirty: string[];
  dirtyTruncated: boolean;
  /** Session-Id des aktuellen AV-Schreibers im direkten Checkout, sonst null. */
  heldBy: string | null;
  /** ADR-0081: alle Sessions, die hier schon schreiben (Primär-Lease + Mit-Nutzer). */
  holders?: string[];
}

interface WorkplaceStatus {
  mode: "worktree" | "direct" | "unknown";
  path: string;
  baseline: SessionRecord["workspaceBaseline"];
  drift: { headMoved: boolean; branchChanged: boolean; head: string | null; branch: string | null } | null;
  leaseGeneration: number | null;
}

export interface SessionDiffResult {
  /** ADR-0057: bei „Projekt direkt“ — beim Start schon geänderte Pfade gehören nicht der Session. */
  baseline?: { dirtyAtStart: string[]; dirtyTruncated: boolean; headAtStart: string | null; branchAtStart: string | null };
  /** Seit AC-P2-1 nur der uncommittete Rest seit HEAD — der committete
   * Teil liegt in `commits[]`. */
  files: SessionDiffFile[];
  /** AC-P2-1: Commits seit baseRef, ältester zuerst. */
  commits: DiffCommit[];
  commitsTruncated?: boolean;
  patch: string;
  truncated: boolean;
  /** T2.2: the real ref this diff was computed against — the session's
   * worktree base_sha (T2.1) when isolated, else the literal "HEAD". */
  baseRef: string;
  error?: string;
}

/** EPIC-P36 / ADR-0055: eine Review-Notiz mit Diff-Identität (PWA-Kopie
 * des Contract-Typs, wie SessionDiffResult — der PWA-Client bleibt vom
 * Hub-Paket entkoppelt). */
export type ReviewNoteStatus = "draft" | "sent" | "open" | "done";
type ReviewAnchorState = "valid" | "stale" | "unclear";

export interface ReviewNoteView {
  id: string;
  sessionId: string;
  basis: {
    baseRef: string;
    headSha: string | null;
    scope: { kind: "commit"; sha: string } | { kind: "uncommitted" };
  };
  anchor: { path: string; side: "old" | "new"; startLine: number; endLine: number; excerpt: string };
  text: string;
  status: ReviewNoteStatus;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
  operationId: string | null;
  sendDetail: string | null;
  anchorState: ReviewAnchorState;
  staleReason: string | null;
}

interface CreateReviewNoteBody {
  basis: { baseRef: string; headSha?: string | null; scope: { kind: "commit"; sha: string } | { kind: "uncommitted" } };
  anchor: ReviewNoteView["anchor"];
  text: string;
}


/** EPIC-P37 / ADR-0056: Forge (GitLab) — PWA-Kopien der Contract-Typen. */
type ForgePipelineStatus = string;
interface ForgeMrRef { host: string; projectId: number; projectPath?: string; mrIid: number }
export interface ForgePipelineSummary { id: number; iid: number | null; status: ForgePipelineStatus; sha: string | null; ref: string; webUrl: string; createdAt: string | null }
export interface ForgeJobSummary { id: number; name: string; status: ForgePipelineStatus; stage: string; kind: "job" | "bridge"; downstreamPipelineId: number | null; allowFailure: boolean; webUrl: string }
interface ForgeThreadNote { author: string; body: string; system: boolean; createdAt: string | null }
export interface ForgeThread { id: string; resolved: boolean; notes: ForgeThreadNote[] }
export interface ForgeMrSummary { ref: ForgeMrRef; title: string; state: string; draft: boolean; sourceBranch: string; targetBranch: string; sha: string | null; webUrl: string; author: string; updatedAt: string | null }
export interface ForgeIssueSummary { host: string; projectId: number; iid: number; title: string; description: string; state: string; author: string; webUrl: string; labels: string[] }
interface ForgeLink { sessionId: string; mr: ForgeMrRef; lastSha: string | null; lastFetchedAt: string | null; createdAt: string }
export interface ForgeOperation { id: string; kind: "feedback_send" | "draft_mr"; state: "pending" | "done" | "failed" | "uncertain"; sha: string | null; pipelineId: number | null; jobId: number | null; detail: string | null; createdAt: string; updatedAt: string }
export interface ForgeTraceView { jobId: number; pipelineId: number | null; sha: string | null; fetchedAt: string; sizeBytes: number; truncated: boolean; preview: string }
export interface ForgeOverview {
  link: ForgeLink | null;
  sessionBranch: string | null;
  sessionHead: string | null;
  mr: ForgeMrSummary | null;
  pipelines: ForgePipelineSummary[];
  pipelineStaleError?: string | null;
  cachedAt: string | null;
  staleError: string | null;
  shaDrift: boolean;
  journalSkippedLines: number;
}
export interface DraftMrPlan { branch: string; commitsAhead: Array<{ sha: string; subject: string }>; pushNeeded: boolean; host: string; projectId: number | null; projectPath: string; targetBranch: string; suggestedTitle: string; sessionTitle: string | null }
interface DraftMrResult { ok: boolean; webUrl: string | null; detail: string | null; state: "pending" | "done" | "failed" | "uncertain" }

/** ADR-0017 — one host in the fleet overview. */
export interface FleetHost {
  hostId: string;
  /** Readable host name (own hostname / peer tailnet name). */
  label?: string;
  self: boolean;
  url: string | null;
  state: "reachable" | "stale" | "offline" | "incompatible" | "unauthorized";
  lastSyncAt: string | null;
  detail: string | null;
  sessions: number;
}

interface FleetOverview {
  self: string;
  hosts: FleetHost[];
  sessions: SessionRecord[];
}

/** ADR-0017 — a paired hub (never with its token). */
export interface FleetPeer {
  hostId: string;
  url: string;
  protocolVersion: number;
  pairedAt: string;
}

/** ADR-0015 — cross-session notification from the hub. */
export interface HubNotification {
  id: number;
  sessionId: string;
  level: "info" | "success" | "warning" | "error";
  title: string;
  detail: string | null;
  kind: string;
  createdAt: string;
  /** EPIC-P67 T67.6: optionaler Aktionsknopf (z. B. „Jetzt aktualisieren“ beim Main-Sync). */
  action?: { label: string; method: "POST"; path: string } | null;
  /** EPIC-P61 T61.7 / ADR-0101: Katalogschlüssel + Params für Hub-eigene Texte; title bleibt deutscher Fallback. */
  messageKey?: string | null;
  params?: Record<string, string | number> | null;
}

/** EPIC-P67 T67.7: Main-Sync-Einstellungen wie der Hub-Contract (ADR-0088 §1). */
export interface MainSyncSettingsDto {
  startSync: "off" | "fetch-base";
  fetchTimeoutSec: number;
  defaultBranch: string;
  checkIntervalMin: number;
  behindAction: "notify" | "ask" | "auto";
  autoMerge: "off" | "clean-only" | "ask";
  onlyWhenIdle: true;
}

/** EPIC-P67 T67.8: Messung + Probelauf einer Session (GET /api/sessions/:id/main-sync). */
export interface MainSyncCheckDto {
  sessionId: string;
  branch: string;
  behind: number;
  ahead: number;
  clean: boolean;
  conflicts: string[] | null;
  checkedAt: string;
  lastSyncedAt: string | null;
}

/** POST-Ergebnis des Anwendens (ADR-0088/0102): `autoResolved` nennt die
 * Dateien, deren Konflikte `favor-session` automatisch gelöst hat. */
export interface MainSyncApplyDto {
  outcome: "applied" | "conflict" | "skipped" | "failed";
  from?: string;
  to?: string;
  files?: string[];
  autoResolved?: string[];
  reason?: string;
  detail?: string;
}

/** ADR-0011 — one session found by the hub or a read-only provider scan. */
export interface DiscoveredSession {
  hubSessionId: string | null;
  project: string;
  adapter: string;
  status: string;
  controlMode: "observed" | "managed" | "controllable" | "mirror";
  harness: string;
  hostId: string;
  nativeSessionId: string | null;
  observedAt: string;
  unsupportedResume: boolean;
  fork: boolean;
  parentSessionId: string | null;
  /** ADR-0040: what it is about, what was said last, open in another harness right now. */
  title?: string | null;
  preview?: string | null;
  live?: boolean;
  /** ADR-0052: Worktree-Name (project ist das Hauptprojekt) und Rauschen unter /tmp. */
  worktree?: string | null;
  temporary?: boolean;
}

interface DiscoveryPage {
  items: DiscoveredSession[];
  nextCursor: number | null;
}

/** ADR-0012 — probed harness with its honest support cells. */
export interface HarnessInventoryEntry {
  id: string;
  harness: string;
  version: string | null;
  discovery: "verified" | "implemented-unverified" | "missing" | "blocked";
  resume: "verified" | "implemented-unverified" | "missing" | "blocked";
  evidence: string;
}

/** ADR-0018 — mirrors `@ancientvoid/contracts`'s HarnessFeatures. */
export type ToolGate = "native" | "sandbox" | "allowlist" | "bypass" | "none";
export interface HarnessFeatures {
  followUp: boolean;
  interrupt: boolean;
  toolGate: ToolGate;
  questions: boolean;
  modelChoice: "start" | "none";
  /** ADR-0033: model changeable after the start. Absent on older hubs. */
  modelSwitch?: boolean;
  /** ADR-0033: selectable permission modes, provider-specific names. */
  permissionModes?: readonly string[];
  skills: boolean;
  agents: boolean;
  images: boolean;
  files: boolean;
  contextFork: boolean;
}

export interface AdapterInfo {
  id: string;
  version: string;
  capabilities: { reasoning: boolean; tools: boolean; cost: boolean; steer: boolean; /** ADR-0085: Zustellung mitten im laufenden Zug zugesagt (Pi). */ midTurnInput?: boolean; /** ADR-0076: "live" = Eingaben laufen mitten im Zug durch. */ promptDelivery?: "live" | "next-turn"; usage: boolean; contextWindowTokens?: number | null; features: HarnessFeatures; /** ADR-0036: external continuation command; absent = none declared. */ resume?: { argv: string[]; ref: "native" | "token"; hub?: true; auto?: true }; /** ADR-0042: slash commands the harness provably executes when driven; absent/empty = none — show that honestly. */ commands?: readonly { name: string; description: string; scope: "start" | "steer" | "both" }[] };
  /** BUG-0061: server-side truth whether "Verbessern" has a one-shot
   * enhancer for this registration. Absent = older hub → the composer's
   * legacy id-set fallback decides. */
  enhance?: boolean;
}

export interface ModelOption {
  id: string;
  label?: string;
}

/** ADR-0060: Eintrag im Hub-Register eigener Modelle. */
export interface CustomModel {
  id: string;
  label?: string;
  adapters: string[];
}

export interface PiProviderBody {
  name: string;
  baseUrl: string;
  api: "openai-completions" | "anthropic-messages" | "google-generative-ai";
  apiKey?: string;
  models: { id: string; name?: string; contextWindow?: number; reasoning?: boolean }[];
  replace?: boolean;
}

/** Verbindungs-Registry (Optionen): VoidWarden-Instanzen und Modell-/Tool-Endpoints. */
export type EndpointKind = "llm" | "image" | "video" | "other";

export interface VoidWardenConnection {
  id: string;
  name: string;
  endpoint?: string;
  tokenLabel: string;
  createdAt: string;
  /** Letzte authentifizierte Anfrage des Instanz-Tokens an den Hub; null = noch nie gemeldet. */
  lastSeenAt: string | null;
}

interface EndpointProbeResult {
  at: string;
  ok: boolean;
  httpStatus: number | null;
  detail: string | null;
}

export interface EndpointEntry {
  id: string;
  name: string;
  kind: EndpointKind;
  baseUrl: string;
  hasKey: boolean;
  models: string[];
  createdAt: string;
  probe: EndpointProbeResult | null;
}

interface ConnectionsBody {
  voidwarden: VoidWardenConnection[];
  endpoints: EndpointEntry[];
  /** EPIC-P73 (ADR-0094): Forge-Token-Status — write-only, nie der Token selbst. */
  forge?: { github?: { tokenFile: string | null; present: boolean } };
}

/** ADR-0004 — account-level usage/quota window, e.g. claude's real
 * "five_hour"/"seven_day". `id` is a free string, not an enum. */
interface UsageWindow {
  id: string;
  utilization: number;
  resetsAt: string;
}

export interface UsageQuota {
  windows: UsageWindow[];
  overageAvailable?: boolean;
  overageBlockedReason?: string;
}

export interface AdapterUsage {
  adapterId: string;
  /** Adapter-type capability (ADR-0004) — false means "verified absent for
   * this adapter", never a guess. */
  supported: boolean;
  /** null: no observation yet (or unsupported) — never a stale/implied 0%. */
  quota: UsageQuota | null;
  observedAt: string | null;
}

/** T1.5-4 — a host-discovered git repo, offered as a session project. */
export interface DiscoveredProject {
  path: string;
  name: string;
  branch: string | null;
  /** BUG-0172: ohne Feld bzw. `isGit: false` ist es ein Ordner ohne `.git`. */
  isGit?: boolean;
}


interface ProjectDiscoveryResult {
  projects: DiscoveredProject[];
  warnings: string[];
  /** BUG-0173: trennt „Wurzeln fehlen“ von „Wurzeln vorhanden, aber keine Repos“. */
  rootsConfigured?: boolean;
  roots?: string[];
}

/** T1.5-10/ADR-0005 — a skill, agent, or workflow discovered in the target
 * project's `.claude/skills`, `.claude/agents`, or `.claude/workflows`.
 * Workflows have no adapter invocation (ADR-0005); the UI puts the name
 * in the prompt instead. */
export interface SkillOrAgent {
  kind: "skill" | "agent" | "workflow";
  name: string;
  description: string;
}

/** EPIC-P11 — mirrors `@ancientvoid/contracts`'s desktop types (ADR-0031). */
interface DesktopFocus {
  id: string;
  app: string;
  title: string;
  revision: number;
}
export interface CompanionState {
  name: string;
  backend: string;
  focus: DesktopFocus | null;
  locked: boolean;
  paused: boolean;
  blocked: string | null;
  version: string;
  lastSeen: string;
  online: boolean;
}
export interface DesktopAction {
  id: string;
  companion: string;
  kind: "insert" | "replace" | "key";
  inputMode: "keystroke" | "targeted-paste";
  key: string | null;
  textLength: number;
  target: { id: string; revision: number; app: string; title: string };
  status: "pending" | "delivered" | "running" | "done" | "failed" | "refused" | "cancelled" | "expired" | "uncertain";
  detail: string | null;
  typedChars: number;
  createdAt: string;
}

/** EPIC-P10.5 — mirrors `@ancientvoid/contracts`'s media types (ADR-0030). */
export type MediaStep = "fetch" | "probe" | "audio" | "frames" | "vision" | "merge" | "summarize";
interface MediaStepState {
  status: "pending" | "running" | "done" | "skipped" | "failed";
  startedAt: string | null;
  finishedAt: string | null;
  detail: string | null;
  via: string | null;
  progress: number | null;
}
export interface MediaJob {
  id: string;
  source: { kind: "url" | "file"; url: string | null; attachmentId: string | null; name: string | null };
  title: string | null;
  durationSec: number | null;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  steps: Record<MediaStep, MediaStepState>;
  allowCloud: boolean;
  language: string;
  egress: { step: MediaStep; service: string; own: boolean; at: string }[];
  createdAt: string;
  finishedAt: string | null;
  error: string | null;
  resultAttachmentId: string | null;
}
export interface MediaResult {
  jobId: string;
  title: string;
  url: string | null;
  durationSec: number;
  language: string | null;
  transcriptVia: string | null;
  transcript: { startMs: number; endMs: number; text: string }[];
  frames: { index: number; atMs: number; file: string; description: string | null; ocr: string | null; via: string | null }[];
  chapters: { startMs: number; title: string; summary: string }[];
  summary: string | null;
  keyPoints: string[];
  summaryVia: string | null;
  notes: string[];
}
export interface MediaInfo {
  available: boolean;
  tools: { ytDlp: boolean; ffmpeg: boolean };
  stt: boolean;
  summary: boolean;
  vision: boolean;
  gemini: boolean;
  limits: { maxBytes: number };
}

/** T7.10 — mirrors `@ancientvoid/contracts`'s AttachmentRecord. */
export interface AttachmentRecord {
  id: string;
  name: string;
  mimeType: string;
  bytes: number;
  kind: "image" | "pdf" | "office" | "text" | "audio" | "video" | "other";
  createdAt: string;
  extraction: { status: "pending" | "done" | "failed" | "none"; method: string | null; chars: number; error: string | null };
}

type SteerInput =
  | { kind: "prompt"; text: string; attachmentIds?: string[] }
  | { kind: "stop" }
  | { kind: "park" }
  | { kind: "resume" }
  | { kind: "configure"; model?: string; permissionMode?: string };

/** EPIC-P15 T15.4 */
export interface PcState {
  open: boolean;
  kind?: "interactive" | "background";
  name?: string | null;
  state?: string | null;
  nativeSessionId?: string;
}

/** EPIC-P15 T15.3: a prompt held back until the turn ends. */
/** EPIC-P21 T21.3: what comparable finished turns say about a running one. */
export interface RunEstimate {
  state: "no-data" | "too-few" | "ok";
  n: number;
  basis: "session" | "model" | "adapter" | "none";
  medianMs: number | null;
  p80Ms: number | null;
  tokensPerSec: number | null;
}

export interface QueuedPrompt {
  delivery?: QueueDeliveryState;
  id: string;
  text: string;
  createdAt: string;
  actor: string | null;
  attachments: number;
  /** ADR-0085: Stelle in der Reihe (niedrig = geht zuerst raus). Ein aelterer Hub
   *  liefert sie nicht — dann gilt die Ankunftsreihenfolge. */
  position?: number;
}

/** ADR-0085: nachtraegliche Aenderung an einer vorgemerkten Meldung. */
export interface QueuePatch {
  text?: string;
  move?: "front" | "back";
}

interface Ack {
  ok: boolean;
  detail?: string;
}

/** T1.5-8 — result of one prompt-enhance call. `costUsd` present only for
 * adapters that report a real cost (claude); never guessed for codex. */
interface EnhanceResult {
  enhanced: string;
  costUsd?: number;
  latencyMs: number;
  /** Absent on hubs before EPIC-P68. */
  engine?: RewriteEngine;
  skipped?: SkippedEngine[];
}

const TOKEN_KEY = "ancientvoid.token";

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? "";
}

export function setToken(token: string): void {
  // T8.2/AC-P8-4: another token is another person's device state — drafts
  // and cached views of the previous one must not show up.
  if (localStorage.getItem(TOKEN_KEY) !== token) {
    for (const key of Object.keys(localStorage)) if (key.startsWith("ancientvoid.draft.") || key.startsWith("ancientvoid.newSession") || key.startsWith("ancientvoid.tail.") || key.startsWith("ancientvoid.tailScroll.")) localStorage.removeItem(key);
    void caches?.delete?.("ancientvoid-api").catch(() => undefined);
  }
  localStorage.setItem(TOKEN_KEY, token);
}

/** T9: a plan for one text instruction (ADR-0027). */
interface PlanStep {
  op: string;
  args: Record<string, string | number | boolean | null>;
  target: string | null;
  risk: "read" | "write" | "destructive";
  runner: "client" | "hub";
  summary: string;
}

export interface CommandPlan {
  id: string;
  text: string;
  planner: "rules" | "model" | "none";
  steps: PlanStep[];
  question: { param: string; question: string; options: { value: string; label: string }[] } | null;
  refusal: string | null;
}

export interface StepResult {
  op: string;
  ok: boolean;
  detail: string;
  client?: Record<string, string | number | boolean | null>;
}

/** T8.3: Web Push state of this hub, subscriptions with delivery status. */
export interface PushState {
  enabled: boolean;
  publicKey: string | null;
  subscriptions: {
    id: number;
    device: string | null;
    service: string;
    createdAt: string;
    quiet: { from: number; to: number; tzOffsetMinutes: number } | null;
    done: boolean;
    lastOkAt: string | null;
    lastError: string | null;
    lastErrorAt: string | null;
    gone: boolean;
    mine: boolean;
  }[];
}

/** T8.4: a session's shared, revisioned draft (ADR-0025). */
export interface SessionDraft {
  sessionId: string;
  text: string;
  attachmentIds: string[];
  revision: number;
  updatedAt: string | null;
  device: string | null;
}

const CLIENT_KEY = "ancientvoid.clientId";

function randomId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** One id per device. The hub leases a session to the device that wrote
 * last, so phone and desktop cannot both start a turn (AC-P5-4). */
function clientId(): string {
  let id = localStorage.getItem(CLIENT_KEY);
  if (!id) {
    id = randomId();
    localStorage.setItem(CLIENT_KEY, id);
  }
  return id;
}

/** A fresh id for one send. A retry of the same send reuses it, so the
 * hub runs it once. */
export function newInputId(): string {
  return randomId();
}

/** Server ack details that mean "someone else holds the session". */
export function steerRejectText(detail: string | undefined): string {
  if (detail === "writer lease held") return "Ein anderes Gerät schreibt gerade in diese Session. Warten oder übernehmen.";
  if (detail === "revision conflict") return "Die Session hat sich inzwischen geändert. Bitte erneut senden.";
  return detail ?? "Antwort wurde abgelehnt";
}

export interface FileFeedbackItem {
  path: string;
  revision: string;
  startLine: number;
  endLine: number;
  note: string;
  diagnostic?: { code: string | null; message: string; source: string };
}

/**
 * K10: woher stammt eine Hub-Antwort? X-AncientVoid-Cached-At setzt der Service
 * Worker, wenn er offline die zuletzt gespeicherte Projektion ausliefert. Eine
 * erfolgreiche Antwort ohne den Marker ist live — auch dann, wenn vorher eine
 * gecachte kam (Netz kann an sein, während der Hub down war; das „online”-Event
 * des Browsers feuert in dem Fall nie, siehe BUG unten). Die UI zeigt/leert ihre
 * „Daten vom …”-Meldung nach genau diesen Events.
 */
export function announceDataFreshness(res: Response): void {
  const cachedAt = res.headers.get("X-AncientVoid-Cached-At");
  if (cachedAt) {
    document.dispatchEvent(new CustomEvent("ancientvoid:stale-data", { detail: cachedAt }));
  } else if (res.ok) {
    document.dispatchEvent(new CustomEvent("ancientvoid:fresh-data"));
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      // Fastify weist JSON-Content-Type mit leerem Body ab (400) — ein DELETE ohne Body darf ihn nicht tragen.
      ...(init?.body !== undefined && init.body !== null ? { "content-type": "application/json" } : {}),
      authorization: `Bearer ${getToken()}`,
      ...(init?.headers ?? {}),
    },
  });
  announceDataFreshness(res);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; detail?: string; code?: string };
    // EPIC-P61 / ADR-0101: strukturierter code -> Katalogschlüssel error.<code>;
    // unbekannter Code zeigt den Hub-Text unverändert.
    throw Object.assign(new Error(errorText(body.code, body.error ?? body.detail ?? `${res.status} ${res.statusText}`)), { status: res.status, code: body.code });
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** EPIC-P57 T57.9: eine entschiedene Freigabe zählt für das einmalige Erfolgssignal des Erststarts. */
function approvalDecided(r: ApprovalRequest): ApprovalRequest {
  noteApprovalDecided();
  return r;
}

/** T8.2: only a real 401/403 says the token is wrong — offline is not. */
export function isAuthError(err: unknown): boolean {
  const status = (err as { status?: unknown })?.status;
  return status === 401 || status === 403;
}

/** All hub calls. `P` maps a path to its host (ADR-0017 routing). */
/** ADR-0084: Was eine Session an Tokens **erzeugt** hat und was ihre Aufrufe
 * **verarbeitet** haben — zwei verschiedene Dinge (BUG-0184). null = niemand hat
 * es gemeldet, nicht „0“. */
export interface SessionTokenTotals {
  generated: number | null;
  processed: number | null;
  contextFill: number | null;
  cacheRead: number | null;
  usageEvents: number;
  estimated: boolean;
  lastSeq: number;
}

function createHubApi(P: (path: string) => string) {
  return {
  health: () => api<{ ok: boolean; serverTime: string; deployment?: DeploymentIdentity }>(P("/api/health")),
  /** EPIC-P59 (ADR-0078): Report der Metrik-Seite — REST, nicht EventBus (K5). */
  aimetrics: () => api<AiMetricsReport>(P("/api/aimetrics")),
  /** EPIC-P79 (ADR-0102): Token-Tempo der Inferenz-Engines (REST, gekappt — K5). */
  inferenceSources: () => api<InferenceSourceList>(P("/api/inference/sources")),
  inferenceSnapshot: (id: string, fensterH?: number) =>
    api<InferenceSnapshot>(P(`/api/inference/snapshot?id=${encodeURIComponent(id)}${fensterH ? `&fenster=${fensterH}` : ""}`)),
  /** BUG-0258: manuell gebundenes Inferenz-Modell — Status, Anbindung, Frage (REST, gekappt). */
  inferenceModelStatus: () => api<InferenceModelStatus>(P("/api/settings/inference")),
  inferenceModelSet: (patch: { url?: string | null; model?: string | null; apiKeyFile?: string | null }) =>
    api<{ inference: InferenceModelView }>(P("/api/settings/inference"), { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) }),
  inferenceAsk: (text: string) => api<InferenceAskResult>(P("/api/inference/ask"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) }),
  /** EPIC-P56 T56.3: Statistik-Report mit Schnitt-Query (leere Objekte-teile bleiben weg). */
  statistics: (query: { project?: string; host?: string; harness?: string; since?: string; until?: string } = {}) => {
    const qs = Object.entries(query).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join("&");
    return api<StatisticsReport>(P(`/api/statistics${qs ? `?${qs}` : ""}`));
  },
  adapters: () => api<AdapterInfo[]>(P("/api/adapters")),
  /** EPIC-P19: Loops / Dark Factories und ob sie startbar sind. */
  loops: () => api<LoopInfo[]>(P("/api/loops")),
  /** EPIC-P19: ein Repo für einen Loop einrichten. Das Geheimnis geht nur in diesen einen Aufruf; abgelehnt = `ok: false` mit Grund. */
  onboardLoop: async (id: string, body: { options: Record<string, string>; secret?: string }): Promise<LoopOnboardResult> => {
    const res = await fetch(P(`/api/loops/${encodeURIComponent(id)}/onboard`), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${getToken()}` },
      body: JSON.stringify(body),
    });
    const out = (await res.json().catch(() => null)) as { ok?: unknown; error?: string } | null;
    if (out && typeof out.ok === "boolean") return out as LoopOnboardResult;
    return { ok: false, detail: out?.error ?? `${res.status} ${res.statusText}` };
  },
  /** T7.10: a file into the hub — raw bytes, name in a header. */
  uploadAttachment: async (file: File): Promise<AttachmentRecord> => {
    const res = await fetch(P("/api/attachments"), {
      method: "POST",
      headers: { "content-type": file.type || "application/octet-stream", "x-filename": encodeURIComponent(file.name), authorization: `Bearer ${getToken()}` },
      body: file,
    });
    const body = (await res.json().catch(() => ({}))) as AttachmentRecord & { error?: string };
    if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
    return body;
  },
  attachment: (id: string) => api<AttachmentRecord>(P(`/api/attachments/${id}`)),
  attachmentText: (id: string) => api<{ extraction: AttachmentRecord["extraction"]; text: string | null }>(P(`/api/attachments/${id}/text`)),
  /** The file itself as an object URL — the token stays in a header, never in a URL. */
  attachmentUrl: async (id: string): Promise<string> => {
    const res = await fetch(P(`/api/attachments/${id}/content`), { headers: { authorization: `Bearer ${getToken()}` } });
    if (!res.ok) throw new Error(`${res.status}`);
    return URL.createObjectURL(await res.blob());
  },
  reextractAttachment: (id: string) => api<AttachmentRecord>(P(`/api/attachments/${id}/extract`), { method: "POST", body: "{}" }),
  settings: () => api<{ gemini: { configured: boolean; model: string } }>(P("/api/settings")),
  setGemini: (body: { apiKey?: string | null; model?: string }) =>
    api<{ gemini: { configured: boolean; model: string } }>(P("/api/settings/gemini"), { method: "PUT", body: JSON.stringify(body) }),
  /** ADR-0018: null when the adapter has no catalog (free text then);
   * defaultModel is the registration's configured model. */
  adapterModels: (id: string) => api<{ models: ModelOption[] | null; defaultModel: string | null; customIds?: string[] }>(P(`/api/adapters/${encodeURIComponent(id)}/models`)),
  /** ADR-0060: eigene Modelle (Hub-Register) und Endpunkte (pi). */
  customModels: () => api<{ items: CustomModel[] }>(P("/api/models/custom")),
  addCustomModel: (body: { id: string; label?: string; adapters: string[] }) => api<{ ok: boolean; model: CustomModel }>(P("/api/models/custom"), { method: "POST", body: JSON.stringify(body) }),
  removeCustomModel: (id: string) => api<{ ok: boolean }>(P(`/api/models/custom?id=${encodeURIComponent(id)}`), { method: "DELETE" }),
  addPiProvider: (adapterId: string, body: PiProviderBody) =>
    api<{ ok: boolean; created: boolean; backup: string | null }>(P(`/api/adapters/${encodeURIComponent(adapterId)}/provider`), { method: "POST", body: JSON.stringify(body) }),
  /** Verbindungs-Registry: VoidWarden-Instanzen (Token einmalig sichtbar) und Endpoints (Schlüssel write-only). */
  connections: () => api<ConnectionsBody>(P("/api/connections")),
  /** EPIC-P73 (ADR-0094): GitHub-Token eintragen — schreibt die konfigurierte
   * Token-Datei (erste Zeile, 0600); Lesen geht bewusst nicht. */
  connectionSetGitHubToken: (token: string) =>
    api<{ ok: true; tokenFile: string; present: boolean }>(P("/api/connections/forge/github"), { method: "PUT", body: JSON.stringify({ token }) }),
  addVoidWarden: (body: { name: string; endpoint?: string }) =>
    api<{ connection: VoidWardenConnection; token: string }>(P("/api/connections/voidwarden"), { method: "POST", body: JSON.stringify(body) }),
  updateVoidWarden: (id: string, body: { name: string; endpoint?: string; rotate?: boolean }) =>
    api<{ connection: VoidWardenConnection; token?: string }>(P(`/api/connections/voidwarden/${id}`), { method: "PUT", body: JSON.stringify(body) }),
  removeVoidWarden: (id: string) => api<{ ok: boolean }>(P(`/api/connections/voidwarden/${id}`), { method: "DELETE", body: "{}" }),
  addEndpoint: (body: { name: string; kind: EndpointKind; baseUrl: string; apiKey?: string | null; models: string[] }) =>
    api<{ endpoint: EndpointEntry }>(P("/api/connections/endpoints"), { method: "POST", body: JSON.stringify(body) }),
  updateEndpoint: (id: string, body: { name: string; kind: EndpointKind; baseUrl: string; apiKey?: string | null; models: string[] }) =>
    api<{ endpoint: EndpointEntry }>(P(`/api/connections/endpoints/${id}`), { method: "PUT", body: JSON.stringify(body) }),
  removeEndpoint: (id: string) => api<{ ok: boolean }>(P(`/api/connections/endpoints/${id}`), { method: "DELETE", body: "{}" }),
  probeEndpoint: (id: string) => api<{ endpoint: EndpointEntry }>(P(`/api/connections/endpoints/${id}/probe`), { method: "POST", body: "{}" }),
  /** EPIC-P74 (ADR-0096): Wissensquellen — Fehler kommen als 502, der Status steht danach in der Liste. */
  knowledgeSources: () => api<{ sources: KnowledgeSourceView[] }>(P("/api/knowledge/sources")),
  addKnowledgeSource: (body: KnowledgeSourceInputRaw) =>
    api<{ source: KnowledgeSourceView }>(P("/api/knowledge/sources"), { method: "POST", body: JSON.stringify(body) }),
  updateKnowledgeSource: (id: string, body: KnowledgeSourceInputRaw) =>
    api<{ source: KnowledgeSourceView }>(P(`/api/knowledge/sources/${id}`), { method: "PUT", body: JSON.stringify(body) }),
  removeKnowledgeSource: (id: string) => api<{ ok: boolean }>(P(`/api/knowledge/sources/${id}`), { method: "DELETE", body: "{}" }),
  probeKnowledgeSource: (id: string) =>
    api<{ source: KnowledgeSourceView; overview: KnowledgeOverview }>(P(`/api/knowledge/sources/${id}/probe`), { method: "POST", body: "{}" }),
  /** T74.6: Suchen mit sichtbaren Retrieval-Parametern (EPIC-134 — nie hardcoded). */
  searchKnowledge: (id: string, query: { q: string; topK?: number; fusion?: "sequential" | "rrf"; minScore?: number }) =>
    api<{ source: KnowledgeSourceView; result: KnowledgeSearchResult }>(P(`/api/knowledge/sources/${id}/search`), { method: "POST", body: JSON.stringify(query) }),
  readKnowledge: (id: string, ref: string) =>
    api<{ source: KnowledgeSourceView; document: KnowledgeReadResult & { truncated: boolean } }>(P(`/api/knowledge/sources/${id}/read`), { method: "POST", body: JSON.stringify({ ref }) }),
  graphKnowledge: (id: string, seed: string) =>
    api<{ source: KnowledgeSourceView; graph: { nodes: { ref: string; title?: string }[]; edges: { from: string; to: string; kind?: string }[]; truncated: boolean } }>(
      P(`/api/knowledge/sources/${id}/graph`),
      { method: "POST", body: JSON.stringify({ seed }) },
    ),
  /** T74.6: Schreiben geht nur als Freigabe — 202 mit approvalId, entschieden wird in der Queue. */
  addKnowledge: (id: string, body: { text: string; ref?: string }) =>
    api<{ ok: boolean; detail: string; approvalId: string; summary: string }>(P(`/api/knowledge/sources/${id}/add`), { method: "POST", body: JSON.stringify(body) }),
  adapterUsage: (id: string) => api<AdapterUsage>(P(`/api/adapters/${id}/usage`)),
  projects: () => api<ProjectDiscoveryResult>(P("/api/projects")),
  /** T-PJ1: create a project (git init) in the first projectRoot. */
  createProject: (name: string) =>
    api<{ ok: boolean; created: boolean; project: DiscoveredProject }>(P("/api/projects"), { method: "POST", body: JSON.stringify({ name }) }),
  skills: (project: string) => api<{ items: SkillOrAgent[] }>(P(`/api/skills?project=${encodeURIComponent(project)}`)),
  recommendPrompt: (project: string, text: string) =>
    api<PromptRecommendation | null>(P("/api/prompt-recommendation"), { method: "POST", body: JSON.stringify({ project, text }) }),
  saveArtifact: (body: { project: string; kind: PromptRecommendation["kind"]; name: string; description: string; draft: string }) =>
    api<{ path: string }>(P("/api/skills"), { method: "POST", body: JSON.stringify(body) }),
  skillArtifact: (project: string, kind: PromptRecommendation["kind"], name: string) =>
    api<SkillArtifact>(P(`/api/skills/artifact?project=${encodeURIComponent(project)}&kind=${kind}&name=${encodeURIComponent(name)}`)),
  updateArtifact: (body: { project: string; kind: PromptRecommendation["kind"]; name: string; draft: string; baseHash: string }) =>
    api<{ path: string; hash: string }>(P("/api/skills"), { method: "PUT", body: JSON.stringify(body) }),
  reviseArtifact: (body: { project: string; kind: PromptRecommendation["kind"]; name: string; prompt: string; adapter: string }) =>
    api<{ draft: string; baseHash: string; engine: RewriteEngine; skipped: SkippedEngine[]; costUsd?: number; latencyMs: number }>(P("/api/skills/revise"), {
      method: "POST",
      body: JSON.stringify(body),
    }),
  enhancePrompt: (adapter: string, project: string, text: string) =>
    api<EnhanceResult>(P("/api/prompt-enhance"), { method: "POST", body: JSON.stringify({ adapter, project, text }) }),
  /** T3.9 (Learning-Loop, lokal, "niemals Cloud, niemals Telemetrie"): one
   * call per shown optimizer suggestion, whichever way the user decides.
   * 501 (no dataDir configured) is swallowed by the caller — this is a
   * best-effort local log, never something a user's send action should
   * wait on or fail over. */
  recordOptimizerFeedback: (entry: {
    adapter: string;
    project: string;
    original: string;
    enhanced: string;
    decision: "accepted" | "rejected";
    costUsd?: number;
    latencyMs: number;
    engine?: string;
  }) => api<{ ok: boolean }>(P("/api/prompt-optimizer/feedback"), { method: "POST", body: JSON.stringify(entry) }),
  sessions: () => api<SessionRecord[]>(P("/api/sessions")),
  session: (id: string) => api<SessionRecord>(P(`/api/sessions/${id}`)),
  discovery: (cursor = 0, limit = 50, filter: { q?: string; adapter?: string } = {}) =>
    api<DiscoveryPage>(P(`/api/discovery?cursor=${cursor}&limit=${limit}${filter.q ? `&q=${encodeURIComponent(filter.q)}` : ""}${filter.adapter ? `&adapter=${encodeURIComponent(filter.adapter)}` : ""}`)),
  inventory: () => api<{ items: HarnessInventoryEntry[] }>(P("/api/inventory")),
  fleet: () => api<FleetOverview>(P("/api/fleet")),
  fleetHello: () => api<{ hostId: string; protocolVersion: number }>(P("/api/fleet/hello")),
  fleetInvite: () => api<{ code: string; expiresAt: string }>(P("/api/fleet/invites"), { method: "POST", body: "{}" }),
  fleetPeers: () => api<FleetPeer[]>(P("/api/fleet/peers")),
  fleetAddPeer: (url: string, code: string) =>
    api<FleetPeer>(P("/api/fleet/peers"), { method: "POST", body: JSON.stringify({ url, code }) }),
  // Body "{}": Fastify rejects an empty body with a JSON content type (BUG-0011).
  fleetRemovePeer: (hostId: string) =>
    api<{ ok: boolean }>(P(`/api/fleet/peers/${encodeURIComponent(hostId)}`), { method: "DELETE", body: "{}" }),
  // BUG-0222: limit=200 (Route-Kappgrenze) — nach Hintergrund-Drossel des
  // Browsers darf ein Rückstand nicht am 50er-Fenster vorbeilaufen.
  notifications: (after = 0) => api<{ items: HubNotification[]; lastId: number }>(P(`/api/notifications?after=${after}&limit=200`)),
  /** EPIC-P67 T67.6: Aktionsknopf einer Benachrichtigung — ruft genau den
   * mitgelieferten Hub-Pfad (gleicher Endpunkt wie das Session-Menü). */
  runNotificationAction: (path: string) =>
    api<{ outcome: string; reason?: string; detail?: string }>(P(path), { method: "POST", body: "{}" }),
  /** EPIC-P67 T67.7: Main-Sync-Einstellungen — global + Projekt-Overrides. */
  mainSyncSettings: () =>
    api<{ global: { value: MainSyncSettingsDto; fallback: string }; projects: { value: Record<string, Partial<MainSyncSettingsDto>>; fallback: string } }>(P("/api/settings/main-sync")),
  saveMainSyncSettings: (body: { global: MainSyncSettingsDto; projects: Record<string, Partial<MainSyncSettingsDto>> }) =>
    api<{ global: { value: MainSyncSettingsDto; fallback: string }; projects: { value: Record<string, Partial<MainSyncSettingsDto>>; fallback: string } }>(P("/api/settings/main-sync"), {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  /** EPIC-P67 T67.8: Messung + Probelauf je Session (K10-Stand: lastSyncedAt offline lesbar). */
  mainSyncCheck: (sessionId: string) =>
    api<MainSyncCheckDto>(P(`/api/sessions/${encodeURIComponent(sessionId)}/main-sync`)),
  /** ADR-0102: `conflictStrategy: "favor-session"` löst Konflikte gunsten der Session; Default bleibt abort. */
  mainSyncApply: (sessionId: string, opts: { conflictStrategy?: "abort" | "favor-session" } = {}) =>
    api<MainSyncApplyDto>(P(`/api/sessions/${encodeURIComponent(sessionId)}/main-sync`), { method: "POST", body: JSON.stringify(opts) }),
  sessionDiff: (id: string) => api<SessionDiffResult>(P(`/api/sessions/${id}/diff`)),
  /** EPIC-P36: Review-Notizen zur Diff-Ansicht (ADR-0055). */
  /** EPIC-P37: Forge (GitLab) im Session-Kontext. */
  forgeOverview: (id: string) => api<ForgeOverview>(P(`/api/sessions/${id}/forge/overview`)),
  forgeLink: (id: string, url: string) =>
    api<{ link: ForgeLink }>(P(`/api/sessions/${id}/forge/link`), { method: "POST", body: JSON.stringify({ url }) }),
  forgeUnlink: (id: string) => api<{ ok: boolean }>(P(`/api/sessions/${id}/forge/link`), { method: "DELETE", body: "{}" }),
  forgeJobs: (id: string, pipelineId: number) =>
    api<{ items: ForgeJobSummary[]; cachedAt: string; staleError: string | null }>(P(`/api/sessions/${id}/forge/jobs?pipelineId=${pipelineId}`)),
  forgeThreads: (id: string) =>
    api<{ items: ForgeThread[]; truncated: boolean; cachedAt: string; staleError: string | null }>(P(`/api/sessions/${id}/forge/threads`)),
  forgeTrace: (id: string, jobId: number, pipelineId: number | null) =>
    api<ForgeTraceView>(P(`/api/sessions/${id}/forge/trace?jobId=${jobId}${pipelineId !== null ? `&pipelineId=${pipelineId}` : ""}`)),
  forgeIssues: (id: string) =>
    api<{ host: string; projectId: number; items: ForgeIssueSummary[]; truncated: boolean; cachedAt: string; staleError: string | null }>(P(`/api/sessions/${id}/forge/issues`)),
  forgeFeedbackPreview: (id: string, body: { finding: string; pipelineId?: number; jobId?: number; threadId?: string }) =>
    api<{ prompt: string }>(P(`/api/sessions/${id}/forge/feedback/preview`), { method: "POST", body: JSON.stringify(body) }),
  forgeFeedbackSend: (id: string, body: { operationId: string; finding: string; pipelineId?: number; jobId?: number; threadId?: string }) =>
    api<{ ok: boolean; prompt?: string; detail?: string }>(P(`/api/sessions/${id}/forge/feedback`), { method: "POST", body: JSON.stringify(body) }),
  forgeMrPlan: (id: string) => api<DraftMrPlan>(P(`/api/sessions/${id}/forge/mr/plan`), { method: "POST", body: "{}" }),
  forgeMrCreate: (id: string, body: { operationId: string; title: string; description: string; targetBranch: string; push: boolean }) =>
    api<DraftMrResult>(P(`/api/sessions/${id}/forge/mr/create`), { method: "POST", body: JSON.stringify(body) }),
  forgeOperations: (id: string) =>
    api<{ items: ForgeOperation[]; journalSkippedLines: number }>(P(`/api/sessions/${id}/forge/operations`)),
  sessionReviews: (id: string) => api<{ items: ReviewNoteView[]; journalSkippedLines: number }>(P(`/api/sessions/${id}/reviews`)),
  createReviewNote: (id: string, body: CreateReviewNoteBody) =>
    api<{ note: ReviewNoteView }>(P(`/api/sessions/${id}/reviews`), { method: "POST", body: JSON.stringify(body) }),
  updateReviewNote: (id: string, noteId: string, text: string) =>
    api<{ note: ReviewNoteView }>(P(`/api/sessions/${id}/reviews/${noteId}`), { method: "PATCH", body: JSON.stringify({ text }) }),
  deleteReviewNote: (id: string, noteId: string) =>
    api<{ ok: boolean }>(P(`/api/sessions/${id}/reviews/${noteId}`), { method: "DELETE", body: "{}" }),
  setReviewNoteStatus: (id: string, noteId: string, status: ReviewNoteStatus) =>
    api<{ note: ReviewNoteView }>(P(`/api/sessions/${id}/reviews/${noteId}/status`), { method: "POST", body: JSON.stringify({ status }) }),
  /** Vorschau des gebündelten Prompts — derselbe Code, der später versendet. */
  previewReviewFeedback: (id: string, noteIds: string[]) =>
    api<{ prompt: string; needsAttachment: boolean }>(P(`/api/sessions/${id}/reviews/preview`), { method: "POST", body: JSON.stringify({ noteIds }) }),
  sendReviewFeedback: async (id: string, body: { noteIds: string[]; targetSessionId?: string; operationId: string }): Promise<{ ok: boolean; detail?: string; prompt?: string }> => {
    const res = await fetch(P(`/api/sessions/${id}/reviews/send`), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${getToken()}` },
      body: JSON.stringify(body),
    });
    const parsed = (await res.json().catch(() => ({}))) as { ok?: boolean; detail?: string; prompt?: string };
    if (typeof parsed.ok === "boolean" && parsed.ok) return { ok: true, prompt: parsed.prompt };
    return { ok: false, detail: parsed.detail ?? `${res.status} ${res.statusText}` };
  },
  /** T3.8: real qmd-backed project search. A 501 (qmd not installed on
   * this host) is a real, expected state for a fresh/minimal deployment —
   * callers show it as "Suche nicht verfügbar", not a hard error. */
  searchStatus: (project: string) => api<SearchStatus>(P(`/api/search/status?project=${encodeURIComponent(project)}`)),
  search: (project: string, q: string) =>
    api<SearchResponse>(P(`/api/search?project=${encodeURIComponent(project)}&q=${encodeURIComponent(q)}`)),
  searchFile: (project: string, path: string) =>
    api<ProjectFile>(P(`/api/search/file?project=${encodeURIComponent(project)}&path=${encodeURIComponent(path)}`)),
  searchDocs: (project: string) => api<{ docs: ProjectDoc[] }>(P(`/api/search/docs?project=${encodeURIComponent(project)}`)),
  /** Suche (Nachschärfe 2026-11-22): ein Feld, beide Körper — die Sessiontexte
   * (Fragen, Antworten, Denk- und Werkzeugspuren) plus die Projekt-Doku. */
  searchAll: (input: SearchInput) => api<UnifiedSearchResponse>(P(`/api/search/all?${searchQuery(input)}`)),
  /** Nur die Sitzungstexte — für Scope-Umschalten ohne die Doku erneut zu befragen. */
  searchTranscript: (input: SearchInput) => api<SessionTextSearchResponse>(P(`/api/search/transcript?${searchQuery(input)}`)),
  /** T2.4/T2.6: the approval queue. 501 (approvals not configured on this
   * hub) is treated as "no queue" by callers, not a hard error — see
   * Approvals.tsx. */
  approvals: (status?: ApprovalStatus) =>
    api<ApprovalRequest[]>(P(`/api/approvals${status ? `?status=${status}` : ""}`)),
  /** T2.7: request a higher budget for a parked-for-budget session.
   * Applied immediately (200) if this hub has no approvals configured,
   * otherwise parked pending a write-class approval (422, same
   * ack.ok===false shape as /steer). */
  requestBudgetTopUp: (id: string, budgetUsd: number, reason?: string) =>
    api<{ ok: boolean; detail?: string }>(P(`/api/sessions/${id}/budget`), {
      method: "POST",
      body: JSON.stringify({ budgetUsd, ...(reason ? { reason } : {}) }),
    }),
  decideApproval: (id: string, decision: "approve" | "reject", reason?: string, answers?: Record<string, string>) =>
    api<ApprovalRequest>(P(`/api/approvals/${id}/decide`), {
      method: "POST",
      body: JSON.stringify({ decision, ...(reason ? { reason } : {}), ...(answers ? { answers } : {}) }),
    }).then(approvalDecided),
  /** T2.5: WebAuthn passkey registration + the biometric decide path for
   * `destructive` approvals. 501 (webauthn not configured) is a real,
   * common state — same "feature genuinely absent" handling as the
   * approval queue's own 501. */
  webauthnStatus: () => api<{ registered: boolean }>(P("/api/webauthn/status")),
  // Fastify's JSON body parser rejects a POST with the JSON content-type
  // header (set unconditionally by api() below) but a truly empty body —
  // real bug found live-testing this against the actual server — so
  // these two no-payload POSTs send an explicit empty object instead.
  webauthnRegisterOptions: () => api<unknown>(P("/api/webauthn/register/options"), { method: "POST", body: "{}" }),
  webauthnRegisterVerify: (response: unknown) =>
    api<{ ok: boolean }>(P("/api/webauthn/register/verify"), { method: "POST", body: JSON.stringify(response) }),
  webauthnAssertOptions: (approvalId: string) =>
    api<unknown>(P(`/api/approvals/${approvalId}/webauthn/assert-options`), { method: "POST", body: "{}" }),
  decideApprovalBiometric: (approvalId: string, decision: "approve" | "reject", response: unknown, reason?: string) =>
    api<ApprovalRequest>(P(`/api/approvals/${approvalId}/webauthn/decide`), {
      method: "POST",
      body: JSON.stringify({ decision, response, ...(reason ? { reason } : {}) }),
    }).then(approvalDecided),
  /** T2.2 expand-on-tap: full hunks for one file, after /diff collapsed them under K3. */
  /** T7.6: local code search and viewer in the session's worktree. */
  codeSearch: (sessionId: string, q: string, mode: "text" | "symbol") =>
    api<CodeSearchResult>(P(`/api/code/search?session=${encodeURIComponent(sessionId)}&q=${encodeURIComponent(q)}&mode=${mode}`)),
  codeFile: (sessionId: string, path: string) =>
    api<CodeFile>(P(`/api/code/file?session=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}`)),
  /** BUG-0191: Blob @ Commit (`target` = `session=`/`project=`). */
  codeFileAt: (target: string, path: string, sha: string) =>
    api<CodeFile>(P(`/api/code/file?${target}&path=${encodeURIComponent(path)}&sha=${encodeURIComponent(sha)}`)),
  /** EPIC-P46 (ADR-0058): Explorer. `target` = `session=<id>` oder `project=<pfad>`. */
  codeTree: (target: string, path: string, offset = 0, ignored = false) =>
    api<TreeListing>(P(`/api/code/tree?${target}&path=${encodeURIComponent(path)}&offset=${offset}${ignored ? "&ignored=1" : ""}`)),
  codeMeta: (target: string, path: string) => api<FileMeta>(P(`/api/code/meta?${target}&path=${encodeURIComponent(path)}`)),
  codeRange: (target: string, path: string, opts: { offset: number; length?: number; rev: string; as: "text" | "bytes"; encoding?: string }) =>
    api<FileRange>(
      P(`/api/code/range?${target}&path=${encodeURIComponent(path)}&offset=${opts.offset}${opts.length ? `&length=${opts.length}` : ""}&rev=${opts.rev}&as=${opts.as}${opts.encoding ? `&encoding=${opts.encoding}` : ""}`),
    ),
  /** EPIC-P39 (ADR-0059): Browser-Arbeitsplatz einer Session (lokal auf dem Host der Session). */
  browserStatus: (id: string) => api<BrowserStatus>(P(`/api/sessions/${id}/browser`)),
  browserOpen: (id: string, url?: string) => api<BrowserStatus>(P(`/api/sessions/${id}/browser/open`), { method: "POST", body: JSON.stringify(url ? { url } : {}) }),
  browserAction: (id: string, action: BrowserAction) => api<BrowserStatus>(P(`/api/sessions/${id}/browser/action`), { method: "POST", body: JSON.stringify({ action }) }),
  browserClose: (id: string) => api<BrowserStatus>(P(`/api/sessions/${id}/browser/close`), { method: "POST", body: "{}" }),
  /** Standbild als Object-URL (Token im Header); `null` = Browser nicht offen. */
  browserFrame: async (id: string): Promise<string | null> => {
    const res = await fetch(P(`/api/sessions/${id}/browser/frame`), { headers: { authorization: `Bearer ${getToken()}` }, cache: "no-store" });
    if (res.status === 204) return null;
    if (!res.ok) throw new Error(`${res.status}`);
    return URL.createObjectURL(await res.blob());
  },
  browserBlobUrl: async (path: string): Promise<string> => {
    const res = await fetch(P(path), { headers: { authorization: `Bearer ${getToken()}` } });
    if (!res.ok) throw new Error(`${res.status}`);
    return URL.createObjectURL(await res.blob());
  },
  browserTests: (id: string) => api<{ runs: BrowserTestRun[] }>(P(`/api/sessions/${id}/browser/tests`)),
  browserRunTest: (id: string, test: BrowserTestCase) => api<BrowserTestRun>(P(`/api/sessions/${id}/browser/tests`), { method: "POST", body: JSON.stringify({ test }) }),
  browserAbortTest: (id: string, runId: string) => api<{ ok: boolean }>(P(`/api/sessions/${id}/browser/tests/${runId}/abort`), { method: "POST", body: "{}" }),
  browserPick: (id: string, x: number, y: number) => api<BrowserPick>(P(`/api/sessions/${id}/browser/pick`), { method: "POST", body: JSON.stringify({ x, y }) }),
  browserFeedbackPreview: (id: string, input: BrowserFeedbackInput) => api<{ prompt: string; screenshot: boolean }>(P(`/api/sessions/${id}/browser/feedback/preview`), { method: "POST", body: JSON.stringify(input) }),
  browserFeedbackSend: (id: string, input: BrowserFeedbackInput) => api<{ ok: boolean }>(P(`/api/sessions/${id}/browser/feedback/send`), { method: "POST", body: JSON.stringify(input) }),
  /** EPIC-P42 (ADR-0067): Android-Testgeräte (host-lokal; Frames/Logs/Bäume sind Bytes mit Grenzen). */
  devicesStatus: () => api<DeviceStatus>(P("/api/devices")),
  deviceStart: (avd: string, sessionId: string | null) => api<unknown>(P("/api/devices/start"), { method: "POST", body: JSON.stringify({ avd, ...(sessionId ? { sessionId } : {}) }) }),
  deviceStop: (serial: string) => api<{ serial: string; stopped: boolean }>(P("/api/devices/stop"), { method: "POST", body: JSON.stringify({ serial }) }),
  deviceLease: (serial: string, sessionId: string | null) => api<{ serial: string; generation: number }>(P("/api/devices/lease"), { method: "POST", body: JSON.stringify({ serial, ...(sessionId ? { sessionId } : {}) }) }),
  deviceRelease: (serial: string, generation: number) => api<{ serial: string; released: boolean }>(P("/api/devices/release"), { method: "POST", body: JSON.stringify({ serial, generation }) }),
  deviceAction: (serial: string, generation: number, geometryVersion: number, action: DeviceAction) =>
    api<{ serial: string; geometryVersion: number; seq: number }>(P("/api/devices/action"), { method: "POST", body: JSON.stringify({ serial, generation, geometryVersion, action }) }),
  /** Standbild mit Geometrie-Metadaten aus den Headern (x-geometry, x-frame-seq, x-frame-width/height). */
  deviceFrame: async (serial: string): Promise<{ url: string; seq: number; geometryVersion: number; width: number; height: number } | null> => {
    const res = await fetch(P(`/api/devices/${encodeURIComponent(serial)}/frame`), { headers: { authorization: `Bearer ${getToken()}` }, cache: "no-store" });
    if (res.status === 204) return null;
    if (!res.ok) throw new Error(`${res.status}`);
    return {
      url: URL.createObjectURL(await res.blob()),
      seq: Number(res.headers.get("x-frame-seq") ?? "0"),
      geometryVersion: Number(res.headers.get("x-geometry") ?? "0"),
      width: Number(res.headers.get("x-frame-width") ?? "0"),
      height: Number(res.headers.get("x-frame-height") ?? "0"),
    };
  },
  deviceLogs: (serial: string, bytes?: number) => api<{ text: string; truncated: boolean; at: string }>(P(`/api/devices/${encodeURIComponent(serial)}/logs${bytes ? `?bytes=${bytes}` : ""}`)),
  deviceTree: async (serial: string): Promise<string> => {
    const res = await fetch(P(`/api/devices/${encodeURIComponent(serial)}/tree`), { headers: { authorization: `Bearer ${getToken()}` } });
    if (!res.ok) throw new Error(`${res.status}`);
    return res.text();
  },
  deviceInstall: (serial: string, generation: number, attachmentId: string) =>
    api<{ serial: string; sha256: string; detail: string }>(P("/api/devices/install"), { method: "POST", body: JSON.stringify({ serial, generation, attachmentId }) }),
  deviceTests: (serial: string) => api<{ runs: DeviceTestRun[] }>(P(`/api/devices/tests?serial=${encodeURIComponent(serial)}`)),
  deviceRunTest: (test: DeviceTestCase) => api<DeviceTestRun>(P("/api/devices/tests"), { method: "POST", body: JSON.stringify({ test }) }),
  deviceAbortTest: (serial: string, runId: string) => api<{ ok: boolean }>(P(`/api/devices/tests/${runId}/abort`), { method: "POST", body: JSON.stringify({ serial }) }),
  /** Byte-Offset des Anfangs von Zeile `line` (Revision-gebunden). */
  codeLine: (target: string, path: string, line: number, rev: string) =>
    api<{ revision: string; offset: number; line: number }>(P(`/api/code/line?${target}&path=${encodeURIComponent(path)}&line=${line}&rev=${rev}`)),
  /** Nächster Treffer ab Byte-Offset, hostseitig über die ganze Datei. */
  codeFind: (target: string, path: string, q: string, from: number, rev: string, cs: boolean) =>
    api<{ found: boolean; revision: string; lineOffset?: number; line?: number; column?: number; length?: number; scannedBytes?: number }>(
      P(`/api/code/find?${target}&path=${encodeURIComponent(path)}&q=${encodeURIComponent(q)}&from=${from}&rev=${rev}${cs ? "&cs=1" : ""}`),
    ),
  codeArchive: (target: string, path: string) =>
    api<{ revision: string; entries: { name: string; size: number; compressedSize: number; directory: boolean; encrypted: boolean }[]; total: number; truncated: boolean }>(
      P(`/api/code/archive?${target}&path=${encodeURIComponent(path)}`),
    ),
  codeOffice: (target: string, path: string) =>
    api<{ revision: string; sections: { title: string; text: string }[]; note: string }>(P(`/api/code/office?${target}&path=${encodeURIComponent(path)}`)),
  /** EPIC-P48 (ADR-0062): Repo-Graph und Diagnose-Überlagerung; `target` wie Code-Routen. */
  graph: (target: string) => api<GraphReport>(P(`/api/graph?${target}`)),
  graphDiagnose: (target: string) => api<GraphDiagnosis>(P(`/api/graph/diagnose?${target}`), { method: "POST", body: "{}" }),
  /** ADR-0071: Commit-DAG mit Branches/Parents/Dateien. */
  gitGraph: (target: string) => api<GitGraphReport>(P(`/api/git-graph?${target}`)),
  releaseNotes: (target: string) => api<ReleaseNotesListReport>(P(`/api/release-notes?${target}`)),
  releaseNotesDetail: (target: string, mergeSha: string) =>
    api<ReleaseNotesDetail>(P(`/api/release-notes/detail?${target}&merge=${encodeURIComponent(mergeSha)}`)),
  /** EPIC-P49 (ADR-0063): Knowledge Vault — Menschenfläche, Agenten bekommen 403. */
  vaultState: () => api<VaultState>(P("/api/vault/state")),
  vaultBrowse: (path?: string) => api<VaultBrowse>(P(`/api/vault/browse${path ? `?path=${encodeURIComponent(path)}` : ""}`)),
  /** BUG-0123: flache Vorschlagsliste aller wählbaren Ordner für die Root-Wahl. */
  vaultSetRoot: (path: string) => api<VaultState>(P("/api/vault/root"), { method: "PUT", body: JSON.stringify({ path }) }),
  vaultFiles: () => api<VaultListing>(P("/api/vault/files")),
  vaultCreate: (name: string) => api<VaultFile>(P("/api/vault/files"), { method: "POST", body: JSON.stringify({ name }) }),
  vaultRead: (path: string) => api<VaultRead>(P(`/api/vault/file?path=${encodeURIComponent(path)}`)),
  vaultSave: (path: string, text: string, rev: string) => api<VaultRead>(P(`/api/vault/file?path=${encodeURIComponent(path)}&rev=${rev}`), { method: "PUT", body: JSON.stringify({ text }) }),
  /** Diagnose: nur auf ausdrücklichen Klick; Freigabe gilt pro Projekt. */
  diagnosticsRun: (target: string, path: string) =>
    api<DiagnosticsResult>(P(`/api/diagnostics/run?${target}&path=${encodeURIComponent(path)}`), { method: "POST", body: "{}" }),
  diagnosticsTrust: (target: string) => api<ProjectTrust>(P(`/api/diagnostics/trust?${target}`)),
  diagnosticsSetTrust: (target: string, trusted: boolean) =>
    api<ProjectTrust>(P(`/api/diagnostics/trust?${target}`), { method: "POST", body: JSON.stringify({ trusted }) }),
  fileFeedbackPreview: (sessionId: string, items: FileFeedbackItem[]) =>
    api<{ prompt: string; stale: { path: string; reason: string | null }[] }>(P(`/api/sessions/${sessionId}/files/feedback/preview`), { method: "POST", body: JSON.stringify({ items }) }),
  fileFeedbackSend: (sessionId: string, items: FileFeedbackItem[], operationId: string) =>
    api<{ ok: boolean }>(P(`/api/sessions/${sessionId}/files/feedback/send`), { method: "POST", body: JSON.stringify({ items, operationId }) }),
  /** Originalbytes als Object-URL — der Token bleibt im Header, nie in einer URL. */
  codeRawUrl: async (target: string, path: string, rev: string): Promise<string> => {
    const res = await fetch(P(`/api/code/raw?${target}&path=${encodeURIComponent(path)}&rev=${rev}`), { headers: { authorization: `Bearer ${getToken()}` } });
    if (!res.ok) throw new Error(res.status === 409 ? "Die Datei hat sich geändert — neu laden." : `${res.status}`);
    return URL.createObjectURL(await res.blob());
  },
  /** Bytes eines Bildes, das ein Werkzeug gelesen hat — ohne Revisionsprüfung,
   * weil die Vorschau die Datei so zeigt, wie sie jetzt ist. Der Token bleibt im
   * Header; in der Bild-URL steckt nie ein Geheimnis. */
  toolImageBlobUrl: async (target: string, path: string): Promise<string> => {
    const res = await fetch(P(`/api/code/raw?${target}&path=${encodeURIComponent(path)}`), { headers: { authorization: `Bearer ${getToken()}` } });
    if (!res.ok) throw new Error(`${res.status}`);
    return URL.createObjectURL(await res.blob());
  },
  sessionActions: (sessionId: string) => api<{ actions: ActionDefinition[]; runs: ActionRun[] }>(P(`/api/sessions/${sessionId}/actions`)),
  runAction: (sessionId: string, actionId: string, params: Record<string, string>) =>
    api<ActionRun>(P(`/api/sessions/${sessionId}/actions/${encodeURIComponent(actionId)}`), { method: "POST", body: JSON.stringify({ params }) }),
  stopAction: (sessionId: string, runId: string) => api<ActionRun>(P(`/api/sessions/${sessionId}/actions/runs/${runId}/stop`), { method: "POST", body: "{}" }),
  actionRun: (sessionId: string, runId: string) => api<ActionRun>(P(`/api/sessions/${sessionId}/actions/runs/${runId}`)),
  /** T2.2 expand-on-tap: full hunks for one file, after /diff collapsed
   * them under K3. `commit` lädt den Hunk aus genau diesem
   * Commit-Abschnitt (AC-P2-1), ohne ihn gegen das Arbeitsverzeichnis
   * aufzulösen. */
  sessionDiffHunk: (id: string, path: string, commit?: string) =>
    api<{ path: string; hunks: DiffHunk[] }>(
      P(`/api/sessions/${id}/diff/hunk?path=${encodeURIComponent(path)}${commit ? `&commit=${commit}` : ""}`),
    ),
  events: (id: string, afterSeq = 0, limit = 500) =>
    api<{ seq: number; type: string; summary: string; ts: string; payload: unknown; blobRef: string | null }[]>(
      P(`/api/sessions/${id}/events?afterSeq=${afterSeq}&limit=${limit}`),
    ),
  /** ADR-0084 (BUG-0184): die Token-Bilanz der Session — erzeugt vs. verarbeitet.
   * Abgeleitet aus dem EventStore; `lastSeq` ist nur der Cache-Schlüssel. */
  sessionTokens: (id: string) => api<SessionTokenTotals>(P(`/api/sessions/${id}/tokens`)),
  eventBlob: async (sessionId: string, blobRef: string): Promise<string> => {
    const hash = blobRef.replace(/^sha256:/, "");
    const res = await fetch(P(`/api/sessions/${encodeURIComponent(sessionId)}/blobs/${encodeURIComponent(hash)}`), {
      headers: { authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) throw new Error(`Details konnten nicht geladen werden (${res.status}).`);
    return res.text();
  },
  createSession: (body: {
    /** Entweder `adapter` oder `loop` (EPIC-P19). */
    adapter?: string;
    project: string;
    /** EPIC-P19: Loop / Dark Factory; ohne Angabe startet die Session wie bisher. */
    loop?: LoopSpec;
    prompt?: string;
    model?: string;
    budgetUsd?: number | null;
    args?: { skill?: string; agent?: string; permissionMode?: string };
    /** ADR-0057: Arbeitsort; ohne Angabe eigener Worktree. */
    workspaceMode?: "worktree" | "direct";
    confirmDirty?: boolean;
    /** ADR-0081: parallels Schreiben in einem Nicht-Git-Ordner ausdrücklich bestätigt. */
    confirmSharedFolder?: boolean;
    /** Adoption (ADR-0011): continue an externally discovered session. */
    adoptNativeSessionId?: string;
    /** ADR-0040: continue as a copy (a run still open elsewhere is not shared) and keep its title. */
    adoptFork?: boolean;
    title?: string;
    /** Read-only mirror (ADR-0011 Erweiterung): show an observed opencode
     * session's chat without adopting or running anything. */
    mirrorNativeSessionId?: string;
    attachmentIds?: string[];
  }) =>
    api<SessionRecord>(P("/api/sessions"), {
      method: "POST",
      body: JSON.stringify(body),
    }),
  /** ADR-0057: was „Projekt direkt“ hier bedeutet (read-only). */
  workspacePreview: (project: string) => api<WorkspacePreview>(P(`/api/workspace/preview?project=${encodeURIComponent(project)}`)),
  workplace: (id: string) => api<WorkplaceStatus>(P(`/api/sessions/${id}/workplace`)),
  /** EPIC-P26 T26.5 (ADR-0043): Factory-Lauf — legt Treiber (Factory-Skill,
   * Claude/maki im Projekt) und verknüpften Beobachter (Loop project-Modus) an. */
  factoryStart: (body: { project: string; goal?: string; adapter?: string; model?: string }) =>
    api<{ driver: SessionRecord; observer: SessionRecord }>(P("/api/factory/start"), {
      method: "POST",
      body: JSON.stringify(body),
    }),
  /** T26.6: feste Allowlist (end_run, resume, set_mode); Betriebsart `a` braucht `confirm`. */
  factoryCommand: async (id: string, body: { command: "end_run" | "resume" | "set_mode"; modus?: "a" | "b"; provider?: "anthropic" | "zai"; confirm?: boolean }): Promise<{ ok: boolean; detail?: string }> => {
    try {
      return await api<{ ok: boolean; detail?: string }>(P(`/api/factory/${id}/command`), { method: "POST", body: JSON.stringify(body) });
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : "Befehl fehlgeschlagen" };
    }
  },
  // Real, serious bug found live-testing T3.10's voice-stop directive:
  // this sent no body at all, but api()'s content-type: application/json
  // header is unconditional — Fastify rejects that combination with a
  // real 400 (FST_ERR_CTP_EMPTY_JSON_BODY). The UI's own "Stop" button
  // (SessionTail.tsx) calls this exact function and swallows the error
  // via `.catch(() => undefined)`, so the button has been silently doing
  // nothing this whole time — confirmed live via curl before assuming.
  /** Commit the session worktree and merge it into the project checkout. */
  applyToProject: async (id: string): Promise<{ ok: boolean; into?: string; commit?: string; files?: number; detail?: string }> => {
    const res = await fetch(P(`/api/sessions/${id}/apply`), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${getToken()}` },
      body: "{}",
    });
    return (await res.json().catch(() => ({ ok: false, detail: `${res.status} ${res.statusText}` }))) as {
      ok: boolean;
      into?: string;
      commit?: string;
      files?: number;
      detail?: string;
    };
  },
  resumeSession: (id: string) =>
    api<{ ok: boolean; detail?: string }>(P(`/api/sessions/${id}/resume`), { method: "POST", body: "{}" }),
  /** BUG-0126 (ADR-0070): tote Native-Bindung droppen, Kontext aus dem Verlauf neu aufbauen. */
  repairSession: (id: string) =>
    api<{ ok: boolean; detail?: string }>(P(`/api/sessions/${id}/repair`), { method: "POST", body: "{}" }),
  /** EPIC-P29 T29.6: Workspace-Status (K7-Projektion), Logs, menschlicher Retry, Preview-Ticket. */
  workspaceStatus: (id: string) => api<WorkspaceStatus>(P(`/api/sessions/${id}/workspace`)),
  workspaceServiceLogs: (id: string, serviceId: string) =>
    api<WorkspaceServiceLogs>(P(`/api/sessions/${id}/workspace/services/${encodeURIComponent(serviceId)}/logs`)),
  workspaceRetry: (id: string) =>
    api<{ ok: boolean; detail?: string }>(P(`/api/sessions/${id}/workspace/retry`), { method: "POST", body: "{}" }),
  workspacePreviewTicket: (id: string, serviceId: string) =>
    api<WorkspacePreviewTicket>(P(`/api/sessions/${id}/workspace/services/${encodeURIComponent(serviceId)}/preview-ticket`), { method: "POST", body: "{}" }),
  /** Die Proxy-Basis für iframes: Ticket statt Bearer (ADR-0051 §6). */
  workspaceProxyBase: (id: string, serviceId: string) => P(`/api/sessions/${id}/workspace/services/${encodeURIComponent(serviceId)}/proxy`),
  stopSession: (id: string) =>
    api<{ ok: boolean }>(P(`/api/sessions/${id}/stop`), { method: "POST", body: "{}" }),
  /** T8.6: rename and pin. autoResumeOnLimit: ADR-0076 Nachtrag — Option
   * „nach dem Limit-Fenster automatisch weitermachen" (Menschen, kein Agent). */
  setSessionMeta: (id: string, meta: { title?: string | null; pinned?: boolean; autoResumeOnLimit?: boolean }) =>
    api<SessionRecord>(P(`/api/sessions/${id}/meta`), { method: "POST", body: JSON.stringify(meta) }),
  setArchived: (id: string, archived: boolean) =>
    api<SessionRecord>(P(`/api/sessions/${id}/archive`), {
      method: "POST",
      body: JSON.stringify({ archived }),
    }),
  /** Delete for good — events, worktree, row. 409 while it runs. */
  deleteSession: (id: string) => api<void>(P(`/api/sessions/${id}`), { method: "DELETE", body: "{}" }),
  // T1.5-6: doesn't go through api<T>() — a rejected steer (e.g. "no
  // thread_id captured yet") comes back as a 422 with a real, meaningful
  // {ok:false, detail} body, and api<T>()'s generic !res.ok path would
  // throw a bare "422 Unprocessable Entity" instead of surfacing that
  // detail. Callers inspect ack.ok/ack.detail themselves.
  /** `takeover` moves the writer lease to this device on purpose (T5.5). */
  /** EPIC-P11 (ADR-0031): the desktop companion. */
  desktop: () => api<{ companions: CompanionState[]; actions: DesktopAction[] }>(P("/api/desktop")),
  desktopAction: (body: { companion: string; kind: "insert" | "replace" | "key"; inputMode?: "keystroke" | "targeted-paste"; text?: string; key?: string; target: { id: string; revision: number } }) =>
    api<DesktopAction>(P("/api/desktop/actions"), { method: "POST", body: JSON.stringify(body) }),
  cancelDesktopAction: (id: string) => api<DesktopAction>(P(`/api/desktop/actions/${id}/cancel`), { method: "POST", body: "{}" }),
  /** EPIC-P10.5 (ADR-0030): video analysis. */
  media: () => api<MediaInfo>(P("/api/media")),
  mediaJobs: () => api<MediaJob[]>(P("/api/media/jobs")),
  mediaJob: (id: string) => api<MediaJob>(P(`/api/media/jobs/${id}`)),
  mediaResult: (id: string) => api<MediaResult>(P(`/api/media/jobs/${id}/result`)),
  createMediaJob: (body: { url: string; allowCloud: boolean; language: string }) => api<MediaJob>(P("/api/media/jobs"), { method: "POST", body: JSON.stringify(body) }),
  uploadMedia: async (file: File, allowCloud: boolean, language: string): Promise<MediaJob> => {
    const res = await fetch(P(`/api/media/upload?allowCloud=${allowCloud ? 1 : 0}&language=${encodeURIComponent(language)}`), {
      method: "POST",
      headers: { "content-type": file.type || "application/octet-stream", "x-filename": encodeURIComponent(file.name), authorization: `Bearer ${getToken()}` },
      body: file,
    });
    const body = (await res.json().catch(() => ({}))) as MediaJob & { error?: string };
    if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
    return body;
  },
  cancelMediaJob: (id: string) => api<MediaJob>(P(`/api/media/jobs/${id}/cancel`), { method: "POST", body: "{}" }),
  deleteMediaJob: (id: string) => api<{ ok: boolean }>(P(`/api/media/jobs/${id}`), { method: "DELETE" }),
  /** A key frame as an object URL (the token stays in a header). */
  mediaFrameUrl: async (id: string, file: string): Promise<string> => {
    const res = await fetch(P(`/api/media/jobs/${id}/frames/${file}`), { headers: { authorization: `Bearer ${getToken()}` } });
    if (!res.ok) throw new Error(`${res.status}`);
    return URL.createObjectURL(await res.blob());
  },
  /** T10.2 (ADR-0028): local speech-to-text on the hub. */
  stt: () => api<{ available: boolean; engine?: string; streaming?: boolean }>(P("/api/stt")),
  sttStreamTicket: () => api<SttStreamTicket>(P("/api/stt/stream-ticket"), { method: "POST", body: "{}" }),
  sttStreamUrl: (ticket: string) => {
    const path = P(`/api/stt/stream?ticket=${encodeURIComponent(ticket)}`);
    const url = new URL(path, window.location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.href;
  },
  /** ADR-0087: PWA-Terminal (Allowlist). */
  terminals: () => api<TerminalList>(P("/api/terminals")),
  terminalTicket: (id: string) =>
    api<TerminalTicket>(P(`/api/terminals/${encodeURIComponent(id)}/ticket`), { method: "POST", body: "{}" }),
  terminalStreamUrl: (id: string, ticket: string, cols: number, rows: number, session?: string) => {
    const resume = session ? `&session=${encodeURIComponent(session)}` : "";
    const path = P(
      `/api/terminals/${encodeURIComponent(id)}/stream?ticket=${encodeURIComponent(ticket)}&cols=${cols}&rows=${rows}${resume}`,
    );
    const url = new URL(path, window.location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.href;
  },
  /** EPIC-P75 (ADR-0097): Sprachausgabe am Hub — Status aus echter Probe, Synthese als WAV-Blob. */
  ttsStatus: () => api<TtsStatusResponse>(P("/api/tts")),
  ttsSpeak: async (text: string): Promise<Blob> => {
    const res = await fetch(P("/api/tts"), { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${getToken()}` }, body: JSON.stringify({ text }) });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `${res.status} ${res.statusText}`);
    }
    return res.blob();
  },
  compactionSettings: () => api<CompactionSettings>(P(compactionSettingsPath)),
  setCompactionSettings: (settings: CompactionSettings) =>
    api<CompactionSettings>(P(compactionSettingsPath), { method: "PUT", body: JSON.stringify(settings) }),
  ttsSettings: () => api<{ tts: TtsSettingsView }>(P("/api/settings/tts")),
  setTtsSettings: (patch: TtsSettingsPatch) => api<{ tts: TtsSettingsView }>(P("/api/settings/tts"), { method: "PUT", body: JSON.stringify(patch) }),
  transcribe: async (audio: Blob): Promise<{ text: string; engine: string; audioMs: number; latencyMs: number }> => {
    const res = await fetch(P("/api/stt"), { method: "POST", headers: { "content-type": audio.type || "audio/webm", authorization: `Bearer ${getToken()}` }, body: audio });
    const body = (await res.json().catch(() => ({}))) as { text?: string; engine?: string; audioMs?: number; latencyMs?: number; error?: string };
    if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
    return { text: body.text ?? "", engine: body.engine ?? "", audioMs: body.audioMs ?? 0, latencyMs: body.latencyMs ?? 0 };
  },
  /** T9 (ADR-0027): text in, a plan out; executed through the real routes. */
  commandPlan: (text: string, context: Record<string, unknown>, answers?: Record<string, string>) =>
    api<CommandPlan>(P("/api/commands/plan"), { method: "POST", body: JSON.stringify({ text, context, ...(answers ? { answers } : {}) }) }),
  commandExecute: (id: string, context: Record<string, unknown>) =>
    api<{ planId: string; results: StepResult[]; repeated: boolean }>(P(`/api/commands/${id}/execute`), { method: "POST", body: JSON.stringify({ context }) }),
  commandTransform: (text: string, transform: string) =>
    api<{ text: string; model: string; provider: string; latencyMs: number }>(P("/api/commands/transform"), { method: "POST", body: JSON.stringify({ text, transform }) }),
  /** T8.3 (ADR-0026): Web Push. */
  push: () => api<PushState>(P("/api/push")),
  setPushEnabled: (enabled: boolean) => api<{ enabled: boolean; publicKey: string | null }>(P("/api/push/enabled"), { method: "PUT", body: JSON.stringify({ enabled }) }),
  pushSubscribe: (body: { endpoint: string; keys: { p256dh: string; auth: string }; oldEndpoint?: string; quiet?: { from: number; to: number; tzOffsetMinutes: number } | null; done?: boolean; locale?: "de" | "en" }) =>
    api<{ ok: boolean }>(P("/api/push/subscriptions"), { method: "POST", body: JSON.stringify(body) }),
  pushUnsubscribe: (endpoint: string) => api<{ ok: boolean }>(P("/api/push/subscriptions"), { method: "DELETE", body: JSON.stringify({ endpoint }) }),
  pushTest: () => api<{ sent: number; errors: string[] }>(P("/api/push/test"), { method: "POST", body: "{}" }),
  /** T8.4 (ADR-0025): the shared draft of a session. */
  draft: (id: string) => api<SessionDraft>(P(`/api/sessions/${id}/draft`)),
  saveDraft: async (id: string, text: string, attachmentIds: string[], baseRevision: number): Promise<{ ok: true; draft: SessionDraft } | { ok: false; current: SessionDraft }> => {
    const res = await fetch(P(`/api/sessions/${id}/draft`), {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ text, attachmentIds, baseRevision }),
    });
    const body = (await res.json().catch(() => ({}))) as SessionDraft & { current?: SessionDraft; error?: string };
    if (res.status === 409 && body.current) return { ok: false, current: body.current };
    if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
    return { ok: true, draft: body };
  },
  /** EPIC-P15 T15.4: is this session open in a terminal at the PC? */
  sessionPc: (id: string) => api<PcState>(P(`/api/sessions/${id}/pc`)),
  /** EPIC-P15 T15.3: prompts waiting for the running turn. */
  /** EPIC-P21 T21.2: proposal for handing a session to another provider. */
  handoverDraft: (id: string) =>
    api<{ prompt: string; adapter: string; model: string | null; reason: { category: string; title: string; detail: string } | null }>(P(`/api/sessions/${id}/handover`)),
  handover: (id: string, body: { adapter: string; model?: string; prompt: string }) => api<SessionRecord>(P(`/api/sessions/${id}/handover`), { method: "POST", body: JSON.stringify(body) }),
  runEstimate: (id: string) => api<RunEstimate>(P(`/api/sessions/${id}/estimate`)),
  sessionQueue: (id: string) => api<QueuedPrompt[]>(P(`/api/sessions/${id}/queue`)),
  removeQueued: (id: string, queueId: string) => api<{ ok: boolean }>(P(`/api/sessions/${id}/queue/${queueId}`), { method: "DELETE" }),
  /** BUG-0114: einen vorgemerkten Prompt sofort in die laufende Unterhaltung senden.
   * BUG-0115: Fastify weist einen POST mit JSON-Content-Type und leerem Body
   * mit 400 ab — deshalb ein explizit leerer JSON-Body statt gar keins. */
  sendQueuedNow: (id: string, queueId: string) => api<Ack>(P(`/api/sessions/${id}/queue/${queueId}/send`), { method: "POST", body: JSON.stringify({}) }),
  /** ADR-0085: eine vorgemerkte Meldung nachtraeglich aendern — Text und/oder Stelle. */
  editQueued: (id: string, queueId: string, patch: QueuePatch) =>
    api<Ack>(P(`/api/sessions/${id}/queue/${queueId}`), { method: "PATCH", body: JSON.stringify(patch) }),
  /** EPIC-P40/EPIC-P60: Agenten-Teams (Run→Team, ADR-0077). */
  teamsScope: P("/api/teams"),
  teamList: () => api<Team[]>(P("/api/teams")),
  teamStart: (input: TeamStart) =>
    api<Team>(P("/api/teams"), { method: "POST", body: JSON.stringify(input) }),
  teamGet: (id: string) => api<Team>(P(`/api/teams/${encodeURIComponent(id)}`)),
  teamAnswer: (id: string, gateId: string, label: string) =>
    api<Team>(P(`/api/teams/${encodeURIComponent(id)}/answer`), { method: "POST", body: JSON.stringify({ gateId, label }) }),
  teamCancel: (id: string, reason: string) =>
    api<Team>(P(`/api/teams/${encodeURIComponent(id)}/cancel`), { method: "POST", body: JSON.stringify({ reason }) }),
  /** EPIC-P41 (ADR-0064): Automationen — Verwaltung, Run-now und Verlauf. */
  automationsScope: P("/api/automations"),
  automations: async (): Promise<AutomationInfo[]> => (await api<{ automations: AutomationInfo[] }>(P("/api/automations"))).automations,
  /** EPIC-P73 (ADR-0094): externe Auto-Jobs — GitHub-Actions-Läufe und Issue-Bridge. */
  externalJobs: (): Promise<ExternalJobsResponse> => api<ExternalJobsResponse>(P("/api/automations/external")),
  /** ADR-0080: registrierte Aktionen eines Projekts — Quelle für Skript-Ziele im Automationen-Formular. */
  automationActions: (project: string) => api<{ actions: ActionDefinition[] }>(P(`/api/automations/actions?project=${encodeURIComponent(project)}`)),
  automationCreate: (definition: AutomationDefinition, promptText?: string) =>
    api<AutomationDefinition>(P("/api/automations"), { method: "POST", body: JSON.stringify({ definition, ...(promptText === undefined ? {} : { promptText }) }) }),
  automationTemplate: (id: string) => api<TeamStart>(P(`/api/automations/${encodeURIComponent(id)}/template`)),
  automationUpdate: (id: string, definition: AutomationDefinition, promptText?: string) =>
    api<AutomationDefinition>(P(`/api/automations/${encodeURIComponent(id)}`), { method: "PATCH", body: JSON.stringify({ definition, ...(promptText === undefined ? {} : { promptText }) }) }),
  automationSetEnabled: (id: string, enabled: boolean, generation: number) =>
    api<AutomationDefinition>(P(`/api/automations/${encodeURIComponent(id)}/enable`), { method: "POST", body: JSON.stringify({ enabled, generation }) }),
  automationRunNow: (id: string, generation: number) =>
    api<AutomationHistoryEntry>(P(`/api/automations/${encodeURIComponent(id)}/run-now`), { method: "POST", body: JSON.stringify({ generation }) }),
  automationResolve: (id: string, claimKey: string, note: string) =>
    api<AutomationHistoryEntry>(P(`/api/automations/${encodeURIComponent(id)}/resolve`), { method: "POST", body: JSON.stringify({ claimKey, note }) }),
  automationHistory: async (id: string): Promise<AutomationHistoryEntry[]> =>
    (await api<{ history: AutomationHistoryEntry[] }>(P(`/api/automations/${encodeURIComponent(id)}/history`))).history,
  steer: async (id: string, input: SteerInput, inputId?: string, takeover = false, queue?: boolean): Promise<Ack> => {
    const res = await fetch(P(`/api/sessions/${id}/steer`), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ ...input, clientId: clientId(), ...(inputId ? { inputId } : {}), ...(takeover ? { takeover } : {}), ...(queue !== undefined ? { queue } : {}) }),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; detail?: string; error?: string };
    // Two possible failure shapes from the server: a rejected Ack
    // ({ok:false, detail}) or a validation error ({error}, e.g. empty
    // text) — normalize both into one Ack so callers only check one thing.
    if (typeof body.ok === "boolean") return { ok: body.ok, ...(body.detail ? { detail: body.detail } : {}) };
    return { ok: false, detail: body.error ?? `${res.status} ${res.statusText}` };
  },
  };
}

export type HubApi = ReturnType<typeof createHubApi>;

/** This hub. */
export const hubApi: HubApi = createHubApi((path) => path);

let selfHostId: string | null = null;

/** Learned once from /api/fleet/hello: which host id is this hub. */
export function setSelfHostId(hostId: string | null): void {
  selfHostId = hostId;
}

/** The host id if it is another hub of the fleet, else null (this hub). */
export function remoteHost(hostId: string | null | undefined): string | null {
  return hostId && hostId !== selfHostId ? hostId : null;
}

/**
 * EPIC-P6: the same calls for one host of the fleet — through this hub's
 * /api/hosts/<hostId>/… route (answered locally for its own id).
 */
export function hostApi(hostId: string | null | undefined): HubApi {
  const remote = remoteHost(hostId);
  if (!remote) return hubApi;
  return createHubApi((path) => (path.startsWith("/api/") ? `/api/hosts/${encodeURIComponent(remote)}/${path.slice(5)}` : path));
}
