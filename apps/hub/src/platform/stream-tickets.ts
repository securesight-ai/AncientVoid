import { randomBytes } from "node:crypto";
import { hashToken } from "@ancientvoid/core";

interface Ticket {
  ticket: string;
  expiresAt: number;
}

/** A bounded, process-local store of credentials for one WebSocket upgrade. */
export class StreamTickets<T> {
  private readonly ttlMs: number;
  private readonly limit: number;
  private readonly pending = new Map<string, { value: T; expiresAt: number }>();

  constructor(ttlMs: number, limit: number) {
    this.ttlMs = ttlMs;
    this.limit = limit;
  }

  issue(value: T): Ticket | undefined {
    const now = Date.now();
    for (const [hash, entry] of this.pending) if (entry.expiresAt <= now) this.pending.delete(hash);
    if (this.pending.size >= this.limit) return;
    const ticket = randomBytes(32).toString("base64url");
    const expiresAt = now + this.ttlMs;
    this.pending.set(hashToken(ticket), { value, expiresAt });
    return { ticket, expiresAt };
  }

  consume(ticket: unknown, matches?: (value: T) => boolean): T | undefined {
    if (typeof ticket !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(ticket)) return;
    const hash = hashToken(ticket);
    const entry = this.pending.get(hash);
    if (!entry) return;
    if (entry.expiresAt <= Date.now()) {
      this.pending.delete(hash);
      return;
    }
    if (matches && !matches(entry.value)) return;
    this.pending.delete(hash);
    return entry.value;
  }

  clear(): void {
    this.pending.clear();
  }
}
