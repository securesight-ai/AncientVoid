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
interface StreamFrameView {
  turnId: string;
  stream: "assistant" | "thinking";
  seq: number;
  text: string;
  final: boolean;
}

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

  const open = () => {
    opts.onState(lastSeq === 0 ? "connecting" : "reconnecting");
    const proto = opts.url.startsWith("https") ? "wss" : "ws";
    const base = opts.url.replace(/^https?/, proto);
    const scope = opts.hostId ? `/api/hosts/${encodeURIComponent(opts.hostId)}` : "/api";
    socket = new WebSocket(`${base}${scope}/events/${opts.sessionId}/tail?token=${encodeURIComponent(opts.token)}`);

    socket.onopen = () => {
      backoffMs = 500;
      socket?.send(JSON.stringify({ type: "hello", lastSeq }));
    };

    socket.onmessage = (msg) => {
      try {
        const data = JSON.parse(String(msg.data)) as
          | { type: "events"; events: NormalizedEvent[]; highWater: number; dropped: boolean; baseline?: boolean }
          | { type: "welcome"; lastSeq: number }
          | { type: "error"; message: string }
          | { type: "pong" }
          | { type: "stream"; sessionId: string; frames: StreamFrameView[] };
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
      if (closedByUser) {
        opts.onState("closed");
        return;
      }
      setTimeout(open, backoffMs);
      backoffMs = Math.min(backoffMs * 2, 10_000);
    };
  };

  open();

  return {
    close() {
      closedByUser = true;
      if (resyncTimer) clearTimeout(resyncTimer);
      socket?.close();
    },
  };
}
