import { t } from "../../shared/i18n/index.ts";
import { fmtDateTime, fmtTime, fmtNumber } from "../../shared/i18n/format.ts";
import { stampLabel } from "../../shared/i18n/day-label.ts";
import { memo } from "preact/compat";
import { useEffect, useState } from "preact/hooks";
import { useApi } from "../../shared/api-context.ts";
import { fetchEventBlob, useFullEvent } from "./event-blobs.ts";
import { type NormalizedEvent } from "../../shared/ws.ts";
import { isOffloaded, visibleEventText, withBlobPayload } from "./event-text.ts";
import { isEmptyThinking, toolIdOf } from "./event-filter.ts";
import { Markdown } from "../../shared/Markdown.tsx";
import { AttachmentChips, type AttachmentRef } from "../attachments/Attachments.tsx";
import { SpeakButton } from "../../shared/SpeakButton.tsx";
import { copyIntoShelf } from "../../shared/clipboard-copy.ts";
import { toolImageRef, type SessionRef, type ToolImageRef } from "./tool-image.ts";

/** Bildvorschau zu einem gelesenen Bild — Bytes vom Hub, Token im Header. */
export function ToolImageView({ image }: { image: ToolImageRef }) {
  const api = useApi();
  const [url, setUrl] = useState("");
  const [fehler, setFehler] = useState("");
  useEffect(() => {
    let lebt = true;
    let objectUrl = "";
    setUrl("");
    setFehler("");
    api
      .toolImageBlobUrl(image.target, image.path)
      .then((u) => {
        objectUrl = u;
        if (lebt) setUrl(u);
        else URL.revokeObjectURL(u);
      })
      .catch(() => {
        if (lebt) setFehler(t("session.tool_image_missing"));
      });
    return () => {
      lebt = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [api, image.target, image.path]);
  return (
    <div class="tool-image">
      {url ? (
        <a class="tool-image-link" href={url} target="_blank" rel="noopener" title={t("session.tool_image_open")}>
          <img src={url} alt={image.name} loading="lazy" decoding="async" />
        </a>
      ) : null}
      <div class="tool-image-meta">
        <span class="dim">{image.name}</span>
        {url ? (
          <a class="link-btn" href={url} target="_blank" rel="noopener">
            {t("session.tool_image_open")}
          </a>
        ) : null}
        {fehler ? <span class="dim">{fehler}</span> : null}
      </div>
    </div>
  );
}

function toolAnchor(toolId: string, side: "use" | "result"): string {
  return `tool-${side}-${toolId}`;
}

function eventDetail(event: NormalizedEvent): string {
  const payload = event.payload;
  for (const key of ["text", "output", "error"] as const) {
    const value = payload[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return event.summary;
  }
}

export function EventDetail({ event }: { event: NormalizedEvent }) {
  const api = useApi();
  const [blob, setBlob] = useState<string | null>(null);
  useEffect(() => {
    if (!event.blobRef) return;
    let alive = true;
    fetchEventBlob(api, event)
      .then((text) => {
        if (alive) setBlob(isOffloaded(event) ? eventDetail(withBlobPayload(event, text)) : text);
      })
      .catch(() => {
        if (alive) setBlob(t("session.details_load_failed"));
      });
    return () => {
      alive = false;
    };
  }, [api, event.blobRef, event.sessionId]);
  return <pre class="event-detail">{blob ?? eventDetail(event)}</pre>;
}

function onCardClick(ev: { target: EventTarget | null }, toggle: () => void) {
  const target = ev.target as HTMLElement | null;
  if (target?.closest("button, a")) return;
  toggle();
}

function EventRowView({
  event: rowEvent,
  expanded,
  onToggleExpand,
  toolResult,
  onJump,
  sessionRef,
}: {
  event: NormalizedEvent;
  expanded: boolean;
  onToggleExpand: () => void;
  /** Only set for tool_use rows — the matching tool_result, if it has
   * arrived yet (undefined -> still running). */
  toolResult: NormalizedEvent | undefined;
  onJump: (anchor: string) => void;
  /** Eigene Sitzung — nötig, um ein gelesenes Bild über die Rohroute zu zeigen. */
  sessionRef: SessionRef | undefined;
}) {
  const { event, state: fullText } = useFullEvent(rowEvent, useApi());
  const time = stampLabel(event.ts);
  const blobNote = event.blobRef ? " ⛁" : "";
  const toolId = toolIdOf(event);
  const visible = visibleEventText(event);

  if (isEmptyThinking(event)) {
    // BUG-0046: the provider withheld the text — one quiet line, nothing to expand or copy.
    return (
      <div class="event thinking" data-testid="withheld" data-seq={event.seq}>
        <div class="meta">
          <span>#{event.seq} {t("session.dot_thinking")}</span>
          <span>{time}</span>
        </div>
        <div class="summary">{t("session.provider_no_thinking_text")}</div>
      </div>
    );
  }

  if (event.type === "thinking") {
    // T1.7: dimmed/italic (app/styles/ .event.thinking), collapsible —
    // collapsed shows only the (already <=200 char) summary; expanded
    // shows the adapter's full reasoning text, when it sent one.
    return (
      <div class={`event thinking${expanded ? " expanded" : ""}`} data-seq={event.seq} onClick={(ev) => onCardClick(ev, onToggleExpand)}>
        <div class="meta">
          <span>
            {expanded ? "▾" : "▸"} #{event.seq} {t("session.dot_thinking")}
            {blobNote}
          </span>
          <span>{time}</span>
        </div>
        <div class="summary">{event.summary}</div>
        <CopyButton text={copyText(event)} />
        {expanded && <EventDetail event={rowEvent} />}
      </div>
    );
  }

  if (event.type === "tool_use" && toolId) {
    const state: "running" | "ok" | "error" = !toolResult ? "running" : toolResult.payload.isError ? "error" : "ok";
    return (
      <div id={toolAnchor(toolId, "use")} class={`event tool_use${expanded ? " expanded" : ""}`} data-seq={event.seq} onClick={(ev) => onCardClick(ev, onToggleExpand)}>
        <div class="meta">
          <span>
            #{event.seq} {t("session.dot_tool_use")}
            {blobNote}
          </span>
          <span>{time}</span>
        </div>
        <div class="row">
          <span class={`tool-status ${state}`}>{state}</span>
          {toolResult && (
            <button class="link-btn" onClick={() => onJump(toolAnchor(toolId, "result"))}>
              {t("session.to_result_down")}
            </button>
          )}
        </div>
        <div class="summary">{event.summary}</div>
        {(() => {
          const bild = toolImageRef(event, toolResult, sessionRef);
          return bild ? <ToolImageView image={bild} /> : null;
        })()}
        <CopyButton text={copyText(event)} />
        {expanded && <EventDetail event={rowEvent} />}
      </div>
    );
  }

  if (event.type === "tool_result" && toolId) {
    return (
      <div
        id={toolAnchor(toolId, "result")}
        class={`event tool_result${expanded ? " expanded" : ""}`}
        data-seq={event.seq}
        onClick={(ev) => onCardClick(ev, onToggleExpand)}
      >
        <div class="meta">
          <span>
            #{event.seq} {t("session.dot_tool_result")}
            {blobNote}
          </span>
          <span>{time}</span>
        </div>
        <div class="row">
          <button class="link-btn" onClick={() => onJump(toolAnchor(toolId, "use"))}>
            {t("session.up_to_call")}
          </button>
        </div>
        <div class="summary">{event.summary}</div>
        <CopyButton text={copyText(event)} />
        {expanded && <EventDetail event={rowEvent} />}
      </div>
    );
  }

  // AC-P1.5-12: whatever skill/agent a session was started with must be
  // traceable in the tail — session-manager.ts stashes it on the
  // session.created system event's payload.args (T1.5-10).
  if (event.type === "system" && (event.payload as { kind?: unknown }).kind === "session.created") {
    const args = (event.payload as { args?: { skill?: string; agent?: string } | null }).args;
    const skillNote = args?.skill ? `Skill: ${args.skill}` : args?.agent ? `Agent: ${args.agent}` : null;
    return (
      <div class={`event system${expanded ? " expanded" : ""}`} data-seq={event.seq} onClick={(ev) => onCardClick(ev, onToggleExpand)}>
        <div class="meta">
          <span>
            #{event.seq} · {event.type}
            {blobNote}
          </span>
          <span>{time}</span>
        </div>
        <div class="summary">
          {event.summary}
          {skillNote && <span class="badge waiting"> {t("session.started_with")} {skillNote}</span>}
        </div>
        {expanded && <EventDetail event={rowEvent} />}
      </div>
    );
  }

  // The hub's own record of what the user typed (session.prompt).
  const prompt = event.type === "user" && (event.payload as { kind?: unknown }).kind === "session.prompt";
  const device = prompt ? (event.payload as { actor?: unknown }).actor : null;
  // ADR-0015: a provider failure, in words, with what to do next.
  const payloadKind = (event.payload as { kind?: unknown }).kind;
  const providerError = payloadKind === "provider.error" || payloadKind === "cursor.usage_limit";
  const errorDetail = providerError
    ? ((event.payload as { detail?: unknown }).detail ?? (event.payload as { hint?: unknown }).hint ?? (event.payload as { line?: unknown }).line)
    : null;
  return (
    <div class={`event ${event.type}${prompt ? " own" : ""}${providerError ? " provider-error" : ""}${expanded ? " expanded" : ""}`} data-seq={event.seq} onClick={(ev) => onCardClick(ev, onToggleExpand)}>
      <div class="meta">
        <span>
          {prompt ? t("session.you_suffix", { "suffix": typeof device === "string" && device ? ` · ${device}` : "" }) : `#${event.seq} · ${event.type}`}
          {blobNote}
        </span>
        <span>{time}</span>
      </div>
      {event.type === "assistant" ? (
        <Markdown class="summary prose" text={visible} />
      ) : (
        <div class="summary prose">{visible}</div>
      )}
      {fullText !== "ok" && (
        <div class={`dim full-text-note${fullText === "failed" ? " failed" : ""}`}>
          {fullText === "loading" ? t("session.long_text_loading") : t("session.text_truncated")}
        </div>
      )}
      {prompt && Array.isArray((event.payload as { attachments?: unknown }).attachments) && (
        <AttachmentChips refs={(event.payload as { attachments: AttachmentRef[] }).attachments} />
      )}
      {typeof errorDetail === "string" && <div class="dim">{errorDetail}</div>}
      {(event.type === "assistant" || prompt) && <CopyButton text={visibleEventText(event)} />}
      {/* EPIC-P75: Antworten am Lauf-Ende sind hörbar — voller sichtbarer Text, am Cap sichtbar gekürzt. */}
      {event.type === "assistant" && <SpeakButton text={visible} />}
      {expanded && <EventDetail event={rowEvent} />}
    </div>
  );
}

/** What a row's copy button copies: the full payload text — tool inputs
 * as formatted JSON, results as their content, else the visible text. */
function copyText(event: NormalizedEvent): string {
  if (event.type === "tool_use") return JSON.stringify((event.payload as { input?: unknown }).input ?? null, null, 2);
  if (event.type === "tool_result") {
    const content = (event.payload as { content?: unknown }).content;
    if (typeof content === "string" && content.length > 0) return content;
  }
  const text = (event.payload as { text?: unknown }).text;
  return typeof text === "string" && text.length > 0 ? text : visibleEventText(event);
}

/** T8.4: take an answer along — one tap, no selecting on a phone. */
function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState<"" | "ok" | "fail">("");
  return (
    <button
      type="button"
      class="link-btn copy-btn"
      onClick={(ev) => {
        ev.stopPropagation();
        void copyIntoShelf(text, "eintrag").then((ok) => setDone(ok ? "ok" : "fail"));
        setTimeout(() => setDone(""), 1500);
      }}
    >
      {done === "ok" ? t("session.copied") : done === "fail" ? t("session.not_allowed") : t("session.copy")}
    </button>
  );
}

/** EPIC-P18 T18.6 (K2 with four tiles): a row renders again only when what
 * it shows changed. Every WS batch re-rendered up to 500 rows per tile —
 * p95 880 ms with four tiles at 30 ev/s. The callbacks are left out on
 * purpose: they are recreated each render but do the same for this row. */
export const EventRow = memo(
  EventRowView,
  (a, b) => a.event === b.event && a.expanded === b.expanded && a.toolResult === b.toolResult && a.sessionRef === b.sessionRef,
);
