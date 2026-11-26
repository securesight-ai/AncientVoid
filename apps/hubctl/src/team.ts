/** EPIC-P83 T83.3 — `hubctl team …` gegen die Kopplungs-Routen (ADR-0118 §7). */

import { api } from "./api.ts";

interface PairingStatus {
  teamId: string;
  state: string;
  codeA: string | null;
  peerLabel: string | null;
  peerInstanceId: string | null;
  error: string | null;
  inviteText: string | null;
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0 || !args[i + 1] || args[i + 1]!.startsWith("--")) return undefined;
  return args[i + 1];
}

function usage(): never {
  console.error(`hubctl team — Team-Kopplung (EPIC-P83 T83.3)

  hubctl team invite [--label <name>]     Einladungstext (avteam1.…) erzeugen
  hubctl team status                      Kopplungsfenster / Codes anzeigen
  hubctl team confirm <code>              A tippt Code B  |  B tippt Code A
  hubctl team join <inviteText> [--label <name>]
  hubctl team complete                    Pin speichern (falls nicht auto)
  hubctl team pins                        gespeicherte Peer-Pins

Env: ANCIENTVOID_URL, ANCIENTVOID_TOKEN`);
  process.exit(2);
}

export async function teamCommand(args: string[]): Promise<void> {
  const sub = args[0] ?? usage();
  if (sub === "invite") {
    const label = flag(args, "--label") ?? "Team";
    const opened = await api<{ teamId: string; inviteText: string }>("/api/teams", {
      method: "POST",
      body: JSON.stringify({ label }),
    });
    console.log(`teamId=${opened.teamId}`);
    console.log(`invite (10 min, einmalig; Text, nie URL):\n${opened.inviteText}`);
    console.log("Danach: Partner liest Code B vor → hubctl team confirm <codeB>");
    return;
  }
  if (sub === "status") {
    const s = await api<PairingStatus>("/api/teams/pairing");
    console.log(`state=${s.state} teamId=${s.teamId || "-"}`);
    if (s.codeA) console.log(`vorlesen=${s.codeA}`);
    if (s.peerLabel) console.log(`peer=${s.peerLabel} (${s.peerInstanceId ?? "?"})`);
    if (s.inviteText) console.log(`invite=\n${s.inviteText}`);
    if (s.error) console.log(`error=${s.error}`);
    return;
  }
  if (sub === "join") {
    const inviteText = args[1] ?? usage();
    const label = flag(args, "--label") ?? "Mein Hub";
    const s = await api<PairingStatus>("/api/teams/join", {
      method: "POST",
      body: JSON.stringify({ inviteText, label }),
    });
    console.log(`state=${s.state}`);
    if (s.codeA) console.log(`vorlesen=${s.codeA}  (Partner tippt diesen Code)`);
    console.log("Danach: Partner liest Code A vor → hubctl team confirm <codeA>");
    return;
  }
  if (sub === "confirm") {
    const code = args[1] ?? usage();
    // Einladende Seite behält inviteText im Status; Beitretende nicht.
    const before = await api<PairingStatus>("/api/teams/pairing");
    const confirmPath = before.inviteText
      ? "/api/teams/pairings/current/confirm"
      : "/api/teams/join/confirm";
    const s = await api<PairingStatus>(confirmPath, {
      method: "POST",
      body: JSON.stringify({ code }),
    });
    console.log(`state=${s.state}${s.error ? ` error=${s.error}` : ""}`);
    return;
  }
  if (sub === "complete") {
    const result = await api<{ ok: boolean; pins: number }>("/api/teams/pairings/current/complete", {
      method: "POST",
      body: "{}",
    });
    console.log(`ok=${result.ok} pins=${result.pins}`);
    return;
  }
  if (sub === "pins") {
    const result = await api<{ pins: { instanceId: string; spkiSha256: string; state: string; pinnedAt: string }[] }>("/api/teams/pins");
    if (result.pins.length === 0) {
      console.log("(keine Pins)");
      return;
    }
    for (const p of result.pins) {
      console.log(`${p.instanceId}  ${p.spkiSha256.slice(0, 12)}…  ${p.state}  pinned=${p.pinnedAt}`);
    }
    return;
  }
  usage();
}
