import { t } from "../../shared/i18n/index.ts";
import { useEffect, useRef, useState } from "preact/hooks";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { hubApi, type TerminalTarget } from "../../shared/api.ts";
import { Button, EmptyState } from "../../shared/ui/index.ts";
import { TERMINAL_CLOSE_END } from "@ancientvoid/contracts";

function cssColor(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

type ConnState = "idle" | "connecting" | "open" | "closed" | "error";

/** Letzte Hub-Sitzung: Tab verlassen trennt nur, Zurückkommen hängt wieder an. */
const LAST_KEY = "ancientvoid.terminal.last";
type LastSession = { target: string; session: string };

function readLast(): LastSession | null {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_KEY) ?? "null") as LastSession | null;
    return v && typeof v.target === "string" && typeof v.session === "string" ? v : null;
  } catch {
    return null;
  }
}

function writeLast(v: LastSession | null): void {
  if (v) localStorage.setItem(LAST_KEY, JSON.stringify(v));
  else localStorage.removeItem(LAST_KEY);
}

/**
 * ADR-0087: Allowlist-Terminals über Hub-SSH/`script`.
 * Ohne Config: Hinweis. Mit Ziel: xterm + Ticket-WebSocket.
 */
export function TerminalPage() {
  const [targets, setTargets] = useState<TerminalTarget[] | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [state, setState] = useState<ConnState>("idle");
  const [error, setError] = useState<string | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const dataDispRef = useRef<{ dispose(): void } | null>(null);
  const connectRef = useRef<(target: string) => Promise<void>>(async () => {});

  useEffect(() => {
    let alive = true;
    void hubApi.terminals()
      .then((list) => {
        if (!alive) return;
        setTargets(list.terminals);
        const last = readLast();
        const resume = last && list.terminals.some((t) => t.id === last.target) ? last : null;
        if (resume) {
          setSelected(resume.target);
          void connectRef.current(resume.target);
        } else if (list.terminals[0]) setSelected(list.terminals[0].id);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setTargets([]);
        setError(err instanceof Error ? err.message : "Liste nicht ladbar");
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: cssColor("--font-mono", "ui-monospace, monospace"),
      fontSize: 13,
      theme: {
        background: cssColor("--bg", "#0d1117"),
        foreground: cssColor("--fg", "#e6edf3"),
        cursor: cssColor("--fg", "#e6edf3"),
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;
    const onResize = () => fit.fit();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      wsRef.current?.close();
      wsRef.current = null;
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  /** Beendet die Shell im Hub; bloßes Verlassen des Tabs trennt nur. */
  const endSession = () => {
    dataDispRef.current?.dispose();
    dataDispRef.current = null;
    wsRef.current?.close(TERMINAL_CLOSE_END, "end");
    wsRef.current = null;
    writeLast(null);
    setState("closed");
  };

  const connect = async (target: string) => {
    if (!target || !termRef.current) return;
    setError(null);
    setState("connecting");
    termRef.current.reset();
    dataDispRef.current?.dispose();
    dataDispRef.current = null;
    wsRef.current?.close();
    try {
      fitRef.current?.fit();
      const cols = termRef.current.cols;
      const rows = termRef.current.rows;
      const last = readLast();
      const resume = last?.target === target ? last.session : undefined;
      const { ticket } = await hubApi.terminalTicket(target);
      const ws = new WebSocket(hubApi.terminalStreamUrl(target, ticket, cols, rows, resume));
      wsRef.current = ws;
      ws.addEventListener("open", () => {
        setState("open");
        termRef.current?.focus();
      });
      ws.addEventListener("message", (ev) => {
        try {
          const frame = JSON.parse(String(ev.data)) as { t: string; d?: string; m?: string; code?: number; id?: string };
          if (frame.t === "o" && frame.d) termRef.current?.write(frame.d);
          else if (frame.t === "s" && frame.id) writeLast({ target, session: frame.id });
          else if (frame.t === "e") {
            setError(frame.m ?? "Fehler");
            setState("error");
          } else if (frame.t === "x") {
            termRef.current?.writeln(`\r\n[exit ${frame.code ?? "?"}]`);
            writeLast(null);
            setState("closed");
          }
        } catch {
          /* ignore malformed */
        }
      });
      ws.addEventListener("close", () => {
        if (wsRef.current === ws) {
          wsRef.current = null;
          setState((s) => (s === "open" || s === "connecting" ? "closed" : s));
        }
      });
      ws.addEventListener("error", () => {
        setError("WebSocket-Fehler");
        setState("error");
      });
      dataDispRef.current = termRef.current.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "i", d: data }));
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verbindung fehlgeschlagen");
      setState("error");
    }
  };

  connectRef.current = connect;

  // Zurück in die App (Handy war im Hintergrund): getrennte Sitzung wieder anhängen.
  useEffect(() => {
    const onVisible = () => {
      const last = readLast();
      if (document.visibilityState === "visible" && !wsRef.current && last) {
        setSelected(last.target);
        void connectRef.current(last.target);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const empty = targets !== null && targets.length === 0;

  return (
    <div class="terminal-page" data-testid="terminal-page">
      <header class="terminal-toolbar">
        <label class="terminal-target">
          <span class="sr-only">{t("newsession.target")}</span>
          <select
            value={selected}
            disabled={!targets?.length || state === "connecting" || state === "open"}
            onChange={(e) => setSelected((e.target as HTMLSelectElement).value)}
            aria-label={t("terminal.terminal_target")}
          >
            {(targets ?? []).map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
            {empty && <option value="">{t("terminal.no_targets2")}</option>}
          </select>
        </label>
        {state === "open" || state === "connecting" ? (
          <Button onClick={endSession} disabled={state === "connecting"}>{t("terminal.quit")}</Button>
        ) : (
          <Button variant="primary" onClick={() => void connect(selected)} disabled={!selected || empty}>
            {t("common.connect")}
          </Button>
        )}
        <span class="terminal-state dim" aria-live="polite">
          {state === "idle" && "bereit"}
          {state === "connecting" && "verbinde…"}
          {state === "open" && "verbunden"}
          {state === "closed" && "getrennt"}
          {state === "error" && "Fehler"}
        </span>
      </header>
      {empty && (
        <div data-testid="terminal-empty">
          <EmptyState text={t("terminal.no_targets")} />
        </div>
      )}
      {error && <p class="ui-error" role="alert">{error}</p>}
      <div class="terminal-host" ref={hostRef} data-testid="terminal-xterm" />
    </div>
  );
}
