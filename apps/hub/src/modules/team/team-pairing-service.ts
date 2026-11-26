import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TLSSocket } from "node:tls";
import {
  checkCode, newPairingWindow, pairingComplete, parseTeamInviteText, spkiSha256Hex, teamInviteHash,
  type PairingWindow, type TeamTlsMaterial,
} from "@ancientvoid/core";
import type { TeamInviteData, TeamPeerPin } from "@ancientvoid/contracts";
import { sendPairingConfirm, startPairingServer, joinOverPairing, type PairingServer } from "./pairing-server.ts";

/**
 * EPIC-P83 T83.3 (ADR-0118 §7): Kopplungs-Dienst des Hubs — Fenster,
 * Kopplungsserver auf `team.pairPort`, Code-Eingabe und Pin-Speicher.
 * Pins liegen bis zum Journal (T83.4) atomar in `data/teams/pins.json`
 * (K7: Zustand aus Datei rekonstruierbar; das Journal wird T83.4 zur
 * alleinigen Quelle). Erst nach BEIDEN Bestätigungen wird gepinnt.
 * B signalisiert seine Code-Bestätigung per Confirm-Frame auf der
 * Pairing-Verbindung (nie den Code selbst).
 */

interface TeamsFile {
  v: 1;
  teams: { teamId: string; label: string; members: TeamPeerPin[] }[];
}

export interface PairingStatus {
  teamId: string;
  state: "idle" | "waiting" | "joined" | "confirmed";
  /** Anzeige für den Menschen: Code A vorlesen (A-Seite), Code B eintippen. */
  codeA: string | null;
  peerLabel: string | null;
  peerInstanceId: string | null;
  error: string | null;
  inviteText: string | null;
}

function makeSignal(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => { resolve = res; });
  return { promise, resolve };
}

export class TeamPairingService {
  private readonly dataDir: string;
  private readonly material: TeamTlsMaterial;
  private readonly ownSpki: string;
  private readonly pairPort: number;
  private window: PairingWindow | null = null;
  private server: PairingServer | null = null;
  private codes: { codeA: string; codeB: string } | null = null;
  private inviteText: string | null = null;
  private lastError: string | null = null;
  private teamLabel = "";
  /** Seite dieses Hubs in der laufenden Kopplung: A lädt ein, B tritt bei. */
  private side: "a" | "b" = "a";
  /** Signal für den Beitritt (A-Seite) — Tests und PWA awaiten statt zu pollen. */
  private joinedSignal: { promise: Promise<void>; resolve: () => void } | null = null;
  /** Signal: B-Confirm-Frame eingetroffen (A-Seite). */
  private bConfirmedSignal: { promise: Promise<void>; resolve: () => void } | null = null;
  /** Offene Pairing-Verbindung auf B (für Confirm-Frame nach Code-Eingabe). */
  private peerSocket: TLSSocket | null = null;
  /** complete() darf mehrfach aufgerufen werden (Auto + explizit), ohne Fehler. */
  private completedOk = false;

  constructor(opts: { dataDir: string; material: TeamTlsMaterial; pairPort: number; inviteAddress?: string }) {
    this.dataDir = opts.dataDir;
    this.material = opts.material;
    this.ownSpki = spkiSha256Hex(opts.material.publicKey);
    this.pairPort = opts.pairPort;
    this.inviteAddress = opts.inviteAddress ?? "127.0.0.1";
  }

  private readonly inviteAddress: string;

  /** Einladung anlegen und das Kopplungsfenster öffnen (Server lauscht, nur
   *  im offenen Fenster). Der Einladungstext trägt den tatsächlich gebundenen
   *  Port (auch bei ephemeral 0). */
  async openInvitation(label: string): Promise<{ teamId: string; inviteText: string; joined: Promise<void> }> {
    await this.close();
    this.teamLabel = label;
    const teamId = randomUUID();
    const secret = randomBytes(16).toString("base64url");
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    this.window = newPairingWindow(teamId, teamInviteHash(teamId, secret), expiresAt);
    this.inviteText = null;
    this.codes = null;
    this.lastError = null;
    this.side = "a";
    this.peerSocket = null;
    this.completedOk = false;
    this.joinedSignal = makeSignal();
    this.bConfirmedSignal = makeSignal();
    // Kopplungsserver nur im offenen Fenster (ADR-0118 §7.2) — Port zuerst
    // binden, damit die Einladung den echten Port trägt.
    this.server = await startPairingServer({
      port: this.pairPort,
      material: this.material,
      window: this.window,
      ownSpkiSha256: this.ownSpki,
      onJoined: ({ codes }) => {
        this.codes = codes;
        this.joinedSignal?.resolve();
      },
      onBConfirmed: () => {
        if (this.window) this.window.bTypedOk = true;
        this.bConfirmedSignal?.resolve();
        // Beide Seiten ok → sofort pinnen (kein Extra-Schritt nötig).
        if (this.window?.aTypedOk) void this.complete();
      },
    });
    const invite: TeamInviteData = {
      v: 1,
      protocolVersion: 1,
      address: this.inviteAddress,
      port: this.server.port,
      spkiSha256: this.ownSpki,
      certPem: this.material.identity.certPem,
      teamId,
      secret,
      expiresAt: expiresAt.toISOString(),
    };
    const text = `avteam1.${Buffer.from(JSON.stringify(invite)).toString("base64url")}`;
    this.inviteText = text;
    return { teamId, inviteText: text, joined: this.joinedSignal.promise };
  }

  /** A-seitig: wartet, bis ein Peer beigetreten ist (Signal statt Poll). */
  waitForJoin(): Promise<void> {
    if (this.joinedSignal === null) return Promise.reject(new Error("kein Kopplungsfenster offen"));
    return this.joinedSignal.promise;
  }

  /** A-seitig: wartet auf B-Confirm-Frame. */
  waitForBConfirm(): Promise<void> {
    if (this.window?.bTypedOk) return Promise.resolve();
    if (this.bConfirmedSignal === null) return Promise.reject(new Error("kein Kopplungsfenster offen"));
    return this.bConfirmedSignal.promise;
  }

  /** A-seitige Code-Eingabe: der Mensch tippt den vorgelesenen Code B. */
  typeCodeB(typed: string): { ok: boolean; error: string | null } {
    if (this.window === null || this.codes === null) return { ok: false, error: "kein Kopplungsfenster offen" };
    const error = checkCode(this.window, "a", typed, this.codes.codeB);
    if (error !== null) return { ok: false, error };
    if (this.window.bTypedOk) void this.complete();
    return { ok: true, error: null };
  }

  /** Beide Seiten bestätigt → Pin speichern. Wartet ggf. auf B-Confirm-Frame. */
  async complete(timeoutMs = 5_000): Promise<{ ok: boolean; error: string | null }> {
    if (this.completedOk) return { ok: true, error: null };
    if (this.window === null) return { ok: false, error: "kein Kopplungsfenster offen" };
    if (this.window.aTypedOk && !this.window.bTypedOk && this.bConfirmedSignal !== null) {
      const timedOut = await Promise.race([
        this.bConfirmedSignal.promise.then(() => false),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(true), timeoutMs)),
      ]);
      if (this.completedOk) return { ok: true, error: null };
      if (timedOut && this.window !== null && !this.window.bTypedOk) {
        return { ok: false, error: "nicht beide Seiten bestätigt" };
      }
    }
    if (this.completedOk) return { ok: true, error: null };
    if (this.window === null || !pairingComplete(this.window) || this.window.joined === null) {
      return { ok: false, error: "nicht beide Seiten bestätigt" };
    }
    // Claim vor dem Schreiben — paralleler Auto-/Explizit-Aufruf wird idempotent.
    this.completedOk = true;
    const profile = this.window.joined;
    const pin: TeamPeerPin = {
      instanceId: profile.instanceId,
      spkiSha256: profile.spkiSha256,
      certPem: profile.certPem,
      address: null,
      port: null,
      state: "disconnected",
      pinnedAt: new Date().toISOString(),
    };
    const teams = this.readTeams();
    const team = teams.teams.find((t) => t.teamId === this.window?.teamId);
    if (team) team.members.push(pin);
    else teams.teams.push({ teamId: this.window.teamId, label: this.teamLabel || this.window.teamId, members: [pin] });
    this.writeTeams(teams);
    this.window = null;
    void this.close();
    return { ok: true, error: null };
  }

  status(): PairingStatus {
    let state: PairingStatus["state"] = "idle";
    if (this.window !== null) {
      if (this.window.joined === null) state = "waiting";
      else if (pairingComplete(this.window)) state = "confirmed";
      else state = "joined";
    }
    return {
      teamId: this.window?.teamId ?? "",
      state,
      // Seitenkorrekt: A liest Code A vor (und tippt Code B), B liest Code B vor (und tippt Code A).
      codeA: this.side === "a" ? this.codes?.codeA ?? null : this.codes?.codeB ?? null,
      peerLabel: this.window?.joined?.label ?? null,
      peerInstanceId: this.window?.joined?.instanceId ?? null,
      error: this.lastError,
      inviteText: this.inviteText,
    };
  }

  /** B-Seite: Einladungstext annehmen, wählen, Codes ableiten (Status speichern). */
  async joinFromInvite(inviteText: string, label: string): Promise<{ ok: boolean; error: string | null }> {
    this.lastError = null;
    const invite = parseTeamInviteText(inviteText);
    if (invite === null) return { ok: false, error: "Einladung unlesbar (Präfix avteam1. fehlt oder Form kaputt)" };
    if (new Date(invite.expiresAt).getTime() <= Date.now()) return { ok: false, error: "Einladung abgelaufen" };
    const result = await joinOverPairing({
      invite,
      material: this.material,
      label,
      ownSpkiSha256: this.ownSpki,
      ownInstanceId: this.material.identity.instanceId,
    });
    if (!result.ok) return { ok: false, error: `Beitritt abgelehnt: ${result.error}` };
    this.side = "b";
    this.codes = result.codes;
    this.peerSocket = result.socket;
    this.window = newPairingWindow(invite.teamId, "b-side", new Date(Date.parse(invite.expiresAt)));
    // B hat „beigetreten“; Peer-Anzeige = A (Pin aus Einladung; instanceId = base64url(SPKI-Hash)).
    const peerInstanceId = Buffer.from(invite.spkiSha256, "hex").toString("base64url");
    this.window.joined = {
      instanceId: peerInstanceId,
      spkiSha256: invite.spkiSha256,
      certPem: invite.certPem,
      label: "Einladende Instanz",
    };
    return { ok: true, error: null };
  }

  /** B-seitige Code-Eingabe: der Mensch tippt den vorgelesenen Code A; Confirm-Frame an A. */
  async typeCodeA(typed: string): Promise<{ ok: boolean; error: string | null }> {
    if (this.window === null || this.codes === null) return { ok: false, error: "kein Beitritt aktiv" };
    if (this.peerSocket === null || this.peerSocket.destroyed) {
      return { ok: false, error: "Kopplungsverbindung weg — neu beitreten" };
    }
    // B prüft gegen das eigene, abgeleitete Code A (nie über die Leitung).
    const error = checkCode(this.window, "b", typed, this.codes.codeA);
    if (error !== null) return { ok: false, error };
    try {
      await sendPairingConfirm(this.peerSocket);
    } catch {
      return { ok: false, error: "Confirm-Frame nicht gesendet" };
    }
    return { ok: true, error: null };
  }

  pins(): TeamPeerPin[] {
    return this.readTeams().teams.flatMap((t) => t.members);
  }

  async close(): Promise<void> {
    if (this.peerSocket !== null && !this.peerSocket.destroyed) {
      this.peerSocket.destroy();
      this.peerSocket = null;
    }
    if (this.server !== null) {
      await this.server.close();
      this.server = null;
    }
  }

  private readTeams(): TeamsFile {
    const path = join(this.dataDir, "teams", "pins.json");
    if (!existsSync(path)) return { v: 1, teams: [] };
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as TeamsFile;
      return raw.v === 1 ? raw : { v: 1, teams: [] };
    } catch {
      // Kaputte Datei: leer starten — Kopplung ist wiederholbar (fail loud im Status).
      return { v: 1, teams: [] };
    }
  }

  private writeTeams(teams: TeamsFile): void {
    const dir = join(this.dataDir, "teams");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "pins.json");
    const tmp = join(dir, `.pins-${randomUUID()}.tmp`);
    writeFileSync(tmp, JSON.stringify(teams));
    renameSync(tmp, path);
  }
}
