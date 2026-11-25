import { Swarm } from "@ancientvoid/contracts";
import { sha256Hex } from "../automations/automation-labels.ts";

export interface SwarmSnapshot {
  at: string;
  list: Swarm[];
}

/** K10: keine Token-Klartexte und kein Vermischen von Peer-/Geräteprojektionen (Muster automation-cache). */
export async function swarmCacheKey(scope: string, token: string): Promise<string> {
  return `ancientvoid.swarms.v1:${scope}:${await sha256Hex(token)}`;
}

export function readSwarmSnapshot(key: string): SwarmSnapshot | null {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (!raw || typeof raw !== "object") return null;
    const data = raw as Record<string, unknown>;
    if (typeof data.at !== "string" || !Number.isFinite(Date.parse(data.at))) return null;
    return { at: data.at, list: Swarm.array().parse(data.list) };
  } catch (err) {
    console.warn("Swarms-Offlinekopie nicht lesbar", err);
    return null;
  }
}

export function writeSwarmSnapshot(key: string, snapshot: SwarmSnapshot): void {
  try {
    localStorage.setItem(key, JSON.stringify(snapshot));
  } catch (err) {
    console.warn("Swarms-Offlinekopie nicht speicherbar", err);
  }
}
