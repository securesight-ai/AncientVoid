import { randomBytes } from "node:crypto";
import type { HubDatabase } from "../../platform/index.ts";
import { createHash } from "node:crypto";
import { DISPLAY_ANSWER_CAPABILITY, TOKEN_CAPABILITIES, actorKind } from "@ancientvoid/contracts";

export interface IssuedToken {
  token: string;
  label: string;
}

function readCapabilities(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((c): c is string => typeof c === "string") : [];
  } catch {
    // Unlesbar = keine Fähigkeit: nie mehr Rechte aus kaputten Daten.
    return [];
  }
}

/** sha256 of a raw device token — only the hash is stored. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export class TokenService {
  private readonly db: HubDatabase;

  /** The database this service lives in (fleet invites share it). */
  get database(): HubDatabase {
    return this.db;
  }

  constructor(db: HubDatabase) {
    this.db = db;
  }

  /** Issue a new device token. The plaintext is returned exactly once. */
  issue(label: string, capabilities: readonly string[] = []): IssuedToken {
    // ADR-0066: Fähigkeiten sind eine geschlossene Liste und an den Akteur gebunden.
    for (const c of capabilities) {
      if (!TOKEN_CAPABILITIES.includes(c)) throw new Error(`unknown token capability: ${c}`);
    }
    if (capabilities.includes(DISPLAY_ANSWER_CAPABILITY) && actorKind(label) !== "display") {
      throw new Error(`${DISPLAY_ANSWER_CAPABILITY} is only valid for display tokens`);
    }
    // EPIC-P62 T62.2: erkennbares Präfix — ein geleaktes Device-Token ist in
    // Text und Screenshot-OCR deterministisch findbar (check:media). Präfix
    // ist Teil des Plaintext; gespeichert bleibt wie bisher nur der sha256.
    const token = `avt_${randomBytes(24).toString("base64url")}`;
    this.db
      .prepare("INSERT INTO device_tokens (token_hash, label, created_at, capabilities) VALUES (?, ?, ?, ?)")
      .run(hashToken(token), label, new Date().toISOString(), capabilities.length > 0 ? JSON.stringify([...new Set(capabilities)]) : null);
    return { token, label };
  }

  /** Constant-time-ish verification; updates last_used_at on success. */
  verify(token: string): boolean {
    const row = this.db
      .prepare("SELECT token_hash FROM device_tokens WHERE token_hash = ?")
      .get(hashToken(token)) as { token_hash: string } | undefined;
    if (!row) return false;
    this.db
      .prepare("UPDATE device_tokens SET last_used_at = ? WHERE token_hash = ?")
      .run(new Date().toISOString(), row.token_hash);
    return true;
  }

  /** Revocation check without retaining the raw token or updating last_used_at. */
  hasHash(hash: string): boolean {
    return this.db.prepare("SELECT 1 FROM device_tokens WHERE token_hash = ?").get(hash) !== undefined;
  }

  /** T2.4: like `verify()`, but returns the matched token's label instead
   * of a bare boolean — used to attribute an approval decision to a real
   * device (`ApprovalRequest.decidedByLabel`) without ever persisting the
   * raw token itself. */
  identify(token: string): { label: string; capabilities: string[] } | null {
    const row = this.db
      .prepare("SELECT label, capabilities FROM device_tokens WHERE token_hash = ?")
      .get(hashToken(token)) as { label: string; capabilities: string | null } | undefined;
    return row ? { label: row.label, capabilities: readCapabilities(row.capabilities) } : null;
  }

  list(): { label: string; createdAt: string; lastUsedAt: string | null; capabilities: string[] }[] {
    const rows = this.db
      .prepare("SELECT label, created_at, last_used_at, capabilities FROM device_tokens ORDER BY created_at")
      .all() as unknown as { label: string; created_at: string; last_used_at: string | null; capabilities: string | null }[];
    // Spaltennamen mappen, nicht nur casten — sonst ist lastUsedAt immer undefined (aufgefallen am Verbindungs-Status).
    return rows.map((r) => ({ label: r.label, createdAt: r.created_at, lastUsedAt: r.last_used_at, capabilities: readCapabilities(r.capabilities) }));
  }

  revoke(label: string): number {
    const res = this.db.prepare("DELETE FROM device_tokens WHERE label = ?").run(label);
    return Number(res.changes);
  }
}
