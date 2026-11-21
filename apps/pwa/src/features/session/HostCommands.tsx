import { useState } from "preact/hooks";
import { sessionHash } from "../../app/route.ts";
import { useApi } from "../../shared/api-context.ts";
import { projectName } from "../../shared/project-name.ts";
import { Button, Card } from "../../shared/ui/index.ts";
import { copyIntoShelf } from "../../shared/clipboard-copy.ts";

/**
 * Real user request (2026-09-19): "same session on the phone and my
 * desktop terminal" — this genuinely is the same worker process, not a
 * copy; typing in the attached tmux pane and watching it here (or vice
 * versa) both observe/drive the one real thing.
 *
 * Real, found-live caveat: for a one-shot/turn-based adapter (claude,
 * codex, opencode, copilot — a new CLI process per turn, not one
 * long-lived process for the whole session), the real tmux pane only
 * exists WHILE a turn is actively running; `TmuxRunner` cleans it up the
 * moment that turn's process exits (verified live: a session sat
 * "working" — genuinely waiting for the next prompt, not broken — with
 * no real tmux session left at all seconds after its last turn
 * finished). The command shown here is always real, correct syntax; it's
 * only actually attachable in that window. `tmux attach`'s own "session
 * not found" is an honest, self-explanatory outcome in that case — not a
 * fabricated promise, just said plainly rather than pretending it
 * always works.
 */
/** Copy button that says whether the copy really happened. */
function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    // ADR-0090: copied commands stay one level down in the local shelf.
    const ok = await copyIntoShelf(text, "befehl");
    setState(ok ? "copied" : "failed");
    setTimeout(() => setState("idle"), 1500);
  };
  return (
    <Button onClick={() => void copy()}>
      {state === "copied" ? "Kopiert" : state === "failed" ? "Bitte markieren" : "Kopieren"}
    </Button>
  );
}

function shellQuote(value: string): string {
  return /^[\w./=@%^+:-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

/** EPIC-P6 T6.6: a command for another host of the fleet runs there, via SSH
 * with the host id as name (the tailnet name of that machine). */
export function onHost(command: string, host: string | null): string {
  return host ? `ssh -t ${host} ${shellQuote(command)}` : command;
}

/** Changes of an isolated session are in its worktree, not the project
 * folder the editor shows — say so, and how to open it. */
export function WorktreeCard({
  sessionId,
  status,
  worktree,
  project,
  host = null,
  apply = true,
}: {
  sessionId: string;
  status: string;
  worktree: { path: string; branch: string };
  project: string;
  host?: string | null;
  /** EPIC-P43 T43.5: in „Änderungen“ steht „Ins Projekt übernehmen“ im Kopf, nicht ein zweites Mal hier. */
  apply?: boolean;
}) {
  const openInEditor = host ? `code --remote ssh-remote+${host} ${shellQuote(worktree.path)}` : `code ${shellQuote(worktree.path)}`;
  return (
    <Card data-testid="worktree-card">
      <div class="dim" style="font-size: calc(12px * var(--font-scale, 1)); margin-bottom: 6px">
        Die Änderungen dieser Session liegen in einem eigenen Git-Worktree{host ? ` auf ${host}` : ""}, nicht in {projectName(project)}.
        Branch <span class="mono">{worktree.branch}</span>.
      </div>
      <div class="attach-cmd-row">
        <code class="mono" data-testid="worktree-path">{worktree.path}</code>
        <CopyButton text={worktree.path} />
      </div>
      <div class="attach-cmd-row" style="margin-top: 6px">
        <code class="mono" data-testid="worktree-open">{openInEditor}</code>
        <CopyButton text={openInEditor} />
      </div>
      {apply && <ApplyToProject sessionId={sessionId} status={status} worktree={worktree} project={project} />}
    </Card>
  );
}

/** „Ins Projekt übernehmen“ mit Rückfrage — im Bericht als Taste, im Kopf von „Änderungen“ als Hauptaktion. */
export function ApplyToProject({
  sessionId,
  status,
  worktree,
  project,
  primary = false,
}: {
  sessionId: string;
  status: string;
  worktree: { path: string; branch: string };
  project: string;
  primary?: boolean;
}) {
  const api = useApi();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const running = status === "working" || status === "starting";
  const projectLabel = projectName(project);
  const apply = async () => {
    setBusy(true);
    try {
      const r = await api.applyToProject(sessionId);
      setResult(
        r.ok
          ? { ok: true, text: `Übernommen: ${r.files} Datei(en) nach ${r.into} (${r.commit}).` }
          : { ok: false, text: r.detail ?? "Übernehmen fehlgeschlagen." },
      );
    } catch (err) {
      setResult({ ok: false, text: err instanceof Error ? err.message : "Übernehmen fehlgeschlagen." });
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };
  return (
    <div class="apply-to-project">
      {confirming ? (
        <div class="apply-confirm">
          <div class="dim" style="font-size: calc(12px * var(--font-scale, 1))">
            Committet alle Änderungen auf {worktree.branch} und merged sie in den ausgecheckten Branch von {projectLabel}.
          </div>
          <div class="row" style="gap: 8px">
            <Button disabled={busy} onClick={() => void apply()} variant="primary" class={busy ? "busy" : undefined}>
              {busy ? "lädt…" : "Jetzt übernehmen"}
            </Button>
            <Button disabled={busy} onClick={() => setConfirming(false)}>
              Abbrechen
            </Button>
          </div>
        </div>
      ) : (
        <Button
          disabled={running}
          title={running ? "Erst nach dem laufenden Zug" : undefined}
          onClick={() => {
            setResult(null);
            setConfirming(true);
          }}
         variant="primary" class={primary ? "apply-btn" : "apply-btn"}>
          Ins Projekt übernehmen
        </Button>
      )}
      {result && <div class={result.ok ? "apply-result ok" : "apply-result reply-error"}>{result.text}</div>}
    </div>
  );
}

/**
 * BUG-0249: Deep-Link zur Session — nicht `location.href`. Am Desktop schreibt
 * `contentHash` bei Tabs ohne rekonstruierbare Route (z. B. „Bericht“) `#/` in
 * die Adresszeile; der Continue-Link muss trotzdem `#/sessions/<id>` tragen.
 */
export function continueSessionLink(sessionId: string, hostId?: string | null, origin = typeof location === "undefined" ? "" : location.origin): string {
  // origin ohne trailing slash; sessionHash ist `#/…` — E2E und location.href
  // erwarten `http://host/#/sessions/…` (Pfad `/` vor der Raute).
  return `${origin.replace(/\/$/, "")}${sessionHash(sessionId, hostId).replace(/^#/, "/#")}`;
}

/**
 * T5.5: continue elsewhere — the web link to this very session (AC-P5-5)
 * and, between turns, the native terminal command for the same provider
 * session on the PC. The hub hides the command while a turn runs, so hub
 * and terminal never write at the same time.
 */
export function ContinueCard({
  sessionId,
  hostId = null,
  openCmd,
  host = null,
}: {
  sessionId: string;
  hostId?: string | null;
  openCmd?: string | undefined;
  host?: string | null;
}) {
  const link = continueSessionLink(sessionId, hostId);
  return (
    <Card data-testid="continue-card">
      <div class="dim" style="font-size: calc(12px * var(--font-scale, 1)); margin-bottom: 6px">Weiterarbeiten auf einem anderen Gerät</div>
      <div class="attach-cmd-row">
        <code class="mono" data-testid="continue-link">{link}</code>
        <CopyButton text={link} />
      </div>
      {openCmd ? (
        <>
          <div class="dim" style="font-size: calc(12px * var(--font-scale, 1)); margin: 8px 0 6px">
            {host ? `Im Terminal, per SSH auf ${host}` : "Im Terminal am PC"}, dieselbe Provider-Session. Solange sie dort läuft, hier nichts senden.
          </div>
          <div class="attach-cmd-row">
            <code class="mono" data-testid="continue-open">{openCmd}</code>
            <CopyButton text={openCmd} />
          </div>
        </>
      ) : (
        <div class="dim" data-testid="continue-none" style="font-size: calc(11px * var(--font-scale, 1)); margin-top: 6px">
          Terminal-Befehl erscheint zwischen zwei Zügen, sobald die Provider-Session bekannt ist.
        </div>
      )}
    </Card>
  );
}

export function AttachCmdRow({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    // ADR-0090: ohne Clipboard-API bleibt der Befehl in der Ablage — nie ein toter Endpunkt.
    const ok = await copyIntoShelf(cmd, "befehl");
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };
  return (
    <Card data-testid="attach-cmd-card">
      <div class="dim" style="font-size: calc(12px * var(--font-scale, 1)); margin-bottom: 6px">
        Am Desktop weiterarbeiten — dieselbe Session, nicht eine Kopie. Funktioniert
        sicher, während der Agent gerade aktiv einen Zug ausführt; dazwischen evtl.
        „session not found", falls gerade kein Prozess läuft:
      </div>
      <div class="attach-cmd-row">
        <code class="mono">{cmd}</code>
        <Button onClick={copy}>
          {copied ? "Kopiert" : "Kopieren"}
        </Button>
      </div>
    </Card>
  );
}
