import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import {
  MAX_WS_BUFFER,
  WS_HISTORY_EVENTS,
  WsClientMessage,
  type NormalizedEvent,
  type WsServerMessage,
} from "@ancientvoid/contracts";
import type { SessionManager } from "@ancientvoid/core";
import type { HubMetrics } from "@ancientvoid/contracts";
import type { TailAccess } from "./tail-access.ts";

/**
 * BUG-0007: a socket that can't drain fast enough (throttled network, not
 * just an in-process producer/consumer mismatch) never fills the in-process
 * `buffer` array — `socket.send()` returns immediately regardless of real
 * transport speed. Verified via real Playwright + CDP network throttling:
 * with a 20kbit/s downlink, hundreds of events vanished with `dropped`
 * staying `false` throughout. `socket.bufferedAmount` (queued, unsent bytes)
 * is the actual backpressure signal and must be checked too.
 */
const MAX_WS_BUFFERED_BYTES = 64 * 1024;

/**
 * WS delta protocol (ADR-P0-4):
 *  - Server sends numbered event batches with a highWater seq.
 *  - Client detects gaps (highWater jumps) and requests {type:"resync", since}.
 *  - Drop-on-slow: per-socket buffer capped at MAX_WS_BUFFER (100) events OR
 *    MAX_WS_BUFFERED_BYTES (64KB) unsent on the socket. Either condition
 *    collapses the queue to the latest state and flags the next batch
 *    dropped:true — the client resyncs from the store. No backpressure
 *    lag, ever (K2), and no silent loss under a slow real network.
 */
export function createTailHandler(sessions: SessionManager, metrics?: HubMetrics) {
  return (socket: WebSocket, req: { params: unknown }) => {
    metrics?.inc("ws_connects");
    const sessionId = (req.params as { id: string }).id;
    const send = (msg: WsServerMessage) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
    };

    if (!sessions.get(sessionId)) {
      send({ type: "error", message: "unknown session" });
      socket.close();
      return;
    }

    let dropped = false;
    let buffer: NormalizedEvent[] = [];
    let flushing = false;
    // While history is being sent, live events wait in `buffer`.
    let replaying = false;

    const flush = async () => {
      if (flushing || replaying || buffer.length === 0) return;
      flushing = true;
      try {
        while (buffer.length > 0) {
          if (socket.bufferedAmount > MAX_WS_BUFFERED_BYTES) {
            // The socket already has more queued than it can drain — piling
            // on more unsent bytes only grows server memory. Collapse to
            // the latest state, flag it, and retry on the next flush
            // (triggered by the next incoming event).
            const last = buffer[buffer.length - 1]!;
            buffer = [last];
            dropped = true;
            metrics?.inc("ws_drops");
            break;
          }
          const batch = buffer;
          buffer = [];
          const last = batch[batch.length - 1]!;
          send({
            type: "events",
            sessionId,
            events: batch,
            highWater: last.seq,
            dropped,
          });
          dropped = false;
          // Yield to the event loop between batches.
          await new Promise((r) => setImmediate(r));
        }
      } finally {
        flushing = false;
      }
    };

    const unsubscribe = sessions.subscribe(sessionId, (events) => {
      if (buffer.length + events.length > MAX_WS_BUFFER) {
        // Drop oldest to keep the newest MAX_WS_BUFFER events; flag consumer.
        buffer = [...buffer, ...events].slice(-MAX_WS_BUFFER);
        dropped = true;
        metrics?.inc("ws_drops");
      } else {
        buffer.push(...events);
      }
      void flush();
    });

    // ADR-0083: transiente Live-Frames (echtes Streaming). Während des Replay werden
    // Frames verworfen — sie werden nie nachgeliefert, der Block holt alles ein.
    const unsubscribeFrames = sessions.subscribeFrames(sessionId, (frames) => {
      if (replaying) return;
      send(frames);
    });

    /** Sends every stored event after `from` in pages, then lets the live
     * buffer (minus what the pages already covered) go out. */
    const replay = async (from: number, baseline: boolean): Promise<number> => {
      replaying = true;
      let since = from;
      try {
        for (let first = true; ; first = false) {
          const page = await sessions.tail(sessionId, since, MAX_WS_BUFFER);
          if (page.length === 0) break;
          since = page[page.length - 1]!.seq;
          send({
            type: "events",
            sessionId,
            events: page,
            highWater: since,
            dropped: false,
            ...(first && baseline ? { baseline: true } : {}),
          });
          if (page.length < MAX_WS_BUFFER) break;
        }
      } finally {
        replaying = false;
      }
      buffer = buffer.filter((event) => event.seq > since);
      dropped = false;
      void flush();
      return since;
    };

    socket.on("message", async (raw: Buffer) => {
      let parsed: WsClientMessage;
      try {
        parsed = WsClientMessage.parse(JSON.parse(raw.toString()));
      } catch {
        send({ type: "error", message: "invalid message" });
        return;
      }
      switch (parsed.type) {
        case "hello": {
          // BUG-0026: one page used to be all a view ever got — the oldest
          // 100 events, never the end. Now: the newest WS_HISTORY_EVENTS
          // (or everything after the client's lastSeq), page by page.
          const last = sessions.get(sessionId)?.lastSeq ?? 0;
          const from = parsed.lastSeq === 0 ? Math.max(0, last - WS_HISTORY_EVENTS) : parsed.lastSeq;
          const reached = await replay(from, parsed.lastSeq === 0 && from > 0);
          if (reached === from) {
            send({ type: "welcome", sessionId, lastSeq: from, serverTime: new Date().toISOString() });
          }
          break;
        }
        case "resync": {
          // Läuft schon ein Replay, liefert der alle Events — ein weiterer
          // würde nur dieselben Seiten nochmal lesen.
          if (replaying) break;
          await replay(parsed.since, false);
          break;
        }
        case "ping":
          send({ type: "pong" });
          break;
        default: {
          const _exhaustive: never = parsed;
          send({ type: "error", message: `unhandled message type: ${String(_exhaustive)}` });
        }
      }
    });

    socket.on("close", () => {
      metrics?.inc("ws_disconnects");
      unsubscribe();
      unsubscribeFrames();
    });
  };
}

export function registerWs(app: FastifyInstance, sessions: SessionManager, access: TailAccess, metrics?: HubMetrics): void {
  const handle = createTailHandler(sessions, metrics);
  access.registerTicket(app, "/api/events/:id/tail", (req) =>
    sessions.get((req.params as { id: string }).id) ? null : "unknown session");
  app.get("/api/events/:id/tail", { websocket: true, config: { sessionTail: "upgrade" } }, (socket, req) => {
    if (access.authorize(socket, req)) handle(socket, req);
  });
}
