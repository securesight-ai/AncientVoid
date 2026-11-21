import { t } from "../../shared/i18n/index.ts";
import { useEffect, useState } from "preact/hooks";
import { hubApi, type DiscoveredSession, type SessionRecord } from "../../shared/api.ts";
import { adapterCounts, discoveryState, filterDiscovery, groupDiscovery, stateCounts, type DiscoveryState } from "./groups.ts";
import { Button, Chip, EmptyState } from "../../shared/ui/index.ts";
import { copyIntoShelf } from "../../shared/clipboard-copy.ts";

/** "vor 5 min" — how old the observation is (EPIC-P5 §3: explicit age). */
export function observedAgo(observedAt: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(observedAt).getTime()) / 1000));
  if (!Number.isFinite(seconds)) return "Zeit unbekannt";
  if (seconds < 60) return "gerade eben";
  if (seconds < 3600) return `vor ${Math.floor(seconds / 60)} min`;
  if (seconds < 86_400) return `vor ${Math.floor(seconds / 3600)} h`;
  return `vor ${Math.floor(seconds / 86_400)} d`;
}

/**
 * T5.3 / AC-P5-1: every session the hub knows or found read-only in
 * provider files, deduplicated by host + provider + native id on the hub.
 * Hub sessions open as usual; external ones are observe-only. Grouped by
 * project, collapsible — the newest project is expanded, the rest folded.
 */
export function DiscoveryPane({ onOpen }: { onOpen: (session: SessionRecord) => void }) {
  const [items, setItems] = useState<DiscoveredSession[] | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  // ADR-0041: only a registered adapter can continue a found session.
  const [registered, setRegistered] = useState<ReadonlySet<string> | null>(null);
  useEffect(() => {
    hubApi.adapters().then((list) => setRegistered(new Set(list.map((a) => a.id)))).catch(() => setRegistered(null));
  }, []);

  const load = async (from: number, q = query) => {
    setBusy(true);
    try {
      const page = await hubApi.discovery(from, 50, q.trim() ? { q: q.trim() } : {});
      setItems((prev) => (from === 0 ? page.items : [...(prev ?? []), ...page.items]));
      setCursor(page.nextCursor);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Laden fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };

  // ADR-0040: the hub searches before it pages — a hit on page 9 is found, too.
  useEffect(() => {
    const handle = setTimeout(() => void load(0, query), items === null ? 0 : 300);
    return () => clearTimeout(handle);
  }, [query]);

  const [stateFilter, setStateFilter] = useState<DiscoveryState | null>(null);
  const [adapterFilter, setAdapterFilter] = useState<ReadonlySet<string>>(new Set());
  const shown = filterDiscovery(items ?? [], { state: stateFilter, adapters: adapterFilter });
  const groups = groupDiscovery(shown);
  const toggleAdapter = (adapter: string) =>
    setAdapterFilter((prev) => {
      const next = new Set(prev);
      if (!next.delete(adapter)) next.add(adapter);
      return next;
    });

  const open = async (id: string) => {
    try {
      onOpen(await hubApi.session(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Session nicht gefunden");
    }
  };

  /** Adoption (ADR-0011): hub-managed continuation of an observed session.
   * A subagent transcript is not continuable itself — its parent run is
   * (the subagent's work is part of that conversation). */
  const adopt = async (item: DiscoveredSession, asCopy: boolean) => {
    const native = item.parentSessionId ?? item.nativeSessionId;
    if (!native) return;
    setBusy(true);
    try {
      const record = await hubApi.createSession({
        adapter: item.adapter,
        project: item.project,
        adoptNativeSessionId: native,
        ...(asCopy ? { adoptFork: true } : {}),
        ...(item.title ? { title: item.title } : {}),
      });
      onOpen(record);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Übernehmen fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };

  /** Read-only mirror (ADR-0011 Erweiterung): show an observed opencode
   * session's chat exactly as it happened — nothing is started or taken
   * over; it keeps updating while open. */
  const mirror = async (item: DiscoveredSession) => {
    if (!item.nativeSessionId) return;
    setBusy(true);
    try {
      const record = await hubApi.createSession({
        adapter: item.adapter,
        project: item.project,
        mirrorNativeSessionId: item.nativeSessionId,
      });
      onOpen(record);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Spiegeln fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };

  if (items === null) return <EmptyState text={error || "lade…"} />;
  const searching = query.trim() !== "";
  const unsupported = items.filter((i) => i.status === "unsupported-format").length;
  const counts = stateCounts(items);

  return (
    <div class="discovery">
      <input
        class="discovery-search"
        type="search"
        placeholder={t("discovery.search_sessions_hint")}
        aria-label={t("discovery.search_sessions")}
        value={query}
        onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
      />
      <div class="discovery-kpis" role="group" aria-label={t("discovery.filter_state")}>
        {KPI.map(({ state, label }) => (
          <button key={state} type="button" class={`discovery-kpi state-${state}`} aria-pressed={stateFilter === state} onClick={() => setStateFilter(stateFilter === state ? null : state)}>
            <span class="discovery-kpi-count">{counts[state]}</span>
            <span class="discovery-kpi-label">{label}</span>
          </button>
        ))}
      </div>
      <div class="discovery-providers" role="group" aria-label={t("discovery.filter_provider")}>
        {adapterCounts(items).map(({ adapter, count }) => (
          <Chip key={adapter}  aria-pressed={adapterFilter.has(adapter)} onClick={() => toggleAdapter(adapter)} active={adapterFilter.has(adapter)}>
            {adapter} <span class="dim">{count}</span>
          </Chip>
        ))}
      </div>
      <div class="dashboard-summary dim">
        <span>{stateFilter || adapterFilter.size > 0 ? `${shown.length} von ${items.length} gefunden` : `${items.length} gefunden`}</span>
        {unsupported > 0 && <span class="badge risk-destructive">{unsupported} {t("discovery.unknown_format")}</span>}
      </div>
      {error && <div class="reply-error">{error}</div>}
      {items.length === 0 && <div class="ui-empty">{searching ? "keine Session passt zur Suche" : "keine Sessions gefunden"}</div>}
      {items.length > 0 && shown.length === 0 && <div class="ui-empty">{t("discovery.no_match")}</div>}
      {groups.map((group, i) => (
        <details key={`${group.project}|${searching}`} class="project-tile" open={(i === 0 && !group.temporary) || searching}>
          <summary class="project-tile-header">
            <span class="project-tile-name">{group.project}</span>
            <span class="dim">
              {group.total} {t("common.session_cap")}{group.total === 1 ? "" : "en"} {t("discovery.last_frag")} {observedAgo(group.newestAt)}
            </span>
          </summary>
          <div class="discovery-grid">
          {group.sessions.map((s) => {
            const row = (x: DiscoveredSession) => <DiscoveredRow key={`${x.hostId}|${x.adapter}|${x.nativeSessionId ?? x.hubSessionId}`} item={x} onOpen={open} onAdopt={registered === null || registered.has(x.adapter) ? adopt : undefined} onMirror={x.adapter === "opencode" ? mirror : undefined} />;
            const subs = (s.nativeSessionId && group.subagents[s.nativeSessionId]) || [];
            return (
              <div key={`${s.hostId}|${s.adapter}|${s.nativeSessionId ?? s.hubSessionId}`} class="discovery-thread">
                {row(s)}
                {subs.length > 0 && (
                  <details class="discovery-subagents">
                    <summary class="dim">
                      {subs.length} {t("discovery.subagent")}{subs.length === 1 ? "" : "en"}
                    </summary>
                    {subs.map(row)}
                  </details>
                )}
              </div>
            );
          })}
          </div>
        </details>
      ))}
      {cursor !== null && (
        <Button disabled={busy} onClick={() => void load(cursor)} class={busy ? "busy" : undefined}>
          {busy ? "lädt…" : "Mehr laden"}
        </Button>
      )}
    </div>
  );
}

/** First line of the card: what the session is about. A bare id is the last
 * resort — and says so, instead of looking like a name. */
/** Harnesses that can continue a session as a copy with its own id (`--fork-session`, `--fork`). */
const COPY_CAPABLE = new Set(["claude", "pi"]);

export function discoveryHeading(item: Pick<DiscoveredSession, "title" | "nativeSessionId" | "hubSessionId">): { text: string; untitled: boolean } {
  if (item.title) return { text: item.title, untitled: false };
  const id = item.nativeSessionId ?? item.hubSessionId ?? "";
  return { text: id ? `Ohne Titel · ${id.slice(0, 8)}` : "Ohne Titel", untitled: true };
}

const KPI: { state: DiscoveryState; label: string }[] = [
  { state: "live", label: "Läuft gerade" },
  { state: "resumable", label: "Fortsetzbar" },
  { state: "observed", label: "Nur beobachtet" },
  { state: "hub", label: "Im Hub" },
];

/** Etikett der Signalkante — der Zustand steht immer als Text, nie nur als Farbe. */
const STATE_LABEL: Record<DiscoveryState, string> = {
  live: "läuft gerade woanders",
  hub: "Im Hub",
  resumable: "fortsetzbar",
  observed: "nur beobachtet",
  unknown: t("discovery.unknown_format"),
};

function DiscoveredRow({ item, onOpen, onAdopt, onMirror }: { item: DiscoveredSession; onOpen: (id: string) => void; onAdopt?: (item: DiscoveredSession, asCopy: boolean) => void; onMirror?: (item: DiscoveredSession) => void }) {
  const unknown = item.status === "unsupported-format";
  const state = discoveryState(item);
  const heading = discoveryHeading(item);
  const id = item.nativeSessionId ?? item.hubSessionId ?? "";
  const [copied, setCopied] = useState(false);
  const copyId = () => {
    void copyIntoShelf(id, "kennung").then((ok) => {
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  // Titel 2 / Vorschau 2 / Meta 1 / Aktionen 1 — fehlende Teile behalten ihren Platz (CSS), damit alle Karten gleich hoch sind.
  const body = (
    <>
      <div class="discovery-head">
        <span class={`discovery-state state-${state}`}>{STATE_LABEL[state]}</span>
        <strong class={heading.untitled ? "discovery-title dim" : "discovery-title"}>{heading.text}</strong>
      </div>
      <div class="discovery-preview dim">{item.preview && item.preview !== item.title ? item.preview : ""}</div>
      <div class="discovery-meta dim">
        <span>{item.adapter}</span>
        <span>{observedAgo(item.observedAt)}</span>
        <span>{item.hubSessionId ? "Hub" : "extern · nur beobachtet"}</span>
        {item.worktree && <span title={t("discovery.ran_worktree")}>{t("common.worktree")} {item.worktree.slice(0, 12)}</span>}
        {item.parentSessionId && <span>{t("discovery.subagent_of")} {item.parentSessionId.slice(0, 8)}</span>}
      </div>
    </>
  );
  const copyCapable = COPY_CAPABLE.has(item.adapter);
  // A live session of a harness that cannot fork would have two writers: wait until it is closed over there.
  const blockedByLive = Boolean(item.live) && !copyCapable;
  const canContinue = Boolean(onAdopt && item.nativeSessionId && !unknown && !blockedByLive && !item.unsupportedResume);
  const hint = item.unsupportedResume && !unknown
    ? `Nur beobachtet — Fortsetzen ist für ${item.adapter} nicht belegt (ADR-0036).`
    : blockedByLive && onAdopt && !unknown
      ? "Läuft gerade woanders — dieser Harness kann keine Kopie fortsetzen. Erst dort beenden, dann hier fortsetzen."
      : "";
  return (
    <div class={`card discovery-card state-${state}`} data-testid="discovered-row">
      {item.hubSessionId ? (
        <button class="session-open" type="button" onClick={() => onOpen(item.hubSessionId!)}>
          {body}
        </button>
      ) : (
        <div class="session-open">{body}</div>
      )}
      <div class="discovery-actions">
        {!item.hubSessionId && canContinue && (
          <>
            {/* A transcript another process is writing right now is never shared: the copy has its own id. */}
            <Button
              onClick={() => onAdopt!(item, Boolean(item.live) && copyCapable)}
              title={item.live ? "Läuft gerade woanders — der Hub setzt eine Kopie mit eigener ID fort, das Original bleibt unberührt" : "Session in den Hub übernehmen und fortsetzen"}
            >
              {item.live ? "Als Kopie fortsetzen" : "Fortsetzen"}
            </Button>
            {!item.live && copyCapable && (
              <Button onClick={() => onAdopt!(item, true)} title={t("discovery.own_copy")} class="subtle">
                {t("discovery.as_copy")}
              </Button>
            )}
          </>
        )}
        {!item.hubSessionId && onMirror && item.nativeSessionId && !unknown && (
          <Button onClick={() => onMirror(item)} title={t("discovery.mirror_history")}>
            {t("discovery.mirror")}
          </Button>
        )}
        {hint && !item.hubSessionId && (
          <span class="dim discovery-hint" title={hint}>
            {hint}
          </span>
        )}
        <details class="card-menu">
          <summary aria-label={t("discovery.more_details")}>⋯</summary>
          <div class="card-menu-body">
            <div class="card-menu-row">
              <span class="dim">{t("discovery.id")}</span>
              <span class="mono discovery-id">{id || "—"}</span>
            </div>
            <div class="card-menu-row">
              <span class="dim">{t("status.harness")}</span>
              <span>{item.harness}</span>
            </div>
            {item.fork && (
              <div class="card-menu-row">
                <span class="dim">{t("discovery.type")}</span>
                <span>{t("discovery.fork")}</span>
              </div>
            )}
            <Button disabled={!id} onClick={copyId} class="subtle">
              {copied ? "Kopiert" : "ID kopieren"}
            </Button>
          </div>
        </details>
      </div>
    </div>
  );
}
