import { t } from "../../shared/i18n/index.ts";
import { useEffect, useRef, useState } from "preact/hooks";
import type { BrowserPick, BrowserStatus, BrowserTestRun, BrowserViewportName } from "@ancientvoid/contracts";
import { hubApi, remoteHost } from "../../shared/api.ts";
import { openWorkspaceContent } from "../workspace/open-content.ts";
import { openPopout } from "../windows/windows.ts";
import { getHubStatus } from "../shell/hub-status.ts";
import { onLayerOpen } from "../../shared/layers.ts";
import { EXAMPLE_TEST, TEST_STATE_LABEL, parseTestCase, toViewportPoint } from "./browser-model.ts";
import { addSource } from "../../shared/sources.ts";
import { browserHash } from "../../app/route.ts";
import { projectName } from "../../shared/project-name.ts";
import { Button, Chip, EmptyState } from "../../shared/ui/index.ts";

type Tab = "view" | "tests" | "log";

/**
 * EPIC-P39 T39.3–T39.5 (ADR-0059): Browser-Panel. Chromium läuft auf dem Host der Session, die PWA zeigt nur ein
 * begrenztes Standbild und schickt Aktionen. Der Host-/Sessionbezug steht immer im Kopf; offline bleibt das letzte
 * Bild mit Zeitstempel sichtbar, die Eingabe ist gesperrt.
 */
export function BrowserLayer({ focusedSessionId }: { focusedSessionId: string | null }) {
  const [open, setOpen] = useState(false);
  // EPIC-P43: geöffnet aus „Mehr“ der Session (keine Randlasche mehr über dem Inhalt).
  useEffect(() => onLayerOpen("browser", () => setOpen(true)), []);
  const session = focusedSessionId ? getHubStatus().sessions.find((s) => s.id === focusedSessionId) : undefined;
  return (
    <>
      {open && <BrowserPanel sessionId={focusedSessionId} label={session ? (session.title ?? projectName(session.project) ?? session.id.slice(0, 8)) : null} hostId={session?.hostId ?? null} onClose={() => setOpen(false)} />}
    </>
  );
}

export function BrowserPanel({ sessionId, label, hostId, onClose }: { sessionId: string | null; label: string | null; hostId: string | null; onClose: () => void }) {
  const [status, setStatus] = useState<BrowserStatus | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("view");
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const remote = Boolean(remoteHost(hostId));

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const refresh = () => {
    if (!sessionId || remote) return Promise.resolve();
    return hubApi.browserStatus(sessionId).then(setStatus).catch((err) => setError(err instanceof Error ? err.message : "Status nicht lesbar"));
  };
  useEffect(() => {
    void refresh();
    if (!sessionId || remote) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible" && navigator.onLine) void refresh(); }, 2000);
    return () => clearInterval(timer);
  }, [sessionId, remote]);

  const run = async (fn: () => Promise<BrowserStatus>) => {
    setBusy(true);
    setError("");
    try {
      setStatus(await fn());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Aktion fehlgeschlagen");
      void refresh();
    } finally {
      setBusy(false);
    }
  };

  const head = (
    <div class="browser-head">
      <strong>{t("session.browser")}</strong>
      <span class="dim" data-testid="browser-context">
        {sessionId ? `Session „${label ?? sessionId.slice(0, 8)}“ · ${remote ? "andere Maschine" : "dieser Host"}` : "keine Session fokussiert"}
      </span>
      {sessionId && !remote && (
        <Chip
          aria-label={t("browser.browser_own_window")}
          title={t("session.in_own_window")}
          onClick={() => void openPopout({ kind: "browser", sessionId, ...(remoteHost(hostId) ? { hostId: remoteHost(hostId)! } : {}) })}
        >
          ⧉
        </Chip>
      )}
      <Chip onClick={onClose} aria-label={t("browser.browser_close")}>×</Chip>
    </div>
  );
  if (!sessionId) return <aside class="browser-panel" data-testid="browser-panel">{head}<EmptyState text={t("browser.focus_session_first")} /></aside>;
  if (remote) return <aside class="browser-panel" data-testid="browser-panel">{head}<div class="files-error" role="status">{t("browser.browser_host")}</div></aside>;

  const isOpen = status?.state === "open";
  return (
    <aside class="browser-panel" data-testid="browser-panel" aria-label={t("browser.browser_workspace")}>
      {head}
      {status?.state === "unavailable" && <div class="files-error" role="alert" data-testid="browser-unavailable">{t("browser.browser_unavailable")} {status.unavailableReason}</div>}
      {error && <div class="files-error" role="alert">{error}</div>}
      {!online && <div class="files-stale" role="status">{t("browser.offline_last")}</div>}
      <div class="browser-bar">
        <UrlBar status={status} disabled={busy || !online} onOpen={(url) => run(() => hubApi.browserOpen(sessionId, url || undefined))} onNavigate={(url) => run(() => (isOpen ? hubApi.browserAction(sessionId, { type: "navigate", url }) : hubApi.browserOpen(sessionId, url)))} />
        {isOpen && (
          <>
            <Chip disabled={busy || !online || !status.canBack} aria-label={t("browser.back")} onClick={() => run(() => hubApi.browserAction(sessionId, { type: "back" }))}>‹</Chip>
            <Chip disabled={busy || !online || !status.canForward} aria-label={t("browser.forward")} onClick={() => run(() => hubApi.browserAction(sessionId, { type: "forward" }))}>›</Chip>
            <Chip disabled={busy || !online} aria-label={t("browser.reload")} onClick={() => run(() => hubApi.browserAction(sessionId, { type: "reload" }))}>↻</Chip>
            <label class="dim" title={t("browser.host_window_size")}>
              {t("common.windows")}{" "}
              <select aria-label={t("browser.window_size")} value={status.viewport} disabled={busy || !online} onChange={(e) => run(() => hubApi.browserAction(sessionId, { type: "viewport", preset: (e.target as HTMLSelectElement).value as BrowserViewportName }))}>
                <option value="desktop">{t("browser.desktop_size")}</option>
                <option value="tablet">{t("browser.tablet_size")}</option>
                <option value="phone">{t("browser.narrow_size")}</option>
              </select>
            </label>
            <Chip onClick={() => run(() => hubApi.browserClose(sessionId))}>{t("common.close")}</Chip>
          </>
        )}
      </div>
      {status && <div class="dim" data-testid="browser-mode">{status.headless ? "Modus: unsichtbar (headless) — du siehst das Bild hier." : "Modus: sichtbares Chromium-Fenster auf dem Host — das Bild hier ist dasselbe Fenster."}</div>}
      {status && status.allowedOrigins.length > 0 && <div class="dim" data-testid="browser-origins">{t("browser.reachable")} {status.allowedOrigins.join(", ")}</div>}
      {status && status.allowedOrigins.length === 0 && <div class="dim">{t("browser.no_shared_target")}</div>}
      <div class="browser-tabs" role="tablist">
        {(["view", "tests", "log"] as const).map((t) => (
          <Chip key={t} role="tab" aria-selected={tab === t}  onClick={() => setTab(t)} active={tab === t}>
            {t === "view" ? "Ansicht" : t === "tests" ? "Tests" : `Konsole${status?.log.length ? ` (${status.log.length})` : ""}`}
          </Chip>
        ))}
      </div>
      {tab === "view" && <Viewport sessionId={sessionId} hostId={remoteHost(hostId)} status={status} online={online} busy={busy} onStatus={setStatus} onError={setError} />}
      {tab === "tests" && <Tests sessionId={sessionId} online={online} />}
      {tab === "log" && (
        <ul class="browser-log" data-testid="browser-log">
          {(status?.log ?? []).map((l, k) => <li key={k} class={`log-${l.kind}`}><span class="dim">{l.kind}</span> {l.text}</li>)}
          {(status?.log.length ?? 0) === 0 && <li class="dim">{t("browser.no_errors")}</li>}
        </ul>
      )}
    </aside>
  );
}

function UrlBar({ status, disabled, onOpen, onNavigate }: { status: BrowserStatus | null; disabled: boolean; onOpen: (url: string) => void; onNavigate: (url: string) => void }) {
  const [text, setText] = useState("");
  useEffect(() => { if (status?.url) setText(status.url); }, [status?.url]);
  return (
    <form class="browser-url" onSubmit={(e) => { e.preventDefault(); if (text.trim()) onNavigate(text.trim()); else onOpen(""); }}>
      <input aria-label={t("browser.address")} placeholder={t("browser.path_or_port")} value={text} disabled={disabled} onInput={(e) => setText((e.target as HTMLInputElement).value)} />
      <Button type="submit" disabled={disabled}>{status?.state === "open" ? "Gehe zu" : "Browser starten"}</Button>
    </form>
  );
}

function Viewport({ sessionId, hostId, status, online, busy, onStatus, onError }: { sessionId: string; hostId: string | null; status: BrowserStatus | null; online: boolean; busy: boolean; onStatus: (s: BrowserStatus) => void; onError: (m: string) => void }) {
  const [frame, setFrame] = useState<{ url: string; at: Date } | null>(null);
  const [mode, setMode] = useState<"operate" | "pick">("operate");
  const [pick, setPick] = useState<BrowserPick | null>(null);
  const [typed, setTyped] = useState("");
  const img = useRef<HTMLImageElement>(null);
  const isOpen = status?.state === "open";

  useEffect(() => {
    if (!isOpen) { setFrame(null); return; }
    let alive = true;
    let last: string | null = null;
    const tick = async () => {
      if (!alive || document.visibilityState !== "visible" || !navigator.onLine) return;
      try {
        const url = await hubApi.browserFrame(sessionId);
        if (!alive) { if (url) URL.revokeObjectURL(url); return; }
        if (url) {
          if (last) URL.revokeObjectURL(last);
          last = url;
          setFrame({ url, at: new Date() });
        }
      } catch { /* nächster Tick; Offline-Zustand zeigt das letzte Bild */ }
    };
    void tick();
    const timer = setInterval(tick, 500);
    return () => { alive = false; clearInterval(timer); if (last) URL.revokeObjectURL(last); };
  }, [sessionId, isOpen]);

  const act = (action: Parameters<typeof hubApi.browserAction>[1]) => hubApi.browserAction(sessionId, action).then(onStatus).catch((err) => onError(err instanceof Error ? err.message : "Aktion fehlgeschlagen"));

  const onImageClick = async (e: MouseEvent) => {
    const el = img.current;
    if (!el || !online) return;
    const rect = el.getBoundingClientRect();
    const point = toViewportPoint({ x: e.clientX, y: e.clientY }, rect, { width: el.naturalWidth, height: el.naturalHeight });
    if (!point) return;
    if (mode === "pick") {
      try { setPick(await hubApi.browserPick(sessionId, point.x, point.y)); } catch (err) { onError(err instanceof Error ? err.message : "Auswahl fehlgeschlagen"); }
    } else await act({ type: "click", x: point.x, y: point.y });
  };

  if (!isOpen) return <EmptyState data-testid="browser-closed" text={t("browser.browser_closed")} />;
  return (
    <div >
      <div class="browser-tools">
        <label class="dim"><input type="radio" name="browser-mode" checked={mode === "operate"} onChange={() => setMode("operate")} /> {t("browser.operate")}</label>
        <label class="dim"><input type="radio" name="browser-mode" checked={mode === "pick"} onChange={() => setMode("pick")} /> {t("browser.select_element")}</label>
        <Chip disabled={!online} onClick={() => act({ type: "scroll", dy: -400 })} aria-label={t("browser.scroll_up")}>↑</Chip>
        <Chip disabled={!online} onClick={() => act({ type: "scroll", dy: 400 })} aria-label={t("browser.scroll_down")}>↓</Chip>
        {(["Enter", "Tab", "Escape", "Backspace"] as const).map((k) => <Chip key={k} disabled={!online} onClick={() => act({ type: "press", key: k })}>{k}</Chip>)}
        <Chip disabled={!frame} onClick={async () => { const u = await hubApi.browserBlobUrl(`/api/sessions/${sessionId}/browser/screenshot`); const a = document.createElement("a"); a.href = u; a.download = "browser.png"; a.click(); setTimeout(() => URL.revokeObjectURL(u), 10_000); }}>{t("browser.screenshot")}</Chip>
      </div>
      <form class="browser-type" onSubmit={(e) => { e.preventDefault(); if (typed) { void act({ type: "type", text: typed }); setTyped(""); } }}>
        <input aria-label={t("browser.type_text")} placeholder={t("browser.type_focused")} value={typed} disabled={!online || busy} maxLength={500} onInput={(e) => setTyped((e.target as HTMLInputElement).value)} />
        <Button type="submit" disabled={!online || !typed}>{t("browser.tap")}</Button>
      </form>
      {frame ? (
        <img ref={img} class={mode === "pick" ? "browser-frame picking" : "browser-frame"} data-testid="browser-frame" src={frame.url} alt={`Browser: ${status?.title ?? status?.url ?? ""}`} onClick={onImageClick} draggable={false} />
      ) : <div class="ui-empty">{t("browser.image_loading")}</div>}
      {frame && <div class="dim" data-testid="browser-frame-time">{t("browser.as_of")} {frame.at.toLocaleTimeString("de-DE")}{!online ? " (offline)" : ""}</div>}
      {pick && <PickCard sessionId={sessionId} pick={pick} hostId={hostId} onDone={() => setPick(null)} />}
    </div>
  );
}

function PickCard({ sessionId, pick, hostId, onDone }: { sessionId: string; pick: BrowserPick; hostId: string | null; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [shot, setShot] = useState(true);
  const [preview, setPreview] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const input = { pick, note, includeScreenshot: shot };
  return (
    <div class="browser-pick" data-testid="browser-pick">
      <div><strong>{`<${pick.tag}>`}</strong> <span class="mono">{pick.selector}</span></div>
      {pick.masked && <div class="files-stale" role="status">{t("browser.secret_field")}</div>}
      {pick.frame === "iframe" && <div class="dim">{t("browser.frame_only")}</div>}
      {pick.inShadowDom && <div class="dim">{t("browser.shadow_dom")}</div>}
      <div class="dim">{t("browser.source")} {pick.source ?? "nicht ermittelt (keine Source-Map ausgewertet)"}</div>
      {!pick.masked && pick.text && <div class="dim">{t("browser.text_quote")}{pick.text}“</div>}
      <input aria-label={t("browser.note_element")} placeholder={t("browser.what_change")} maxLength={2000} value={note} onInput={(e) => { setNote((e.target as HTMLInputElement).value); setPreview(null); }} />
      <label class="dim"><input type="checkbox" checked={shot} onChange={(e) => { setShot((e.target as HTMLInputElement).checked); setPreview(null); }} /> {t("browser.attach_element_screenshot")}</label>
      <div class="file-tools">
        <Button data-testid="browser-feedback-preview" onClick={() => hubApi.browserFeedbackPreview(sessionId, input).then((r) => setPreview(r.prompt)).catch((e) => setMsg(e instanceof Error ? e.message : "Vorschau fehlgeschlagen"))}>{t("browser.preview")}</Button>
        <Button
          data-testid="browser-pick-to-composer"
          onClick={() => {
            // EPIC-P43.5 T43.5-1: Befund als Quellenchip — Vorschau im Composer, bewusstes Senden.
            addSource(sessionId, {
              id: `test:${pick.selector}`,
              kind: "test",
              label: `Browser-Element <${pick.tag}> ${pick.selector}`,
              excerpt: note.trim() || pick.text || null,
              hash: browserHash(sessionId),
            });
            setMsg("Als Quelle im Composer — dort prüfen und mit dem nächsten Absenden mitgeben.");
            onDone();
            openWorkspaceContent({ sessionId, ...(hostId ? { hostId } : {}), content: { kind: "session", tab: "chat" } });
          }}
        >
          {t("browser.into_composer")}
        </Button>
        <Button data-testid="browser-feedback-send" disabled={!preview} onClick={() => hubApi.browserFeedbackSend(sessionId, { ...input, operationId: crypto.randomUUID() }).then(() => { setMsg("Gesendet."); onDone(); }).catch((e) => setMsg(e instanceof Error ? e.message : "Senden fehlgeschlagen"))}>{t("browser.send_session")}</Button>
        <Chip onClick={onDone}>{t("composer.discard")}</Chip>
      </div>
      {preview && <pre class="file-text" data-testid="browser-feedback-prompt">{preview}</pre>}
      {msg && <div class="dim" role="status">{msg}</div>}
    </div>
  );
}

function Tests({ sessionId, online }: { sessionId: string; online: boolean }) {
  const [runs, setRuns] = useState<BrowserTestRun[]>([]);
  const [text, setText] = useState(EXAMPLE_TEST);
  const [error, setError] = useState("");
  const [artifact, setArtifact] = useState<{ runId: string; url: string } | null>(null);
  const load = () => hubApi.browserTests(sessionId).then((r) => setRuns(r.runs)).catch(() => undefined);
  useEffect(() => {
    void load();
    const timer = setInterval(() => { if (navigator.onLine) void load(); }, 1500);
    return () => clearInterval(timer);
  }, [sessionId]);
  useEffect(() => () => { if (artifact) URL.revokeObjectURL(artifact.url); }, [artifact]);

  const start = async () => {
    const parsed = parseTestCase(text);
    if (!parsed.ok) return setError(parsed.error);
    setError("");
    try { await hubApi.browserRunTest(sessionId, parsed.test); void load(); } catch (err) { setError(err instanceof Error ? err.message : "Start fehlgeschlagen"); }
  };
  return (
    <div  data-testid="browser-tests">
      <div class="dim file-note">{t("browser.registered_steps")}</div>
      <textarea class="browser-test-editor mono" aria-label={t("browser.test_case_json")} rows={10} spellcheck={false} value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
      {error && <div class="files-error" role="alert">{error}</div>}
      <Button disabled={!online} data-testid="browser-test-start" onClick={start}>{t("browser.start_test")}</Button>
      <ul class="browser-runs">
        {runs.map((r) => (
          <li key={r.id} data-testid="browser-run" data-state={r.state}>
            <strong>{r.name}</strong> · <span class={`run-${r.state}`}>{TEST_STATE_LABEL[r.state]}</span> <span class="dim">({r.viewport})</span>
            {r.state === "running" && <Chip onClick={() => hubApi.browserAbortTest(sessionId, r.id).then(load)}>{t("common.cancel")}</Chip>}
            {r.note && <div class="dim">{r.note}</div>}
            <ol class="dim">{r.steps.map((s) => <li key={s.index}>{s.ok ? "✓" : "✗"} {s.type}{s.detail ? ` — ${s.detail}` : ""}</li>)}</ol>
            {r.artifact && <Chip onClick={async () => setArtifact({ runId: r.id, url: await hubApi.browserBlobUrl(`/api/sessions/${sessionId}/browser/tests/${r.id}/artifact`) })}>{t("browser.screenshot")}</Chip>}
            {artifact?.runId === r.id && <img class="file-media" src={artifact.url} alt={`Screenshot von ${r.name}`} />}
          </li>
        ))}
        {runs.length === 0 && <li class="dim">{t("browser.no_runs")}</li>}
      </ul>
    </div>
  );
}
