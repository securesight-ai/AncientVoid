import type { EmittedStreamFrame, SessionTailTicket } from "@ancientvoid/contracts";
import { newEvents, resyncDelayMs, shouldResync } from "./ws-protocol.ts";

/**
 * WS delta-protocol client (counterpart of apps/hub/src/ws.ts).
 * Tracks seq per session, detects gaps, resyncs from the store.
 * Reconnects with exponential backoff; reports connection state.
 */
export interface NormalizedEvent {
  seq: number;
  ts: string;
  sessionId: string;
  type: string;
  summary: string;
  payload: Record<string, unknown>;
  blobRef: string | null;
  tokensEst?: number;
  /** ADR-0004: Kontingent-Schnappschuss des Providers — Fenster mit
   * utilization/resetsAt, Grundlage der Limit-Wiederaufnahme (ADR-0076
   * Nachtrag). */
  usageQuota?: { windows: { id: string; utilization: number; resetsAt: string }[] };
}

export interface TailConnection {
  close(): void;
}

/** ADR-0083: transiente Live-Frames — kein Ereignis, nicht persistiert, kein seq des
 * Event-Protokolls. Eine Lücke ist hier ausdrücklich kein Resync-Anlass: der dauerhafte
 * Block holt alles ein. */
/** ADR-0083: dieselbe Rahmenform, die Hub und Adapter verwenden (`contracts`) — eine
 * Definition für Leitung und Anzeige, damit ein Feld nie nur auf einer Seite existiert. */
export type StreamFrameView = EmittedStreamFrame;

export interface TailOptions {
  url: string;
  token: string;
  sessionId: string;
  /** EPIC-P6: set for a session on another host of the fleet. */
  hostId?: string | null;
  onEvents: (events: NormalizedEvent[]) => void;
  /** ADR-0083: echtes Streaming — Teiltexte, bevor der Block eintrifft. */
  onFrames?: (frames: StreamFrameView[]) => void;
  onState: (state: "connecting" | "live" | "reconnecting" | "closed") => void;
}

export function connectTail(opts: TailOptions): TailConnection {
  let lastSeq = 0;
  let closedByUser = false;
  let socket: WebSocket | null = null;
  let backoffMs = 500;
  let resyncedFrom = -1;
  let resyncAttempts = 0;
  let resyncTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let ticketRequest: AbortController | undefined;
  const wsBase = opts.url.replace(/^http/, "ws");
  const scope = opts.hostId ? `/api/hosts/${encodeURIComponent(opts.hostId)}` : "/api";
  const path = `${scope}/events/${encodeURIComponent(opts.sessionId)}/tail`;

  const reconnect = () => {
    if (closedByUser) return;
    opts.onState("reconnecting");
    reconnectTimer = setTimeout(() => void open(), backoffMs);
    backoffMs = Math.min(backoffMs * 2, 10_000);
  };

  const open = async () => {
    if (closedByUser) return;
    const request = new AbortController();
    ticketRequest = request;
    const timeout = setTimeout(() => request.abort(), 10_000);
    try {
      const response = await fetch(`${opts.url}${path}-ticket`, {
        method: "POST",
        headers: { authorization: `Bearer ${opts.token}` },
        signal: request.signal,
      });
      if (closedByUser) return;
      if ([401, 403, 404].includes(response.status)) {
        opts.onState("closed");
        return;
      }
      if (!response.ok) {
        reconnect();
        return;
      }
      const { ticket } = (await response.json()) as SessionTailTicket;
      if (closedByUser) return;
      if (typeof ticket !== "string" || !ticket) throw new Error("missing tail ticket");
      socket = new WebSocket(`${wsBase}${path}?ticket=${encodeURIComponent(ticket)}`);
    } catch {
      reconnect();
      return;
    } finally {
      clearTimeout(timeout);
      ticketRequest = undefined;
    }

    socket.onopen = () => {
      socket?.send(JSON.stringify({ type: "hello", lastSeq }));
    };

    socket.onmessage = (msg) => {
      if (closedByUser) return;
      try {
        const data = JSON.parse(String(msg.data)) as
          | { type: "events"; events: NormalizedEvent[]; highWater: number; dropped: boolean; baseline?: boolean }
          | { type: "welcome"; lastSeq: number }
          | { type: "error"; message: string }
          | { type: "pong" }
          | { type: "stream"; sessionId: string; frames: StreamFrameView[] };
        if (data.type === "events" || data.type === "welcome") backoffMs = 500;
        if (data.type === "events") {
          // BUG-0026: an opening view starts at the newest history page.
          if (data.baseline && lastSeq === 0 && data.events[0]) lastSeq = data.events[0].seq - 1;
          const incoming = newEvents(lastSeq, data.events);
          const first = incoming[0];
          if (resyncedFrom !== lastSeq) {
            resyncedFrom = lastSeq;
            resyncAttempts = 0;
          }
          if (shouldResync(lastSeq, first?.seq, data.dropped, resyncAttempts)) {
            // Gap or dropped batch — resync from last known seq, with backoff and a bounded number of tries.
            if (!resyncTimer) {
              const since = lastSeq;
              resyncTimer = setTimeout(() => {
                resyncTimer = null;
                if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "resync", since }));
              }, resyncDelayMs(resyncAttempts));
              resyncAttempts++;
            }
            return;
          }
          if (incoming.length > 0) {
            lastSeq = incoming[incoming.length - 1]!.seq;
            resyncedFrom = -1;
            resyncAttempts = 0;
            opts.onState("live");
            opts.onEvents(incoming);
          }
        } else if (data.type === "welcome") {
          opts.onState("live");
        } else if (data.type === "stream") {
          opts.onFrames?.(data.frames);
        } else if (data.type === "error") {
          console.warn("[tail] server:", data.message);
        }
      } catch {
        // ignore malformed frame
      }
    };

    socket.onclose = () => {
      if (resyncTimer) clearTimeout(resyncTimer);
      resyncTimer = null;
      socket = null;
      reconnect();
    };
  };

  opts.onState("connecting");
  void open();

  return {
    close() {
      closedByUser = true;
      ticketRequest?.abort();
      clearTimeout(reconnectTimer);
      if (resyncTimer) clearTimeout(resyncTimer);
      socket?.close();
    },
  };
}
