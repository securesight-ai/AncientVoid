import { z } from "zod";
import { NormalizedEvent } from "./event.ts";
import { WsStreamFrames } from "./stream.ts"; // ADR-0083

/**
 * WS delta protocol (ADR-P0-4): server sends numbered deltas, client detects
 * gaps and resyncs. Drop-on-slow: the server buffers at most
 * MAX_WS_BUFFER events per socket, then drops and flags a resync.
 */
export const WS_PROTOCOL_VERSION = 1;

export const MAX_WS_BUFFER = 100;
/** BUG-0026: history sent when a view opens — the newest this many events,
 * in pages of MAX_WS_BUFFER (the PWA keeps 500). */
export const WS_HISTORY_EVENTS = 500;

/** ADR-0124: single-use upgrade credential, scoped to the requested tail. */
export interface SessionTailTicket {
  ticket: string;
  expiresAt: number;
}

/** Client → server. */
export const WsClientMessage = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hello"),
    /** Highest seq the client knows; 0 = full tail from the beginning. */
    lastSeq: z.number().int().nonnegative().default(0),
  }),
  z.object({
    type: z.literal("resync"),
    since: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal("ping") }),
]);
export type WsClientMessage = z.infer<typeof WsClientMessage>;

/** Server → client. */
export const WsServerMessage = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("welcome"),
    sessionId: z.string(),
    lastSeq: z.number().int().nonnegative(),
    serverTime: z.string(),
  }),
  z.object({
    type: z.literal("events"),
    sessionId: z.string(),
    events: z.array(NormalizedEvent),
    /** Highest seq contained in this batch. */
    highWater: z.number().int().nonnegative(),
    /** true if events were dropped for a slow consumer → client must resync. */
    dropped: z.boolean().default(false),
    /** BUG-0026: first page of an opening view that starts after seq 1 —
     * not a gap, the client takes it as its starting point. */
    baseline: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("snapshot"),
    sessionId: z.string(),
    status: z.string(),
    lastSeq: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal("pong") }),
  z.object({ type: z.literal("error"), message: z.string() }),
  /** ADR-0083: transiente Live-Frames — laufen NICHT über die Event-Sequenz und
   * werden nie persistiert; eine Lücke ist kein Resync-Anlass (der Block holt auf). */
  WsStreamFrames,
]);
export type WsServerMessage = z.infer<typeof WsServerMessage>;
