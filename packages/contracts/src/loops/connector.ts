import type { Ack, AdapterContext, HealthReport, SessionHandle } from "../harness/adapter.ts";

/** Steuerbefehle, die ein Loop anbieten kann. Der Hub zeigt nur, was `capabilities().controls` nennt. */
export const LOOP_CONTROLS = ["pause", "resume", "setMode", "workNext"] as const;
export type LoopControl = (typeof LOOP_CONTROLS)[number];

export interface LoopOption {
  key: string;
  label: string;
  kind: "select" | "text" | "toggle";
  choices?: readonly { value: string; label: string }[];
  required?: boolean;
  placeholder?: string;
}

/** Wert einer Auswahl-Option, der in der Oberfläche „Neues Repo anbinden“ öffnet (siehe `LoopOnboarding`). */
export const LOOP_NEW = "+neu";

/** Onboarding-Feld: ein `LoopOption` plus semantischer Vorbelegung (ADR-0045).
 * `prefill: "project"` heißt: Die Oberfläche setzt den Projektpfad der im
 * Start-Dialog gewählten Auswahl ein (nur solange der Nutzer selbst nichts
 * getippt hat). Damit rät die PWA nicht aus Labels, sondern der Connector
 * erklärt sein Feld (BUG-0081-Folge: securesight „Projektpfad (absolut)“). */
export interface LoopOnboardingField extends LoopOption {
  prefill?: "project";
}

/**
 * Loops, die erst für ein Repo eingerichtet werden müssen (aSPARK: `factoryctl new`, securesight: `factory init`),
 * bieten ein Onboarding an: Felder plus optional ein Geheimnis (aSPARK: Repo-Token), das nur durchgereicht wird —
 * nie gespeichert, geloggt oder in Ereignissen. Loops ohne Geheimnis (securesight) lassen `secret` weg.
 */
export interface LoopOnboarding {
  /** Schlüssel der Option, deren Wert `LOOP_NEW` das Formular öffnet (z. B. "line"). */
  optionKey: string;
  label: string;
  fields: readonly LoopOnboardingField[];
  secret?: { label: string; hint?: string };
  /** Hinweiszeilen unter den Feldern (z. B. warum eine Wahl ausgeblendet bleibt, AC-P26-9). */
  notes?: readonly string[];
}

export interface LoopCapabilities {
  /** Wer die Agenten ausführt: "external" = das Loop-System selbst, "hub" = der Connector treibt Agenten über ctx.spawnWorker seiner eigenen Session (ADR-0110). */
  agents: "external" | "hub";
  /** Woher die Arbeit kommt. */
  intake: readonly ("prompt" | "issues" | "backlog")[];
  /** Eigene Betriebsarten, providereigene Namen (werden nicht vereinheitlicht, ADR-0033-Muster). */
  modes: readonly string[];
  /** Betriebsarten mit Außenwirkung (Merge, Commit): die Oberfläche fragt vor dem Start nach. */
  riskyModes: readonly string[];
  /** Wählbare Orchestratoren (securesight-factory: self | hermes). Leer = keine Wahl. */
  orchestrators: readonly string[];
  controls: readonly LoopControl[];
  /** Gates, die der Loop meldet (aSPARK dark: policy|review|ci|merge). Nur Anzeige. */
  gates: readonly string[];
  /** Fragen des Loops, die der Hub beantworten darf. */
  asks: "none" | "permission" | "permission+question";
  /** Felder des Start-Formulars über Betriebsart und Orchestrator hinaus. */
  options: readonly LoopOption[];
  /** Nur Loops mit Einrichtung pro Repo. */
  onboarding?: LoopOnboarding;
}

/** Startauswahl, wie der Connector sie sieht (Projekt und Ziel kommen vom Hub). */
export interface LoopStartSpec {
  project: string;
  goal?: string;
  mode?: string;
  orchestrator?: string;
  options: Record<string, string>;
}

export type LoopOnboardResult =
  | { ok: true; /** Werte für die Startauswahl, z. B. { line: "web" }. */ options: Record<string, string>; detail?: string;
      /** Additiv (ADR-0043 §5, EPIC-P26): `false` = Einrichtung lief, das System meldet aber „nicht bereit“ — die Oberfläche startet dann keinen Lauf. Fehlt das Feld, gilt der Lauf als startbar. */
      ready?: boolean }
  | { ok: false; detail: string };

export type LoopControlInput =
  | { kind: "pause" }
  | { kind: "resume" }
  | { kind: "setMode"; mode: string }
  | { kind: "workNext"; text?: string };

/** Der Hub hält die Leseposition des Connectors (K7): beim Wiederanlauf kommt sie zurück. */
export interface LoopIo {
  /** Letzte gespeicherte Position oder null beim ersten Start. */
  resume: unknown;
  saveCursor(cursor: unknown): void;
  /** ADR-0113: weitere Loop-Session dieses Connectors starten (optional, hub-seitig implementiert). */
  startSession?: LoopSessionStarter;
}

/**
 * ADR-0113: eine weitere Loop-Session **dieses** Connectors anfordern (z. B.
 * Ralph-Agent-Review). Nur von der Hub-Seite implementiert — fehlt die
 * Funktion, fällt der Connector auf Inline-Verhalten zurück. Die Session ist
 * eine normale, in der PWA sichtbare Loop-Session.
 */
export type LoopSessionStarter = (spec: LoopStartSpec) => Promise<{ sessionId: string } | { error: string }>;

/**
 * Ein Connector verbindet den Hub mit EINEM Loop-System (ADR-0038). Er sieht nur den
 * AdapterContext, nie Hub-Interna. Alles Fremde ist Daten: nichts davon wird als Anweisung gelesen.
 */
export interface LoopConnector {
  readonly id: string;
  readonly version: string;
  capabilities(): LoopCapabilities;
  start(spec: LoopStartSpec, ctx: AdapterContext, io: LoopIo): Promise<SessionHandle>;
  control(handle: SessionHandle, input: LoopControlInput, ctx: AdapterContext): Promise<Ack>;
  status(handle: SessionHandle): Promise<HealthReport>;
  /** Richtet das Loop-System für ein Repo ein (nur mit `capabilities().onboarding`). Wirft nie; Fehler als `ok: false`. */
  onboard?(input: { options: Record<string, string>; secret?: string }, signal: AbortSignal): Promise<LoopOnboardResult>;
  /** Trennt den Hub vom Loop. Das Loop-System selbst läuft weiter (nur beobachtet/gesteuert, nie beendet). */
  stop(handle: SessionHandle, ctx: AdapterContext): Promise<void>;
}

export type LoopConnectorFactory = (config?: Readonly<Record<string, unknown>>) => LoopConnector;

/** Formprüfung eines geladenen Moduls (Muster `isValidAdapterFactory`). */
export function isValidLoopFactory(mod: unknown): mod is { createLoopConnector: LoopConnectorFactory } {
  return typeof mod === "object" && mod !== null && typeof (mod as { createLoopConnector?: unknown }).createLoopConnector === "function";
}
