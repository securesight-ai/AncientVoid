import { useEffect, useRef, useState } from "preact/hooks";
import { hubApi, hostApi, type HubNotification } from "../../shared/api.ts";
import { t, resolveNotificationTitle } from "../../shared/i18n/index.ts";
import { fmtDate } from "../../shared/i18n/format.ts";
import { sessionHash } from "../../app/route.ts";
import { registerShortcut } from "../../shared/shortcuts/registry.ts";
import { useOverlayFocus } from "../../shared/overlay-focus.ts";
import { Button } from "../../shared/ui/index.ts";
import { hasApprovalCandidates, urgencyOf, MAIN_SYNC_ACTION_KINDS, APPROVAL_KINDS } from "./urgency.ts";
import { SECTION_KEYS, defaultExpanded, sectionOf, type SectionKey } from "./sections.ts";
import { soundPlayer, loadSoundSettings, saveSoundSettings } from "../../shared/audio.ts";
import { applyNotificationPage, type FleetNotification } from "./merge.ts";
import { soundCategoryOf } from "./sound-category.ts";
const READ_KEY = "ancientvoid.notifications.readUpTo";
/** EPIC-P6: read marks of other hosts, { hostId: lastReadId }. */
const PEER_READ_KEY = "ancientvoid.notifications.readByHost";
const POLL_MS = 4000;
/** BUG-0049: a short blip (a few seconds) is no outage — announce "nicht erreichbar" (and later "wieder da") only after this many failed polls in a row. */
const HUB_DOWN_AFTER = 3;
const PEERS_REFRESH_MS = 60_000;
/** Errors stay longer — they usually need an action. Warnings too: a warning
 * that vanishes before it is read (observed 2026-10-24, 8 s) is noise, not a
 * notification. Success/info stay short. */
const TOAST_MS: Record<HubNotification["level"], number> = { error: 30_000, warning: 25_000, success: 6000, info: 8000 };

interface Toast {
  key: string;
  level: HubNotification["level"];
  /** Kind der Meldung (null bei lokalen Status-Toasts) — steuert die
   * Rückfrage-Färbung blau statt Level-gelb (Nutzerwunsch 2026-11-20). */
  kind: string | null;
  title: string;
  detail: string | null;
  sessionId: string | null;
  hostId: string | null;
}

/** Nutzerwunsch 2026-11-20: Rückfragen toasten blau — gleiche Kinds wie
 * questions-Sektion und action-Glow (Single Source urgency.ts). */
function isQuestionKind(kind: string | null): boolean {
  return kind !== null && (APPROVAL_KINDS.has(kind) || MAIN_SYNC_ACTION_KINDS.has(kind));
}

function readMarks(): Record<string, number> {
  let peers: Record<string, number> = {};
  try {
    peers = JSON.parse(localStorage.getItem(PEER_READ_KEY) ?? "{}") as Record<string, number>;
  } catch {
    peers = {};
  }
  return { ...peers, "": Number(localStorage.getItem(READ_KEY) ?? 0) || 0 };
}

function saveReadMarks(marks: Record<string, number>): void {
  const { "": local = 0, ...peers } = marks;
  localStorage.setItem(READ_KEY, String(local));
  localStorage.setItem(PEER_READ_KEY, JSON.stringify(peers));
}

function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return t("time.now");
  if (seconds < 3600) return t("time.minutes_ago", { "n": Math.floor(seconds / 60) });
  if (seconds < 86_400) return t("time.hours_ago", { "n": Math.floor(seconds / 3600) });
  return fmtDate(iso);
}

/** T8.1: at most two toasts over the content — errors first; the rest
 * waits in the bell instead of covering the overview. */
const TOASTS_SHOWN = 2;
const TOAST_RANK: Record<string, number> = { error: 0, warning: 1, info: 2, success: 3 };

function visibleToasts<T extends { level: string }>(toasts: T[]): T[] {
  return [...toasts].sort((a, b) => (TOAST_RANK[a.level] ?? 9) - (TOAST_RANK[b.level] ?? 9)).slice(0, TOASTS_SHOWN);
}

/**
 * ADR-0015: toasts top right for new errors and status changes, plus a bell
 * with the recent list. Polls the hub; the first load only fills the list,
 * so opening the app never replays old toasts.
 */

/** `corner`: the list column is folded away, so bell and gear sit in the window corner.
 * EPIC-P64 T64.4: `flow` — am PC mit sichtbarer Liste sitzt die Glocke als
 * Flusselement im Kopf der Listenspalte (App-Topbar), nicht als Overlay. */
/** Nutzerwunsch 2026-11-20: vier Abschnitte mit fester Farbbedeutung —
 * Fehler (rot), Rückfrage (blau), Fertig (grün), Sonstiges (gelb); die Farbe
 * trägt die CSS-Klasse je Abschnitt (14-notifications.css). */
export const SECTION_LABEL: Record<SectionKey, string> = { errors: t("notifications.section_errors"), questions: t("notifications.section_question"), done: t("notifications.section_done"), rest: t("notifications.section_rest") };
export function NotificationCenter({ corner = false, flow = false }: { corner?: boolean; flow?: boolean }) {
  const [items, setItems] = useState<FleetNotification[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [open, setOpen] = useState(false);
  const [read, setRead] = useState(readMarks);
  /** Nutzerwunsch 2026-11-18: einklappbare Abschnitte — Vorgabe beim Öffnen
   * (und bei Neuankünften im offenen Panel): nur Ungesehenes steht offen. */
  const [expanded, setExpanded] = useState<Record<SectionKey, boolean>>({ errors: true, questions: true, done: true, rest: true });
  /** Sessions mit noch offener Freigabe/Frage — live geprüft, damit eine
   * beantwortete Frage aus dem angepinnten Abschnitt verschwindet. */
  const [pendingApprovals, setPendingApprovals] = useState<ReadonlySet<string>>(new Set());
  // EPIC-P51 T51.6: Esc schließt das Panel, Fokus rein/Tab-Falle/zurück auf die Glocke.
  const closeBtn = useRef<HTMLButtonElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);
  /** T64.4: gemessene Panel-Position (nur Fluss-Modus). */
  const [panelPos, setPanelPos] = useState<{ top: string; left: string; width: string } | undefined>(undefined);
  const { ref: panelRef } = useOverlayFocus<HTMLDivElement>(open, { preferred: () => closeBtn.current });
  const openRef = useRef(false);
  /** T65.4: Master-Schalter am Panel — persistiert wie die Tone-Einstellungen. */
  const [soundMuted, setSoundMuted] = useState(() => !loadSoundSettings().master);
  const toggleSoundMaster = () => {
    const next = !soundMuted;
    setSoundMuted(next);
    saveSoundSettings({ ...loadSoundSettings(), master: !next });
  };
  const closePanel = () => {
    openRef.current = false;
    setOpen(false);
  };
  /** T64.3: Spiegel des Bestands für den Poll (Hintergrund-Pending-Refresh),
   * ohne den Effect bei jeder Liste neu zu binden. */
  const itemsRef = useRef<FleetNotification[]>([]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  // Neu Angelangtes und frisch geladene Freigaben klappen Abschnitte auf,
  // solange das Panel offen ist — Ungesehenes und offene Fragen sollen nicht
  // hinter einem zugeklappten Kopf warten. Ein manueller Griff des Nutzers an
  // einen Kopf bleibt davon unberührt (aufgeklappt wird nur, nie zu).
  useEffect(() => {
    if (!open) return;
    setExpanded((prev) => {
      const want = defaultExpanded(items, read, pendingApprovals);
      const next: Record<SectionKey, boolean> = { ...prev };
      let changed = false;
      for (const key of SECTION_KEYS) {
        if (want[key] && !prev[key]) {
          next[key] = true;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [items, open, read, pendingApprovals]);
  useEffect(() => {
    if (!open) return;
    return registerShortcut("notifications.close", (e) => {
      e.preventDefault();
      closePanel();
    });
  }, [open]);
  // Per host (key "" = this hub): newest id seen; null = not loaded yet.
  const lastIds = useRef<Record<string, number | null>>({});
  const peers = useRef<string[]>([]);
  const failures = useRef(0);

  const toast = (t: Toast) => {
    setToasts((prev) => [t, ...prev].slice(0, 4));
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.key !== t.key)), TOAST_MS[t.level]);
  };
  const take = (hostId: string | null, page: { items: HubNotification[]; lastId: number }) => {
    const key = hostId ?? "";
    const known = lastIds.current[key] ?? null;
    const stamped = page.items.map((n) => ({
      ...n,
      hostId,
      key: `${key}#${n.id}`,
      title: hostId ? `${hostId} · ${resolveNotificationTitle(n)}` : resolveNotificationTitle(n),
    }));
    // BUG-0222: eine Seite, die ein überlappender Poll nochmal liefert, spielt
    // nichts nach — bereits Gesehenes (id <= known) wird gefiltert, der
    // Bestand behält jeden key genau einmal.
    const prev = itemsRef.current;
    const { added, next } = applyNotificationPage(prev, stamped, known);
    if (known !== null) {
      // T8.6: "Zug fertig" goes to the bell only — with many sessions its
      // toasts covered the controls at the top for seconds (P8 Messlauf).
      // EPIC-P65: der Sound dazu läuft trotzdem — pro neu ankommende Meldung
      // (nie beim Laden), Kategorie-Mapping im getesteten Modul, Rate-Limit im Modul.
      for (const n of [...added].reverse()) {
        const show = () => toast({ key: n.key, level: n.level, kind: n.kind, title: n.title, detail: n.detail, sessionId: n.sessionId, hostId });
        // Premortem P8-2: an approval decided meanwhile (e.g. a peer's
        // notification that arrived late) is no toast any more.
        if (APPROVAL_KINDS.has(n.kind))
          void hostApi(hostId)
            .approvals("pending")
            .then((pending) => {
              const istPending = pending.some((a) => a.sessionId === n.sessionId);
              if (istPending) show();
              const cat = soundCategoryOf({ ...n, pending: istPending });
              if (cat) void soundPlayer.playCategory(cat);
            })
            .catch(show);
        else {
          if (n.kind !== "session.turn_end") show();
          const cat = soundCategoryOf({ ...n, pending: false });
          if (cat) void soundPlayer.playCategory(cat);
        }
      }
    }
    // auch am 100er-Cap (gleiche Länge, neuer Kopf) wird die Liste neu gesetzt
    if (added.length > 0 || next.length > prev.length) {
      itemsRef.current = next;
      setItems(next);
    }
    lastIds.current[key] = Math.max(known ?? 0, page.lastId);
  };

  /** Nutzerfund 2026-11-15: „Braucht dich“ sichtbar halten — Fehler und offene
   * Fragen stehen angepinnt oben, der Rest darunter. Offen heißt: zu dieser
   * Session wartet wirklich noch eine Freigabe (live gegen die Freigabe-
   * Warteschlange geprüft, eigener Hub und Peers). */
  const refreshPending = () => {
    const next = new Set<string>();
    const collect = (hostId: string | null) => (list: { sessionId: string }[]) => {
      for (const a of list) next.add(`${hostId ?? ""}#${a.sessionId}`);
    };
    void Promise.all([
      hubApi.approvals("pending").then(collect(null)).catch(() => undefined),
      ...peers.current.map((h) => hostApi(h).approvals("pending").then(collect(h)).catch(() => undefined)),
    ]).then(() =>
      setPendingApprovals((prev) => (prev.size === next.size && [...next].every((k) => prev.has(k)) ? prev : next)),
    );
  };

  useEffect(() => {
    let alive = true;
    const loadPeers = () =>
      hubApi
        .fleetPeers()
        .then((list) => (peers.current = list.map((p) => p.hostId)))
        .catch(() => undefined);
    // BUG-0222: nie zwei Polls gleichzeitig — ein träger Peer macht einen
    // Poll länger als POLL_MS; überlappende Antworten würden dieselben
    // Meldungen nachspielen. Der nächste Tick holt nach, was diese Runde
    // verpasst (der Cursor steht ja erst nach der Antwort).
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        try {
          const page = await hubApi.notifications(lastIds.current[""] ?? 0);
          if (!alive) return;
          if (failures.current >= HUB_DOWN_AFTER) toast({ key: `hub-${Date.now()}`, level: "success", kind: null, title: t("notifications.hub_back"), detail: null, sessionId: null, hostId: null });
          failures.current = 0;
          take(null, page);
        } catch {
          if (!alive) return;
          failures.current += 1;
          if (failures.current === HUB_DOWN_AFTER) {
            toast({ key: `hub-${Date.now()}`, level: "warning", kind: null, title: t("notifications.hub_down"), detail: t("notifications.hub_down_detail"), sessionId: null, hostId: null });
          }
        }
        // EPIC-P6 T6.6: other hosts' notifications through this hub. A host
        // that is away stays quiet here — the overview shows its state.
        await Promise.all(
          peers.current.map((hostId) =>
            hostApi(hostId)
              .notifications(lastIds.current[hostId] ?? 0)
              .then((page) => alive && take(hostId, page))
              .catch(() => undefined),
          ),
        );
        // EPIC-P64 T64.3: offene Fragen werden im Hintergrund verfeinert — der
        // action-Glow braucht die Pending-Menge, auch wenn niemand das Panel
        // offen hat. Nur mit Kandidaten im Bestand (kein API-Ruf je 4 s ohne
        // Anlass); bei offenem Panel wie bisher immer (feinere Liste).
        if (alive && (openRef.current || hasApprovalCandidates(itemsRef.current))) refreshPending();
      } finally {
        polling = false;
      }
    };
    void loadPeers().then(() => poll());
    const timer = setInterval(() => void poll(), POLL_MS);
    const peerTimer = setInterval(() => void loadPeers(), PEERS_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
      clearInterval(peerTimer);
    };
  }, []);

  const unread = items.filter((n) => n.id > (read[n.hostId ?? ""] ?? 0)).length;

  /** EPIC-P64 T64.2: höchste offene Dringlichkeit steuert den Glow der Glocke. */
  const urgency = urgencyOf(items, read, pendingApprovals);

  const sections: Record<SectionKey, FleetNotification[]> = { errors: [], questions: [], done: [], rest: [] };
  for (const n of items) sections[sectionOf(n, pendingApprovals)].push(n);
  const toggleSection = (key: SectionKey) =>
    setExpanded((prev) => {
      const next: Record<SectionKey, boolean> = { ...prev };
      next[key] = !prev[key];
      return next;
    });

  const runAction = async (n: FleetNotification) => {
    if (!n.action) return;
    const item = itemsRef.current.find((i) => i.key === n.key);
    if (item) item.actionBusy = true;
    setItems([...itemsRef.current]);
    try {
      // EPIC-P67 T67.6: derselbe Endpunkt wie das Session-Menü — auf dem
      // Host der Benachrichtigung (Fleet-Hosts haben eigene Sessions).
      await hostApi(n.hostId).runNotificationAction(n.action.path);
      goTo(n.sessionId, n.hostId);
    } catch {
      // Fail loud (AGENTS.md): ein gescheiterter Aktionsruf darf nicht nur den
      // Knopf freigeben — der Nutzer sieht sonst nicht, dass nichts passierte.
      toast({ key: `action-${n.key}-${Date.now()}`, level: "error", kind: null, title: t("notifications.action_failed"), detail: n.title, sessionId: n.sessionId, hostId: n.hostId });
    } finally {
      const done = itemsRef.current.find((i) => i.key === n.key);
      if (done) done.actionBusy = false;
      setItems([...itemsRef.current]);
    }
  };

  const row = (n: FleetNotification) => (
    <div key={n.key} class={`notif-item ${n.level}`}>
      <button class="notif-item-main" type="button" onClick={() => goTo(n.sessionId, n.hostId)}>
        <span>{n.title}</span>
        {n.detail && <span class="notif-item-detail">{n.detail}</span>}
        <span class="notif-item-time">{timeAgo(n.createdAt)}</span>
      </button>
      {n.action && (
        <Button class="notif-item-action" disabled={n.actionBusy} onClick={() => void runAction(n)}>
          {n.actionBusy ? t("common.running") : n.action.label}
        </Button>
      )}
    </div>
  );

  const openPanel = () => {
    setOpen((was) => {
      openRef.current = !was;
      return !was;
    });
    if (!openRef.current) return;
    // EPIC-P64 T64.4/T64.5: im Fluss-Modus hängt das Panel gemessen unter
    // der Glocke (rechtsbündig zu ihr) — robust für jede Spaltenbreite und
    // UI-Skalierung, statt die Geometrie in CSS nachzubauen. Rect ist in
    // Render-Px, Inline-Styles in CSS-px — daher die Zoom-Division
    // (--ui-zoom ist CSS `zoom` auf <html>, Muster siehe 14-notifications.css).
    if (flow) {
      const zoom = Number(document.documentElement.style.getPropertyValue("--ui-zoom")) || 1;
      const rect = bellRef.current?.getBoundingClientRect();
      if (rect) {
        const width = Math.min(380, window.innerWidth / zoom - 16);
        const cssRight = rect.right / zoom;
        setPanelPos({
          top: `${Math.round(rect.bottom / zoom + 8)}px`,
          left: `${Math.max(8, Math.round(cssRight - width))}px`,
          width: `${Math.round(width)}px`,
        });
      }
    }
    refreshPending();
    // Nutzerwunsch 2026-11-18: Einklapp-Vorgabe aus dem Ungesehenen ableiten —
    // zwingend vor dem Setzen der Read-Marks, danach wäre alles gesehen.
    setExpanded(defaultExpanded(items, read, pendingApprovals));
    const marks = { ...read };
    for (const n of items) marks[n.hostId ?? ""] = Math.max(marks[n.hostId ?? ""] ?? 0, n.id);
    saveReadMarks(marks);
    setRead(marks);
  };

  const goTo = (sessionId: string | null, hostId: string | null) => {
    closePanel();
    if (sessionId) location.hash = sessionHash(sessionId, hostId);
  };

  return (
      <>
      <button
        ref={bellRef}
        class={`notif-bell${corner ? " corner" : ""}${flow ? " flow" : ""}${urgency ? ` urgency-${urgency}` : ""}`}
        type="button"
        aria-label={unread > 0 ? t("notifications.unread_count", { "n": unread }) : t("notifications.title")}
        title={t("notifications.title")}
        onClick={openPanel}
      >
        🔔{unread > 0 && <span class="notif-count">{unread > 9 ? "9+" : unread}</span>}
      </button>
      <div class="toast-stack" role="status" aria-live="polite">
        {visibleToasts(toasts).map((toastItem) => (
          <div key={toastItem.key} class={`toast ${toastItem.level}${isQuestionKind(toastItem.kind) ? " question" : ""}`}>
            <button class="toast-body" type="button" onClick={() => goTo(toastItem.sessionId, toastItem.hostId)}>
              <strong>{toastItem.title}</strong>
              {toastItem.detail && <span>{toastItem.detail}</span>}
            </button>
            <button class="toast-close" type="button" aria-label={t("notifications.close")} onClick={() => setToasts((prev) => prev.filter((x) => x.key !== toastItem.key))}>
              ✕
            </button>
          </div>
        ))}
        {toasts.length > TOASTS_SHOWN && (
          <button class="toast-more" type="button" onClick={openPanel}>
            +{toasts.length - TOASTS_SHOWN} {t("notifications.more_suffix")}
          </button>
        )}
      </div>
      {open && (
        <div
          class={`notif-panel${corner ? " corner" : ""}${flow ? " flow" : ""}`}
          {...(flow && panelPos ? { style: panelPos } : {})}
          role="dialog"
          aria-label={t("notifications.title")}
          ref={panelRef}
          tabIndex={-1}
        >
          <div class="notif-panel-head">
            <strong>{t("notifications.title")}</strong>
            <Button
              icon
              onClick={toggleSoundMaster}
              aria-pressed={soundMuted}
              aria-label={t("notifications.sound_toggle")}
              title={t("notifications.sound_toggle_hint")}
              data-testid="notif-sound-toggle"
            >
              {soundMuted ? "🔇" : "🔊"}
            </Button>
            <Button ref={closeBtn} onClick={closePanel}>
              ✕
            </Button>
          </div>
          {items.length === 0 ? (
            <div class="ui-empty">{t("notifications.empty")}</div>
          ) : (
            <>
              {SECTION_KEYS.map((key) => {
                const list = sections[key];
                if (list.length === 0) return null;
                return (
                  <section key={key} class={`notif-section ${key}`} aria-label={SECTION_LABEL[key]}>
                    {/* Nutzerwunsch 2026-11-18: ganze Kopfzeile klappt den Abschnitt
                     * (Muster .section-fold der Übersicht, EPIC-P43 T43.3). */}
                    <h3 class="section-title">
                      <button class="section-fold" type="button" aria-expanded={expanded[key]} onClick={() => toggleSection(key)}>
                        <span class="section-fold-mark" aria-hidden="true" />
                        {SECTION_LABEL[key]} <span class="dim num">{list.length}</span>
                      </button>
                    </h3>
                    {expanded[key] && list.map(row)}
                  </section>
                );
              })}
            </>
          )}
        </div>
      )}
    </>
  );
}
