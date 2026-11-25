import { t } from "../../shared/i18n/index.ts";
import { openWorkspaceContent } from "../workspace/open-content.ts";
import { readStatusNote, STATUS_NOTE_EVENT } from "../../shared/status-notes.ts";
import { jumpToSource, sourcesOf, SOURCES_EVENT } from "../../shared/sources.ts";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { hubApi, remoteHost, type CommandPlan, type StepResult } from "../../shared/api.ts";
import { commandContext, currentField, field, getHere, type FieldId } from "../../shared/command-context.ts";
import { pageHash, sessionHash, type ListPage } from "../../app/route.ts";
import { preselectProject } from "../new-session/CreateSession.tsx";
import { COMMANDS as EXAMPLES, QUICK_KIND_LABEL, quickMatches, type QuickSources, type QuickTarget } from "./quick.ts";
import { registerShortcut } from "../../shared/shortcuts/registry.ts";
import { useOverlayFocus } from "../../shared/overlay-focus.ts";
import { Button, Chip } from "../../shared/ui/index.ts";

const RISK_TEXT = { read: t("commands.read"), write: t("commands.change"), destructive: t("commands.destructive") } as const;
const TRANSFORM_TEXT: Record<string, string> = { correct: t("commands.tr_correct"), shorten: t("commands.tr_shorten"), translate_en: t("commands.tr_en"), translate_de: t("commands.tr_de"), improve: t("commands.tr_improve") };

/** A client step — navigation and fields live in the app, not on the hub. */
function runClientStep(c: Record<string, string | number | boolean | null>): string {
  const op = String(c.op);
  if (op === "nav.open") {
    location.hash = pageHash(String(c.page ?? "dashboard") as ListPage);
    return t("commands.opened");
  }
  if (op === "sessions.show") {
    sessionStorage.setItem("ancientvoid.overviewFilter", String(c.filter ?? "all"));
    window.dispatchEvent(new CustomEvent("ancientvoid:overview-filter", { detail: c.filter }));
    location.hash = pageHash("dashboard");
    return t("commands.filtered");
  }
  if (op === "session.open") {
    location.hash = sessionHash(String(c.sessionId), remoteHost(String(c.hostId ?? "")));
    return t("commands.opened");
  }
  if (op === "code.search") {
    sessionStorage.setItem("ancientvoid.pendingCodeSearch", JSON.stringify({ sessionId: c.sessionId, text: c.text }));
    location.hash = sessionHash(String(c.sessionId), remoteHost(String(c.hostId ?? "")));
    window.dispatchEvent(new CustomEvent("ancientvoid:code-search"));
    return t("commands.searched");
  }
  return "";
}

/** Open the command bar from anywhere. */
export function openCommandBar(): void {
  window.dispatchEvent(new CustomEvent("ancientvoid:command-bar"));
}

/**
 * T9.4 (ADR-0027): one text entry for the whole hub — Ctrl/Cmd+K or ✦.
 * Reading and navigating run at once; anything that changes something
 * shows its target and waits for "Ausführen". Approvals, passkeys and
 * secrets stay taps (the hub says so).
 */
export function CommandBar({ embedded = false, active = true, onClose }: { embedded?: boolean; active?: boolean; onClose?: () => void } = {}) {
  const [open, setOpen] = useState(embedded);
  const [text, setText] = useState("");
  const [plan, setPlan] = useState<CommandPlan | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [results, setResults] = useState<StepResult[] | null>(null);
  const [edit, setEdit] = useState<{ field: FieldId; before: string; after: string; label: string; applied: boolean } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  // EPIC-P43 T43.6: Schnellsuche — Sessions und Projekte einmal je Öffnen, die Treffer rechnet quick.ts.
  const [sources, setSources] = useState<Omit<QuickSources, "here">>({ sessions: [], projects: [] });
  const [, setSourceTick] = useState(0);
  const [selected, setSelected] = useState(-1);
  const here = getHere();
  const jumps = plan || results || edit ? [] : quickMatches(text, { ...sources, sourceRefs: sourcesOf(here.sessionId ?? "new"), notes: sources.sessions.flatMap(s => { const text = readStatusNote(s.id); return text ? [{ sessionId: s.id, hostId: s.hostId ?? null, text }] : []; }), here: here.sessionId ? { sessionId: here.sessionId, hostId: here.hostId } : null });

  useEffect(() => {
    if (!open || !active) return;
    let alive = true;
    // Wie App.tsx: die Flotte, sonst die Sessions dieses Hubs.
    void hubApi.fleet().then((f) => f.sessions).catch(() => hubApi.sessions()).then((sessions) => alive && setSources((s) => ({ ...s, sessions }))).catch(() => undefined);
    void hubApi.projects().then((r) => alive && setSources((s) => ({ ...s, projects: r.projects }))).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [open, active]);
  // Vor dem Zeichnen: sonst verwirft der Rücksetzer eine schon gedrückte Pfeiltaste.
  useLayoutEffect(() => setSelected(-1), [text]);
  useEffect(() => {
    const sync = () => setSourceTick(n => n + 1);
    window.addEventListener(SOURCES_EVENT, sync);
    window.addEventListener(STATUS_NOTE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener(SOURCES_EVENT, sync); window.removeEventListener(STATUS_NOTE_EVENT, sync); window.removeEventListener("storage", sync); };
  }, []);

  const jump = (t: QuickTarget) => {
    if (t.kind === "befehl") {
      setText(t.text);
      input.current?.focus();
      return;
    }
    if (!embedded) { setOpen(false); setText(""); }
    if (t.kind === "quelle") jumpToSource(t);
    else if (t.kind === "statusnotiz") {
      sessionStorage.setItem("ancientvoid.open-status-note", t.sessionId);
      runClientStep({ op: "session.open", sessionId: t.sessionId, hostId: t.hostId });
      window.dispatchEvent(new CustomEvent("ancientvoid:open-status-note"));
    }
    else if (t.kind === "session") runClientStep({ op: "session.open", sessionId: t.sessionId, hostId: t.hostId });
    else if (t.kind === "datei") runClientStep({ op: "code.search", sessionId: t.sessionId, hostId: t.hostId, text: t.text });
    else if (t.kind === "werkzeug") location.hash = t.hash ?? pageHash(t.page);
    else {
      preselectProject(t.path);
      location.hash = pageHash("new");
    }
  };

  // EPIC-P51 T51.5: Kürzel über die Registry (zentraler Dispatcher). Die
  // Registrierung lebt im useEffect mit [open] — der Handler sieht frischen State.
  // T51.6: Fokus rein/Tab-Falle/zurück (useOverlayFocus).
  const { ref: sheet } = useOverlayFocus<HTMLDivElement>(open && !embedded, { preferred: () => input.current });
  useEffect(() => {
    if (embedded) {
      if (!active) return;
      return registerShortcut("command.close", (e) => { e.preventDefault(); onClose?.(); });
    }
    const openGrid = () => openWorkspaceContent({ sessionId: "", content: { kind: "search" } });
    const openIt = () => { if (!openGrid()) setOpen(true); };
    window.addEventListener("ancientvoid:command-bar", openIt);
    const offToggle = registerShortcut("command.toggle", (e) => {
      e.preventDefault();
      if (!openGrid()) setOpen((o) => !o);
    });
    const offClose = open
      ? registerShortcut("command.close", (e) => {
          e.preventDefault();
          setOpen(false);
        })
      : null;
    return () => {
      window.removeEventListener("ancientvoid:command-bar", openIt);
      offToggle();
      offClose?.();
    };
  }, [open, embedded, active, onClose]);
  useEffect(() => {
    if (open && active) setTimeout(() => input.current?.focus(), 0);
    else if (!open) {
      setPlan(null);
      setResults(null);
      setMessage("");
      setAnswers({});
    }
  }, [open, active]);

  const execute = async (p: CommandPlan) => {
    setBusy(true);
    try {
      const first = p.steps[0];
      if (first?.op === "field.fill") {
        const id = String(first.args.field) as FieldId;
        const f = field(id);
        if (!f) throw new Error(t("commands.field_not_open"));
        setEdit({ field: id, before: f.get(), after: String(first.args.text), label: t("commands.registered"), applied: true });
        f.set(String(first.args.text));
        setResults([{ op: first.op, ok: true, detail: t("commands.registered_not_sent") }]);
        return;
      }
      if (first?.op === "field.transform") {
        const id = String(first.args.field) as FieldId;
        const f = field(id);
        if (!f) throw new Error(t("commands.field_not_open"));
        const before = f.get();
        const out = await hubApi.commandTransform(before, String(first.args.transform));
        setEdit({ field: id, before, after: out.text, label: `${TRANSFORM_TEXT[String(first.args.transform)] ?? t("commands.tr_edit")} · ${out.provider} ${out.model} · ${(out.latencyMs / 1000).toFixed(1)} s`, applied: false });
        return;
      }
      const res = await hubApi.commandExecute(p.id, commandContext());
      for (const r of res.results) if (r.client) r.detail = runClientStep(r.client) || r.detail;
      setResults(res.results);
      if (!embedded && res.results.every((r) => r.ok) && p.steps.every((s) => s.risk === "read")) setOpen(false);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t("commands.failed_fallback"));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (withAnswers = answers) => {
    if (!text.trim()) return;
    setBusy(true);
    setMessage("");
    setResults(null);
    setEdit(null);
    try {
      const p = await hubApi.commandPlan(text.trim(), commandContext(), Object.keys(withAnswers).length ? withAnswers : undefined);
      setPlan(p);
      // Premortem: harmless reading runs at once, without a modal step.
      if (!p.question && !p.refusal && p.steps.length > 0 && p.steps.every((s) => s.risk === "read" && !s.op.startsWith("field."))) await execute(p);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t("commands.plan_failed"));
    } finally {
      setBusy(false);
    }
  };

  // Opened from ✦ (overview), ⋯ → „Auftrag in Worten“ (session) or Ctrl/Cmd+K.
  if (!open) return null;

  const writes = plan && plan.steps.some((s) => s.risk !== "read");
  return (
    <div class={`command-sheet${embedded ? " command-card" : ""}`} role={embedded ? "region" : "dialog"} aria-label={embedded ? t("knowledge.search") : t("commands.voice_order")} ref={sheet}>
      <form
        class="command-form"
        onSubmit={(e) => {
          e.preventDefault();
          // Enter springt nur, wenn ein Treffer mit den Pfeiltasten gewählt ist — sonst ist es ein Auftrag.
          const chosen = jumps[selected];
          if (chosen) return jump(chosen.target);
          setAnswers({});
          void submit({});
        }}
      >
        <input
          ref={input}
          value={text}
          placeholder={t("commands.palette_hint")}
          aria-label={t("commands.commandpalette")}
          role="combobox"
          aria-expanded={jumps.length > 0}
          aria-controls="quick-jumps"
          aria-activedescendant={selected >= 0 ? `quick-jump-${selected}` : undefined}
          onInput={(e) => setText((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (jumps.length === 0 || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
            e.preventDefault();
            setSelected((i) => (e.key === "ArrowDown" ? Math.min(i + 1, jumps.length - 1) : Math.max(i - 1, -1)));
          }}
        />
        <Button type="submit" disabled={busy || !text.trim()} variant="primary">
          {busy ? "…" : t("commands.plan_btn")}
        </Button>
        <Button aria-label={t("common.close")} onClick={() => embedded ? onClose?.() : setOpen(false)}>
          ✕
        </Button>
      </form>
      {jumps.length > 0 && (
        <div class="quick-jumps" id="quick-jumps" role="listbox" aria-label={t("commands.jump_to")}>
          {jumps.map((j, i) => (
            <button
              key={`${j.kind}-${j.label}-${i}`}
              id={`quick-jump-${i}`}
              type="button"
              role="option"
              aria-selected={i === selected}
              class={`quick-jump${i === selected ? " selected" : ""}`}
              onClick={() => jump(j.target)}
            >
              <span class="quick-kind">{t(QUICK_KIND_LABEL[j.kind])}</span>
              <span class="quick-label">{j.label}</span>
              <span class="quick-detail dim">{j.detail}</span>
            </button>
          ))}
        </div>
      )}
      {!plan && !message && !text.trim() && (
        <div class="command-examples dim">
          {EXAMPLES.map((ex) => (
            <Chip key={ex} onClick={() => setText(t(ex).replace(/…/g, "").replace(/: $/, ": "))}>
              {t(ex)}
            </Chip>
          ))}
          <div class="command-field">{t("commands.text_field")} {currentField() ?? t("commands.none_open")}</div>
        </div>
      )}
      {message && <div class="reply-error">{message}</div>}
      {plan?.refusal && <div class="command-refusal">{plan.refusal}</div>}
      {plan?.question && (
        <div class="command-question">
          <div>{plan.question.question}</div>
          <div class="command-options">
            {plan.question.options.map((o) => (
              <Chip
                key={o.value}
                onClick={() => {
                  const next = { ...answers, [plan.question!.param]: o.value };
                  setAnswers(next);
                  void submit(next);
                }}
              >
                {o.label}
              </Chip>
            ))}
          </div>
        </div>
      )}
      {plan && plan.steps.length > 0 && !results && !edit && (
        <div class="command-plan">
          {plan.steps.map((s, i) => (
            <div key={i} class={`command-step risk-${s.risk}`}>
              <span class="command-risk">{RISK_TEXT[s.risk]}</span>
              <span>{s.summary}</span>
            </div>
          ))}
          <div class="dim command-planner">{plan.planner === "model" ? t("commands.understood_model") : t("commands.understood_rule")} {t("commands.target_verified")}</div>
          {writes || plan.steps[0]?.op.startsWith("field.") ? (
            <Button disabled={busy} onClick={() => void execute(plan)} variant="primary">
              {busy ? "…" : t("code.run")}
            </Button>
          ) : null}
        </div>
      )}
      {results && (
        <div class="command-results">
          {results.map((r, i) => (
            <div key={i} class={`command-result ${r.ok ? "ok" : "failed"}`}>
              {r.ok ? "✓" : "✗"} {r.detail}
            </div>
          ))}
        </div>
      )}
      {edit && (
        <div class="command-edit">
          <div class="dim">{edit.label}</div>
          <div class="command-diff">
            <div>
              <div class="dim">{t("commands.before")}</div>
              <div class="command-before">{edit.before || t("session.empty_paren")}</div>
            </div>
            <div>
              <div class="dim">{t("commands.after")}</div>
              <div class="command-after">{edit.after}</div>
            </div>
          </div>
          <div class="row" style="gap: 8px">
            {!edit.applied ? (
              <>
                <Button onClick={() => { field(edit.field)?.set(edit.after); setEdit({ ...edit, applied: true }); }} variant="primary">
                  {t("common.apply")}
                </Button>
                <Button onClick={() => setEdit(null)}>
                  {t("composer.discard")}
                </Button>
              </>
            ) : (
              <Button onClick={() => { field(edit.field)?.set(edit.before); setEdit({ ...edit, applied: false }); }}>
                {t("session.undo")}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
