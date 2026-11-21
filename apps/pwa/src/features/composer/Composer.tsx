import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { registerField, touchField, type FieldId } from "../../shared/command-context.ts";
import { useApi } from "../../shared/api-context.ts";
import type { ComponentChildren } from "preact";
import { type PromptRecommendation, type RewriteEngine, type SkippedEngine } from "../../shared/api.ts";
import { SkillRecommendCard } from "./SkillRecommendCard.tsx";
import { engineLabel, skippedNote } from "./engine-label.ts";
import { saveSelectedSkill, saveSelectedWorkflow } from "./SkillOverlay.tsx";
import { applySuggestion, commandsForScope, slashNotice, slashSuggestions, type SlashCommand } from "./slash.ts";
import { AttachmentPicker } from "../attachments/Attachments.tsx";
import { SourceChips, SourcePreviewNote } from "./SourceChips.tsx";
import type { AttachmentRecord } from "../../shared/api.ts";
import { Button } from "../../shared/ui/index.ts";
import { openClipboardShelf } from "../../shared/clipboard-shelf.ts";
import { ShelfGlyph, useShelfCount } from "../clipboard/ClipboardShelf.tsx";

/** T1.5-8: enhance.ts only has a real implementation for these adapters —
 * never offer the button for an adapter it can't actually enhance for
 * (dummy has no LLM behind it at all). BUG-0061: only the fallback for
 * hubs that don't send `enhance` per adapter yet — the server knows dsh
 * ACP registrations under free-form ids, an id list here cannot. */
const ENHANCE_SUPPORTED_ADAPTERS = new Set(["claude", "codex", "opencode"]);

/**
 * T1.5-6 — the shared prompt-entry surface, used both when creating a
 * session (App.tsx) and as a follow-up reply in a running one
 * (SessionTail.tsx). Text field + enhance; Speech-to-Text sitzt global
 * im Nyx-FAB (nicht mehr hier).
 */
export function Composer({
  value,
  onChange,
  placeholder,
  disabled,
  adapter,
  project,
  extraActions,
  onUseRecommendation,
  attachments,
  onAttachmentsChange,
  sourceTarget,
  fieldId,
  onSubmit,
  adapterEnhance,
  commands,
  commandScope,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** EPIC-P68 (ADR-0089): the local model rewrites first; this adapter's
   * own one-shot is the fallback when it is busy or absent. */
  adapter: string;
  /** The enhance call's cwd — found necessary via a real test: without
   * it, the rewrite reflected the hub server's own repo, not whatever
   * project the user actually selected. */
  project: string;
  /** Session reply puts Senden and Stop in the same row as Verbessern. */
  extraActions?: ComponentChildren;
  /** New-session form applies a skill/agent through SessionSpec.args.
   * A reply has no such args, so the composer puts the name in the text. */
  onUseRecommendation?: (item: { kind: "skill" | "agent"; name: string }) => void;
  /** T7.10: files and images sent with this prompt. */
  attachments?: AttachmentRecord[];
  onAttachmentsChange?: (next: AttachmentRecord[]) => void;
  /** EPIC-P43.5 T43.5-1: Ziel der Quellenchips (Session-ID oder „new“) —
   * Chips + Mitgesendet-Vorschau; der Block hängt beim Submit am Text. */
  sourceTarget?: string;
  /** T9.4: the text entry may fill or rewrite this field. */
  fieldId?: FieldId;
  /** T9.6/2026-10-26: keyboard submit (tablet with keyboard) —
   * ⌘/Ctrl+Enter triggers the caller's submit action, plain Enter stays a
   * newline (one-handed phone typing must not send by accident). */
  onSubmit?: () => void;
  /** BUG-0061: the hub's per-registration answer whether enhance is wired
   * up (from /api/adapters). undefined = hub didn't say → legacy id-set
   * fallback above. */
  adapterEnhance?: boolean;
  /** ADR-0042: the adapter's declared slash commands (from /api/adapters).
   * undefined = older hub without the field — no autocomplete, but the
   * honest "not declared" notice still applies to a "…" first word. */
  commands?: readonly SlashCommand[];
  /** Which surface this composer is: Neu-Session filters scope "start",
   * a session reply filters "steer". */
  commandScope?: "start" | "steer";
}) {
  const api = useApi();
  // ADR-0042: slash layer — suggestions while typing the first "/word",
  // a visible notice for anything not declared (fail loud, no silent
  // "command" that really goes out as chat text).
  const scopedCommands = useMemo(() => commandsForScope(commands, commandScope ?? "steer"), [commands, commandScope]);
  const suggestions = useMemo(() => slashSuggestions(value, scopedCommands), [value, scopedCommands]);
  const slashHint = slashNotice(value, scopedCommands);
  const [slashIndex, setSlashIndex] = useState(0);
  useEffect(() => setSlashIndex(0), [suggestions.length]);
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const handle = useMemo(() => ({ get: () => valueRef.current, set: (t: string) => onChangeRef.current(t) }), []);
  useEffect(() => (fieldId ? registerField(fieldId, handle) : undefined), [fieldId]);
  // QoL 2026-10-29 (K2): das Feld wächst mit dem Text, damit lange Eingaben
  // ganz lesbar sind — aber nur nach oben: manuell gezogene Größe
  // (resize:vertical) bleibt, bis der Inhalt wieder Platz braucht.
  // max-height deckelt, danach scrollt das Feld.
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Nutzerwunsch 2026-10-29 (Handy): Maximieren-Button — große Schreibfläche
  // statt Mikro-Feld; im expanded-Zustand setzt CSS die Höhe, Auto-Grow
  // greift dann nicht ein (offsetHeight ist schon groß).
  const [expanded, setExpanded] = useState(false);
  // ADR-0090/0092: die Ablage atmet mit — der Knopf zeigt, wie viele Einträge (Stufen
  // und Sprachnachrichten) da sind.
  const shelfCount = useShelfCount();
  // EPIC-P43 T43.4: einzeilig, bis das Feld zum ersten Mal den Fokus bekommt.
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    if (!value && !expanded) {
      el.style.height = "";
      return;
    }
    if (el.scrollHeight > el.offsetHeight) el.style.height = `${el.scrollHeight}px`;
  }, [value, expanded]);
  // Kollaps: explizite Höhe wegwerfen, damit Feld-/Fokus-Maße wieder gelten.
  useEffect(() => {
    if (!expanded) inputRef.current?.style.setProperty("height", "");
  }, [expanded]);
  const enhanceSupported = adapterEnhance ?? ENHANCE_SUPPORTED_ADAPTERS.has(adapter);
  const [enhancing, setEnhancing] = useState(false);
  const [enhanceError, setEnhanceError] = useState("");
  const [preview, setPreview] = useState<{
    original: string;
    enhanced: string;
    costUsd?: number;
    latencyMs: number;
    engine?: RewriteEngine;
    skipped?: SkippedEngine[];
  } | null>(null);
  const [recommendation, setRecommendation] = useState<PromptRecommendation | null>(null);
  const [recommendError, setRecommendError] = useState("");
  const [recommendBusy, setRecommendBusy] = useState(false);

  const enhance = async () => {
    if (!value.trim()) return;
    setEnhanceError("");
    setRecommendError("");
    setEnhancing(true);
    try {
      // T1.5-8: only on explicit request, never automatic — this is the
      // one and only call site.
      const result = await api.enhancePrompt(adapter, project, value);
      setPreview({
        original: value,
        enhanced: result.enhanced,
        costUsd: result.costUsd,
        latencyMs: result.latencyMs,
        ...(result.engine ? { engine: result.engine } : {}),
        ...(result.skipped ? { skipped: result.skipped } : {}),
      });
      setRecommendation(null);
      try {
        setRecommendation(await api.recommendPrompt(project, result.enhanced));
      } catch (err) {
        setRecommendError(err instanceof Error ? err.message : "Empfehlung fehlgeschlagen");
      }
    } catch (err) {
      setEnhanceError(err instanceof Error ? err.message : "Verbessern fehlgeschlagen");
    } finally {
      setEnhancing(false);
    }
  };

  // T3.9: best-effort, never blocks the actual accept/reject action on
  // network success — a failed feedback write is a missed data point for
  // a future optimizer revision, not a reason to disrupt the user's flow.
  const logFeedback = (decision: "accepted" | "rejected") => {
    if (!preview) return;
    api
      .recordOptimizerFeedback({
        adapter,
        project,
        original: preview.original,
        enhanced: preview.enhanced,
        decision,
        ...(preview.costUsd !== undefined ? { costUsd: preview.costUsd } : {}),
        latencyMs: preview.latencyMs,
        ...(preview.engine ? { engine: preview.engine.kind === "local" ? "local" : preview.engine.id } : {}),
      })
      .catch(() => undefined);
  };

  const acceptEnhanced = () => {
    logFeedback("accepted");
    if (preview) onChange(preview.enhanced);
    setPreview(null);
  };

  const keepOriginal = () => {
    logFeedback("rejected");
    setPreview(null);
    setRecommendation(null);
  };

  const applyRecommendation = async (persist: boolean, chosen: PromptRecommendation | null = recommendation) => {
    const recommendation = chosen;
    if (!recommendation) return;
    setRecommendError("");
    setRecommendBusy(true);
    try {
      if (recommendation.mode === "create") {
        if (!recommendation.draft) throw new Error("Vorschlag hat keinen Entwurf");
        await api.saveArtifact({
          project,
          kind: recommendation.kind,
          name: recommendation.name,
          description: recommendation.description,
          draft: recommendation.draft,
        });
      }
      const base = preview?.enhanced ?? value;
      if (
        onUseRecommendation &&
        adapter === "claude" &&
        (recommendation.kind === "skill" || recommendation.kind === "agent")
      ) {
        onChange(base);
        onUseRecommendation({ kind: recommendation.kind, name: recommendation.name });
        if (persist) saveSelectedSkill(project, { kind: recommendation.kind, name: recommendation.name });
      } else {
        const line =
          recommendation.kind === "skill"
            ? `/${recommendation.name}\n\n`
            : recommendation.kind === "agent"
              ? `Agent: ${recommendation.name}\n\n`
              : `Workflow: ${recommendation.name}\n\n`;
        onChange(base.startsWith(line) ? base : `${line}${base}`);
        if (persist && (recommendation.kind === "skill" || recommendation.kind === "agent")) {
          saveSelectedSkill(project, { kind: recommendation.kind, name: recommendation.name });
        }
        if (persist && recommendation.kind === "workflow") saveSelectedWorkflow(project, recommendation.name);
      }
      if (preview) logFeedback("accepted");
      setPreview(null);
      setRecommendation(null);
    } catch (err) {
      setRecommendError(err instanceof Error ? err.message : "Empfehlung fehlgeschlagen");
    } finally {
      setRecommendBusy(false);
    }
  };

  const recommendNote = (item: PromptRecommendation) =>
    item.kind === "workflow"
      ? "Workflows haben keinen Adapter-Aufruf. Der Name kommt in den Prompt."
      : adapter !== "claude"
        ? "Dieser Adapter übernimmt den Eintrag nicht direkt. Der Name kommt in den Prompt."
        : item.mode === "create"
          ? "Nutzen legt die Datei an und nimmt sie für diesen Prompt. Als Standard merkt sie fürs Projekt."
          : "Nutzen gilt für diesen Prompt. Als Standard merkt sie fürs Projekt.";

  return (
    // EPIC-P43 T43.4: einzeilig, solange niemand schreibt; Fokus oder Text klappt die Eingabe auf.
    <div
      class={`composer${expanded ? " expanded" : ""}${!touched && !value.trim() && !expanded ? " compact" : ""}`}
      // Nur das Eingabefeld klappt auf, und es bleibt offen: klappte es beim Verlassen wieder zu, verschöbe
      // sich das Layout unter dem Finger und der Klick auf die Taste darunter ginge ins Leere.
      onFocusIn={(e) => {
        if (e.target === inputRef.current) setTouched(true);
      }}
    >
      <textarea
        ref={inputRef}
        class="composer-input"
        value={value}
        onInput={(e) => onChange((e.target as HTMLTextAreaElement).value)}
        placeholder={placeholder}
        disabled={disabled}
        rows={2}
        onFocus={() => {
          if (!fieldId) return;
          // EPIC-P18: several tiles each have a reply field — the one used last is "the" field.
          registerField(fieldId, handle);
          touchField(fieldId);
        }}
        onKeyDown={(e) => {
          // ADR-0042: ↑/↓ wählt in der Vorschlagsliste, Enter übernimmt —
          // nur solange die Liste offen ist; danach bleibt Enter ein Zeilenumbruch.
          if (suggestions.length > 0) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSlashIndex((i) => (i + 1) % suggestions.length);
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setSlashIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
              return;
            }
            if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
              e.preventDefault();
              onChange(applySuggestion(value, suggestions[slashIndex] ?? suggestions[0]!));
              return;
            }
          }
          if (onSubmit && (e.metaKey || e.ctrlKey) && e.key === "Enter" && !disabled) {
            e.preventDefault();
            onSubmit();
          }
        }}
        title={onSubmit ? "⌘/Ctrl+Enter senden" : undefined}
      />
      {suggestions.length > 0 && (
        <div class="composer-notice" role="listbox" aria-label="Commands">
          {suggestions.map((c, i) => (
            <Button
              key={c.name}
              
              role="option"
              aria-selected={i === slashIndex}
              style="margin: 2px 4px 2px 0"
              onClick={() => onChange(applySuggestion(value, c))}
             variant="primary" class={i === slashIndex ? undefined : undefined}>
              {c.name} — {c.description}
            </Button>
          ))}
        </div>
      )}
      {slashHint && <div class="composer-notice dim">{slashHint}</div>}
      {enhanceError && <div class="composer-notice err">{enhanceError}</div>}
      {recommendError && !recommendation && <div class="composer-notice err">{recommendError}</div>}

      {preview && (
        <div class="enhance-preview">
          <div >
            <div class="dim" style="font-size: calc(11px * var(--font-scale, 1))">Original</div>
            <div class="enhance-preview-text">{preview.original}</div>
          </div>
          <div >
            <div class="dim" style="font-size: calc(11px * var(--font-scale, 1))">
              Verbessert
              {preview.engine ? ` · ${engineLabel(preview.engine)}` : ""}
              {preview.costUsd !== undefined ? ` · $${preview.costUsd.toFixed(4)}` : ""} ·{" "}
              {(preview.latencyMs / 1000).toFixed(1)}s
            </div>
            {skippedNote(preview.skipped) && <div class="enhance-skipped">{skippedNote(preview.skipped)}</div>}
            <div class="enhance-preview-text">{preview.enhanced}</div>
          </div>
          <div class="row" style="gap: 8px">
            <Button onClick={keepOriginal}>
              Original senden
            </Button>
            <Button onClick={acceptEnhanced} variant="primary">
              Verbessertes übernehmen
            </Button>
          </div>
        </div>
      )}

      {recommendation && (
        <SkillRecommendCard
          key={`${recommendation.mode}:${recommendation.kind}:${recommendation.name}`}
          recommendation={recommendation}
          project={project}
          adapter={adapter}
          prompt={preview?.enhanced ?? value}
          busy={recommendBusy}
          noteFor={recommendNote}
          error={recommendError}
          onDismiss={() => setRecommendation(null)}
          onUse={(persist, next) => void applyRecommendation(persist, next)}
        />
      )}

      {/* T8.5: the paperclip sits in the button row; chips get their own
       * row above it (CSS order) — one row less than before. */}
      {/* EPIC-P43.5 T43.5-1: Quellenchips + Mitgesendet-Vorschau über der Aktionszeile —
       * immer sichtbar, was beim Absenden mitgeht; nie implizites Senden. */}
      {sourceTarget && <SourceChips target={sourceTarget} />}
      {sourceTarget && <SourcePreviewNote target={sourceTarget} />}
      <div class="composer-actions">
        {attachments && onAttachmentsChange && (
          <span class="composer-attachments">
            <AttachmentPicker attachments={attachments} onChange={onAttachmentsChange} {...(disabled !== undefined ? { disabled } : {})} />
          </span>
        )}
        <Button
          icon
          class={shelfCount > 0 ? "composer-shelf has-items" : "composer-shelf"}
          data-testid="clipboard-open"
          onClick={openClipboardShelf}
          aria-label={shelfCount > 0 ? `Ablage öffnen, ${shelfCount} Einträge` : "Ablage öffnen, noch leer"}
          title={shelfCount > 0 ? `Zwischenablage-Ablage (${shelfCount} Einträge)` : "Zwischenablage-Ablage — noch nichts kopiert"}
        >
          <ShelfGlyph />
          {shelfCount > 0 && <span class="shelf-badge" data-testid="clipboard-count" aria-hidden="true">{shelfCount > 9 ? "9+" : shelfCount}</span>}
        </Button>
        <Button
          aria-pressed={expanded}
          aria-label={expanded ? "Eingabe verkleinern" : "Eingabe maximieren"}
          title={expanded ? "Eingabe wieder verkleinern" : "Eingabe groß machen"}
          disabled={disabled}
          onClick={() => setExpanded((v) => !v)}
         icon class="composer-expand">
          {expanded ? "⤡" : "⤢"}
        </Button>
        {/* Nutzerauftrag 19.11.2026: Während die Optimierung läuft, steht hier
         * statt der Taste ein kleiner Spinner in Akzentfarbe (gleiche Fläche,
         * kein Layout-Sprung — Styling in 05-composer.css). */}
        {enhancing ? (
          <span
            class="enhance-spinner"
            role="status"
            aria-label="Prompt wird verbessert"
            data-testid="enhance-spinner"
          />
        ) : (
          <Button
            aria-label="Verbessern"
            onClick={enhance}
            disabled={disabled || !enhanceSupported || !value.trim()}
            title={enhanceSupported ? "Prompt verbessern (lokales Modell zuerst, sonst Kontingent des Adapters)" : "Für diesen Adapter nicht verfügbar"}
            icon
            class="icon-btn composer-more"
          >
            <WandGlyph />
          </Button>
        )}
        {extraActions}
      </div>
    </div>
  );
}

const glyph = { viewBox: "0 0 24 24", width: 20, height: 20, fill: "none", stroke: "currentColor", "stroke-width": 1.8, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": true } as const;

/** Zauberstab mit Funken. */
function WandGlyph() {
  return (
    <svg {...glyph}>
      <path d="M4 20 15 9M14 6l4 4M17.5 3v3M16 4.5h3M20.5 11v2M19.5 12h2M8 4v2M7 5h2" />
    </svg>
  );
}
