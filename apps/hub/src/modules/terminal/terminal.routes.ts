import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  TERMINAL_BACKLOG_CHARS,
  TERMINAL_CLOSE_END,
  TERMINAL_DETACH_TTL_MS,
  TERMINAL_MAX_ACTIVE,
  TERMINAL_MAX_PENDING_TICKETS,
  TERMINAL_TICKET_TTL_MS,
  type TerminalFrame,
  type TerminalList,
  type TerminalTicket,
} from "@ancientvoid/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import WebSocket, { type RawData } from "ws";
import { extractToken } from "../../platform/auth.ts";
import { StreamTickets } from "../../platform/stream-tickets.ts";

export interface TerminalConfigEntry {
  id: string;
  label: string;
  ssh?: string;
  local?: boolean;
  /** Pfad oder Name der Shell für lokale Ziele (Default bash, ADR-0087 Nachtrag). */
  shell?: string;
}

function send(socket: WebSocket, frame: TerminalFrame): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame));
}

function parseFrame(raw: RawData): TerminalFrame | null {
  try {
    const text = Buffer.isBuffer(raw)
      ? raw.toString("utf8")
      : Array.isArray(raw)
        ? Buffer.concat(raw).toString("utf8")
        : Buffer.from(raw).toString("utf8");
    const parsed = JSON.parse(text) as TerminalFrame;
    if (!parsed || typeof parsed !== "object" || !("t" in parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function spawnShell(
  target: TerminalConfigEntry,
  cols: number,
  rows: number,
): ChildProcessWithoutNullStreams {
  const env = {
    ...process.env,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    COLUMNS: String(cols),
    LINES: String(rows),
  };
  if (target.local) {
    // Kein node-pty: `script` allokiert ein PTY ohne natives Addon (Linux).
    // Login-Flag nur, wo die Shell eines kennt (bash/zsh); dash & co. brechen sonst.
    const shell = target.shell ?? "bash";
    const name = shell.split("/").pop() ?? shell;
    const cmd = name === "bash" || name === "zsh" ? `${shell} -l` : shell;
    return spawn("script", ["-qfc", cmd, "/dev/null"], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
  }
  const host = target.ssh!;
  return spawn("ssh", ["-tt", "-o", "BatchMode=yes", host], {
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

interface TerminalSession {
  id: string;
  targetId: string;
  child: ChildProcessWithoutNullStreams;
  /** Letzte Ausgabe; beim Wiederverbinden erneut gesendet. */
  backlog: string;
  socket: WebSocket | null;
  /** Läuft, solange niemand verbunden ist (TERMINAL_DETACH_TTL_MS). */
  reaper: NodeJS.Timeout | null;
  lastSeen: number;
}

const REPLAY_CHUNK = 16_000;

/**
 * ADR-0087: Allowlist-Terminals über Ticket-WebSocket.
 * Ohne Config: leere Liste. Spawn nur für konfigurierte ids.
 * Nachtrag: Die Shell gehört einer Hub-Sitzung, nicht der WebSocket —
 * Trennen hängt nur ab, `?session=<id>` hängt wieder an.
 */
export function registerTerminalRoutes(
  app: FastifyInstance,
  terminals: readonly TerminalConfigEntry[] = [],
): void {
  const byId = new Map(terminals.map((t) => [t.id, t]));
  const tickets = new StreamTickets<string>(TERMINAL_TICKET_TTL_MS, TERMINAL_MAX_PENDING_TICKETS);
  const sessions = new Map<string, TerminalSession>();

  const end = (session: TerminalSession): void => {
    sessions.delete(session.id);
    if (session.reaper) clearTimeout(session.reaper);
    session.reaper = null;
    const { child } = session;
    if (child.exitCode === null && !child.killed) {
      child.kill("SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, 2_000).unref();
    }
  };

  const detach = (session: TerminalSession): void => {
    session.socket = null;
    session.lastSeen = Date.now();
    if (session.reaper) clearTimeout(session.reaper);
    session.reaper = setTimeout(() => end(session), TERMINAL_DETACH_TTL_MS);
    session.reaper.unref();
  };

  /** Platz für eine neue Shell: notfalls die am längsten getrennte opfern. */
  const makeRoom = (): boolean => {
    if (sessions.size < TERMINAL_MAX_ACTIVE) return true;
    let oldest: TerminalSession | null = null;
    for (const s of sessions.values()) {
      if (!s.socket && (!oldest || s.lastSeen < oldest.lastSeen)) oldest = s;
    }
    if (!oldest) return false;
    end(oldest);
    return true;
  };

  const start = (target: TerminalConfigEntry, cols: number, rows: number): TerminalSession => {
    const child = spawnShell(target, cols, rows);
    const session: TerminalSession = {
      id: randomUUID(),
      targetId: target.id,
      child,
      backlog: "",
      socket: null,
      reaper: null,
      lastSeen: Date.now(),
    };
    sessions.set(session.id, session);
    const onOutput = (buf: Buffer): void => {
      const d = buf.toString("utf8");
      session.backlog = (session.backlog + d).slice(-TERMINAL_BACKLOG_CHARS);
      if (session.socket) send(session.socket, { t: "o", d });
    };
    child.stdout.on("data", onOutput);
    child.stderr.on("data", onOutput);
    child.on("error", (err) => {
      if (session.socket) {
        send(session.socket, { t: "e", m: err.message.slice(0, 200) });
        session.socket.close(1011, "child error");
      }
      end(session);
    });
    child.on("close", (code) => {
      const socket = session.socket;
      session.socket = null;
      if (socket) {
        send(socket, { t: "x", code: code ?? -1 });
        if (socket.readyState === WebSocket.OPEN) socket.close(1000, "exit");
      }
      end(session);
    });
    return session;
  };

  const attach = (session: TerminalSession, browser: WebSocket): void => {
    const previous = session.socket;
    session.socket = browser;
    if (session.reaper) clearTimeout(session.reaper);
    session.reaper = null;
    if (previous && previous !== browser) previous.close(4409, "terminal taken over");
    send(browser, { t: "s", id: session.id });
    for (let i = 0; i < session.backlog.length; i += REPLAY_CHUNK) {
      send(browser, { t: "o", d: session.backlog.slice(i, i + REPLAY_CHUNK) });
    }
    browser.on("message", (raw) => {
      const frame = parseFrame(raw);
      if (!frame || session.socket !== browser || !session.child.stdin.writable) return;
      if (frame.t === "i") session.child.stdin.write(frame.d);
      // Resize ohne node-pty: nur Start-COLUMNS/LINES; Hinweis ignorieren (ADR-0087).
    });
    browser.on("close", (code) => {
      if (session.socket !== browser) return;
      if (code === TERMINAL_CLOSE_END) end(session);
      else detach(session);
    });
    browser.on("error", () => {
      if (session.socket === browser) detach(session);
    });
  };

  app.addHook("preClose", async () => {
    tickets.clear();
    for (const session of [...sessions.values()]) end(session);
  });

  app.get("/api/terminals", async (): Promise<TerminalList> => ({
    terminals: terminals.map(({ id, label, ssh, local }) => ({
      id,
      label,
      ...(ssh ? { ssh } : {}),
      ...(local ? { local: true } : {}),
    })),
  }));

  app.post("/api/terminals/:id/ticket", async (req: FastifyRequest, reply) => {
    const id = (req.params as { id?: string }).id ?? "";
    if (!byId.has(id)) return reply.code(404).send({ error: "Unbekanntes Terminal-Ziel." });
    const token = extractToken(req);
    if (!token) return reply.code(401).send({ error: "device token required" });
    const result: TerminalTicket | undefined = tickets.issue(id);
    if (!result) return reply.code(503).send({ error: "Zu viele offene Terminal-Tickets." });
    return reply.header("cache-control", "no-store").code(201).send(result);
  });

  app.get("/api/terminals/:id/stream", { websocket: true }, (browser, req) => {
    const id = (req.params as { id?: string }).id ?? "";
    const target = byId.get(id);
    const query = req.query as { ticket?: unknown; cols?: unknown; rows?: unknown; session?: unknown } | undefined;
    if (!target || !tickets.consume(query?.ticket, (targetId) => targetId === id)) {
      browser.close(4401, "invalid or expired terminal ticket");
      return;
    }

    const resume = typeof query?.session === "string" ? sessions.get(query.session) : undefined;
    if (resume && resume.targetId === id) {
      attach(resume, browser);
      return;
    }
    if (!makeRoom()) {
      browser.close(1013, "too many terminal streams");
      return;
    }
    const cols = Math.min(300, Math.max(20, Number(query?.cols) || 80));
    const rows = Math.min(120, Math.max(8, Number(query?.rows) || 24));
    let session: TerminalSession;
    try {
      session = start(target, cols, rows);
    } catch (err) {
      send(browser, { t: "e", m: err instanceof Error ? err.message : "spawn failed" });
      browser.close(1011, "spawn failed");
      return;
    }
    attach(session, browser);
  });
}
