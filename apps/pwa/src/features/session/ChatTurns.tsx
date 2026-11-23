import { t } from "../../shared/i18n/index.ts";
import { Fragment, type ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { NormalizedEvent } from "../../shared/ws.ts";
import { EventDetail, EventRow } from "./EventRow.tsx";
import { currentStep, itemTs, stepsOf, workSummary, type ChatItem, type Step, type Work } from "./turns.ts";
import { dayLabel, needsDaySeparator } from "../../shared/i18n/day-label.ts";

/**
 * EPIC-P43 T43.4: der Chat in Zügen (turns.ts). Laufende Arbeit steht offen, der laufende Schritt
 * schimmert; am Zugende faltet sie sich zu einer Zeile. Antippen klappt die Schritte auf, ein Schritt
 * zeigt Ein- und Ausgabe (Blob-Nachladen wie im Verlauf, K5).
 *
 * Auf/zu ist Gerätezustand (K7): sessionStorage je Session; ohne eigene Wahl entscheidet „läuft“.
 */
const FOLD_KEY = (sessionId: string) => `ancientvoid.turns.${sessionId}`;

function loadChoices(sessionId: string): Record<string, boolean> {
  try {
    return JSON.parse(sessionStorage.getItem(FOLD_KEY(sessionId)) ?? "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
}

export function itemFirstSeq(item: ChatItem): number {
  if (item.kind === "event") return item.event.seq;
  if (item.kind === "unknown") return item.firstSeq;
  const first = item.entries[0];
  if (!first) return 0;
  return first.kind === "note" ? first.event.seq : Math.min(first.step.use?.seq ?? Infinity, first.step.result?.seq ?? Infinity);
}

export function itemLastSeq(item: ChatItem): number {
  if (item.kind === "event") return item.event.seq;
  if (item.kind === "unknown") return item.firstSeq + item.count - 1;
  const last = item.entries.at(-1);
  if (!last) return 0;
  return last.kind === "note" ? last.event.seq : Math.max(last.step.use?.seq ?? 0, last.step.result?.seq ?? 0);
}

export function ChatTurns({
  sessionId,
  items,
  expanded,
  onToggleExpand,
  onJump,
  firstNewSeq,
  onOpenVerlauf,
  after,
  live,
}: {
  sessionId: string;
  items: ChatItem[];
  expanded: ReadonlySet<number>;
  onToggleExpand: (seq: number) => void;
  onJump: (anchor: string) => void;
  /** Erstes ungesehenes Ereignis (T8.6) — die Trennlinie steht vor dem Zug, der es enthält. */
  firstNewSeq: number | null;
  onOpenVerlauf: () => void;
  /** Was unter einem Eintrag steht (z. B. die Token-Rechnung eines Zugs, ADR-0032). */
  after: (item: ChatItem, next: ChatItem | undefined) => ComponentChildren;
  /** ADR-0083: bereits uebertragene Teiltexte, bevor der Block eintrifft. */
  live?: { assistant: string; thinking: string };
}) {
  const [choices, setChoices] = useState(() => loadChoices(sessionId));
  const toggle = (key: string, open: boolean) => {
    setChoices((prev) => {
      const next = { ...prev, [key]: open };
      try {
        sessionStorage.setItem(FOLD_KEY(sessionId), JSON.stringify(next));
      } catch {
        // Gerätezustand ist Bequemlichkeit, kein Fehler.
      }
      return next;
    });
  };
  const dividerAt = firstNewSeq === null ? -1 : items.findIndex((item) => itemLastSeq(item) >= firstNewSeq);
  /** Zeit des vorherigen Eintrags mit Zeitstempel (Sammelzeilen haben keine eigene). */
  const vorigeZeit = (i: number): string | null => {
    for (let j = i - 1; j >= 0; j--) {
      const zeit = itemTs(items[j]!);
      if (zeit) return zeit;
    }
    return null;
  };
  return (
    <>
      {items.map((item, i) => (
        <Fragment key={item.kind === "event" ? item.event.seq : item.key}>
          {itemTs(item) && needsDaySeparator(vorigeZeit(i), itemTs(item)!) && (
            <div class="day-sep" data-testid="day-sep">
              <span>{dayLabel(itemTs(item)!)}</span>
            </div>
          )}
          {i === dividerAt && (
            <div class="new-divider" id="seit-letztem-besuch">
              {t("session.new_since_last_visit_cap")}
            </div>
          )}
          {item.kind === "event" ? (
            <EventRow event={item.event} expanded={expanded.has(item.event.seq)} onToggleExpand={() => onToggleExpand(item.event.seq)} toolResult={undefined} onJump={onJump} />
          ) : item.kind === "unknown" ? (
            <div class="turn-unknown" data-seq={item.firstSeq}>
              <span>
                {item.count} {item.count === 1 ? t("session.unknown_event") : t("session.unknown_events")}
              </span>
              <button type="button" class="link-btn" onClick={onOpenVerlauf}>
                {t("session.view_in_history")}
              </button>
            </div>
          ) : (
            <WorkBlock work={item} open={choices[item.key] ?? item.running} onToggle={(open) => toggle(item.key, open)} />
          )}
          {after(item, items[i + 1])}
        </Fragment>
      ))}
      {live && (live.assistant || live.thinking) ? (
        <div data-testid="chat-live" aria-live="polite">
          {live.thinking ? (
            /* Das live uebertragene Denken ist eine Denk-Notiz wie jede andere in dieser
             * Ansicht: dieselbe Klasse, also auch dieselbe Groesse und derselbe Grund.
             * Ein eigener Kasten und 15 px machten es groesser als das Denken sonst
             * (Nutzerfund 17.11.2026). */
            <div class="turn-note thinking chat-live-note" data-testid="chat-live-thinking">
              {live.thinking}
              <span class="chat-live-caret" aria-hidden="true" />
            </div>
          ) : null}
          {live.assistant ? (
            <div class="chat-live">
              <span class="chat-live-label">{t("session.answering")}</span>
              <div class="chat-live-part" data-testid="chat-live-assistant">{live.assistant}<span class="chat-live-caret" aria-hidden="true" /></div>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function WorkBlock({ work, open, onToggle }: { work: Work; open: boolean; onToggle: (open: boolean) => void }) {
  const steps = stepsOf(work);
  const running = currentStep(work);
  const failed = steps.some((s) => s.state === "error");
  return (
    <div class={`turn-work${work.running ? " running" : ""}${open ? " open" : ""}`} data-work={work.key}>
      <button type="button" class="turn-summary" aria-expanded={open} onClick={() => onToggle(!open)}>
        <span class="turn-caret" aria-hidden="true" />
        {/* Schlüssel = läuft/fertig: beim Zugende rastet das Zeichen einmal ein. */}
        <span key={work.running ? "run" : "done"} class={`turn-mark ${work.running ? "mv-breathe" : failed ? "err mv-snap" : "ok mv-snap"}`} aria-hidden="true" />
        <span class="turn-summary-text">{work.running && running ? `${running.verb} ${running.target}`.trim() : workSummary(work)}</span>
      </button>
      {open && (
        <ol class="turn-steps">
          {work.entries.map((entry) =>
            entry.kind === "note" ? (
              <li key={`n${entry.event.seq}`} class={`turn-note ${entry.event.type}`}>
                <WorkNote event={entry.event} />
              </li>
            ) : (
              <StepRow key={entry.step.key} step={entry.step} current={entry.step === running} />
            ),
          )}
        </ol>
      )}
    </div>
  );
}

function WorkNote({ event }: { event: NormalizedEvent }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" class="turn-note-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}><span aria-hidden="true">{open ? "▾" : "▸"}</span> {event.summary}</button>
    {open && <EventDetail event={event} />}
  </>;
}

const STATE_LABEL: Record<Step["state"], string> = { running: t("session.running"), ok: "fertig", error: t("notifications.section_errors"), open: t("session.no_result") };

function StepRow({ step, current }: { step: Step; current: boolean }) {
  const [detail, setDetail] = useState(false);
  return (
    <li class={`turn-step ${step.state}`} data-seq={step.key}>
      <button type="button" class={`turn-step-head${current ? " mv-shimmer" : ""}`} aria-expanded={detail} onClick={() => setDetail((on) => !on)}>
        <span class={`turn-step-mark ${step.state}`} title={STATE_LABEL[step.state]} aria-label={STATE_LABEL[step.state]} />
        <span class="turn-step-verb">{step.verb}</span>
        <span class="turn-step-target mono">{step.target}</span>
        {step.short && <span class="turn-step-short dim">{step.short}</span>}
      </button>
      {detail && (
        <div class="turn-step-io">
          {step.use && <StepPart label={t("composer.input")} event={step.use} />}
          {step.result ? <StepPart label={t("composer.output")} event={step.result} /> : <div class="dim">{STATE_LABEL[step.state]}</div>}
        </div>
      )}
    </li>
  );
}

function StepPart({ label, event }: { label: string; event: NormalizedEvent }) {
  return (
    <div class="turn-step-part">
      <span class="field-label">{label}</span>
      <EventDetail event={event.type === "tool_use" ? { ...event, payload: { text: JSON.stringify((event.payload as { input?: unknown }).input ?? event.payload, null, 2) } } : event} />
    </div>
  );
}
