import { fmtDateTime } from "../../shared/i18n/format.ts";
import { t } from "../../shared/i18n/index.ts";
import { dayLabel, needsDaySeparator } from "../../shared/i18n/day-label.ts";
import { openWorkspaceContent } from "../workspace/open-content.ts";
import { StatusNote } from "./StatusNote.tsx";
import type { ComponentChildren } from "preact";
import { InterruptedBanner } from "./InterruptedBanner.tsx";
import { copyIntoShelf } from "../../shared/clipboard-copy.ts";
import { readTailScroll, writeTailScroll } from "./tail-scroll.ts";
import { sessionHash, fileHash } from "../../app/route.ts";
import { registerShortcut } from "../../shared/shortcuts/registry.ts";
import {
  sourcesBlock,
  sourcesOf,
  consumeSources,
  type SourceRef,
} from "../../shared/sources.ts";
import { HandoverBar } from "./Handover.tsx";
import { RecoveryHandover } from "./RecoveryHandover.tsx";
import { currentProviderFailure } from "./handover.ts";
import { TabIcon, type TabIconName } from "../../shared/TabIcon.tsx";
import {
  openPopout,
  postWindowMessage,
  useOpenWindows,
} from "../windows/windows.ts";
import { DetachButton } from "../windows/DetachButton.tsx";
import {
  VIEW_LABEL,
  viewKindOfTab,
  windowFor,
  type ViewTab,
  type WindowTarget,
} from "../windows/protocol.ts";
import { Fragment } from "preact";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import { ApiContext } from "../../shared/api-context.ts";
import {
  getToken,
  hostApi,
  remoteHost,
  newInputId,
  steerRejectText,
  type SessionRecord,
  type AdapterUsage,
  type SessionDiffResult,
  type AttachmentRecord,
  type HarnessFeatures,
  type RunEstimate,
  type SessionTokenTotals,
  type MainSyncCheckDto,
} from "../../shared/api.ts";
import {
  connectTail,
  type NormalizedEvent,
  type TailConnection,
} from "../../shared/ws.ts";
import { Composer } from "../composer/Composer.tsx";
import type { SlashCommand } from "../composer/slash.ts";
import { SessionConfigure } from "./SessionConfigure.tsx";
import { WorkplaceBadge } from "./WorkplaceBadge.tsx";
import { QueueList } from "./QueueList.tsx";
import { sessionRefFor } from "./tool-image.ts";
import { PcOpenNotice } from "./PcOpenNotice.tsx";
import { WorkspaceRuntimePane } from "../workspace/runtime/WorkspaceRuntimePane.tsx";
import type { Page } from "../../app/Dock.tsx";
import { SearchPane } from "../search/Search.tsx";
import { CodePane } from "../code/CodePane.tsx";
import { GraphPane } from "../graph/GraphPane.tsx";
import { GitGraphPane } from "../git-graph/GitGraphPane.tsx";
import { FileViewer } from "../files/FileViewer.tsx";
import { StatusDot } from "../../shared/StatusDot.tsx";
import { getHubStatus, publishHubStatus, useHubStatus } from "../shell/hub-status.ts";
import { statusHintFromBatch } from "./status-from-events.ts";
import {
  getHere,
  registerField,
  setHere,
  touchField,
} from "../../shared/command-context.ts";
import { useDraft } from "./draft.ts";
import { takeHandOver } from "../../shared/media.ts";
import { getSeen, markSeen, seenKey } from "../../shared/seen.ts";
import { loadTail, saveTail } from "./tail-cache.ts";
import { QuickConfirm, lastAssistantQuestion } from "./QuickConfirm.tsx";
import { backgroundActivities } from "./background-activities.ts";
import type { CodeTarget } from "../../app/route.ts";
import {
  estimateText,
  formatMinutes,
  quotaSummary,
  runProgress,
} from "./run-progress.ts";
import { StatusLine } from "./StatusLine.tsx";
import { ChangesHead, changeSummary } from "./ChangesHead.tsx";
import { openLayer } from "../../shared/layers.ts";
import { ChatTurns, itemFirstSeq, itemLastSeq } from "./ChatTurns.tsx";
import { turnsOf } from "./turns.ts";
import { PinnedPrompt } from "./PinnedPrompt.tsx";
import {
  lastUserPrompt,
  tailWindow,
  useRecoveredPrompt,
} from "./last-prompt.ts";
import { useChatEvents } from "./event-blobs.ts";
import { LoopBadge, LoopPanel } from "../loops/LoopPanel.tsx";
import { deriveLoopView } from "../loops/loop-view.ts";
import {
  turnTokenStats,
  turnsClosedBetween,
  contextText,
  contextLevel,
  contextWindowFromEvents,
  outputLimitFromEvents,
  latestModelName,
  turnStatsText,
} from "./run-stats.ts";
import {
  type FilterPreset,
  FILTERS,
  loadFilter,
  toolIdOf,
} from "./event-filter.ts";
import { EventRow } from "./EventRow.tsx";
import { DiffReview } from "./DiffReview.tsx";
import { ForgePanel } from "../forge/ForgePanel.tsx";
import { ReportPane } from "./ReportPane.tsx";
import { SessionApprovals } from "./SessionApprovals.tsx";
import { projectName } from "../../shared/project-name.ts";
import { Button, Chip, ConfirmDialog } from "../../shared/ui/index.ts";
import { MainSyncModal } from "./MainSyncModal.tsx";
/** BUG-0053: below this window height (landscape) the dock is compacted and the controls start folded. */
const SHORT_VIEWPORT_PX = 520;
/** A tile without focus renders new events at most this often (K2 budget 200 ms). */
const BACKGROUND_FLUSH_MS = 50;
/** Rows a tile without focus keeps in the DOM. */
const BACKGROUND_ROWS = 150;
/** Rows the focused session keeps by default. BUG-0211: wer nach oben scrollt, bekommt die
 *  frueheren Eintraege dazu — ab der geladenen Unterkanze wird nichts mehr verworfen. */
const TAIL_ROWS = 500;
/** Tabs that read rather than talk: the composer folds away in a desktop tile. */
const READING_TABS: ReadonlySet<string> = new Set([
  "diff",
  "forge",
  "bericht",
  "suche",
  "code",
  "umgebung",
  "graph",
  "git",
  "datei",
]);

/** EPIC-P18: set when this view is one tile of the desktop workspace —
 * several SessionTails then share one page. */
export interface TileContext {
  /** The focused tile owns the command context (T9.4). */
  active: boolean;
  /** A small tile starts with the controls folded away (P18 premortem 3). */
  compact: boolean;
  /** EPIC-P43 T43.6: der Kachelkopf — Griff und Nummer vorn, Herauslösen und Leeren hinten; die Reiter
   * stehen dazwischen statt in einer senkrechten Leiste. */
  head?: { start: ComponentChildren; end: ComponentChildren };
  /** EPIC-P43 T43.7 (ADR-0068): ein Ansichtsfenster zeigt genau diesen Reiter — ohne Reiter, Antwortfeld und Menü. */
  only?: ViewTab;
}

/** Symbole der Zustellwahl (ADR-0085, Nachtrag 18.11.): Linienzeichen statt Emoji —
 *  das Emoji ⏳/⚡ wurde geräteabhängig farbig und wirkte neben dem Formknopf wie ein
 *  Rest aus Chat-Apps. Linienbreite und Strichenden folgen dem Zeichen-Idiom des
 *  Composers (siehe features/composer/Composer.tsx). */
const CHOICE_GLYPH = {
  viewBox: "0 0 24 24",
  width: 18,
  height: 18,
  fill: "none",
  stroke: "currentColor",
  "stroke-width": 1.8,
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
  "aria-hidden": true,
} as const;

/** Warte-Zeit: die Meldung geht am Zugende raus. Uhrlinien (Kreis + Zeiger) sind bei 16 px
 *  eindeutiger als eine Sanduhr — die gefuellte Sanduhr las sich im Screenshot wie ein Pokal. */
function WaitGlyph() {
  return (
    <svg {...CHOICE_GLYPH}>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 7.3V12l3.3 2" />
    </svg>
  );
}

/** Blitz: die Meldung lenkt jetzt in den laufenden Zug. */
function BoltGlyph() {
  return (
    <svg {...CHOICE_GLYPH}>
      <path d="M13 3 6.5 13h4L9.5 21 17 10.5h-4.2L13 3Z" />
    </svg>
  );
}

/** Ein Hash muss als Suchmuster passen: Hostkürzel enthalten Punkte. */
function escapeForRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fitSessionMenu(menu: HTMLDetailsElement | null): void {
  if (!menu?.open) return;
  const items = menu.querySelector<HTMLElement>(".session-menu-items");
  if (!items) return;
  const top = items.getBoundingClientRect().top;
  let bottom = window.visualViewport
    ? window.visualViewport.offsetTop + window.visualViewport.height
    : window.innerHeight;
  for (let parent = menu.parentElement; parent; parent = parent.parentElement) {
    if (/^(hidden|clip|auto|scroll)$/.test(getComputedStyle(parent).overflowY))
      bottom = Math.min(bottom, parent.getBoundingClientRect().bottom);
  }
  const zoom =
    Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--ui-zoom"),
    ) || 1;
  items.style.maxHeight = `${Math.max(1, bottom - top - 8) / zoom}px`;
}

export function SessionTail({
  session,
  onNavigate,
  onArchived,
  initialCode,
  initialSeq,
  seqAt,
  initialTab,
  initialFile,
  workspaceTab,
  tile,
}: {
  session: SessionRecord;
  onNavigate: (page: Page) => void;
  /** Archiviert (auch von einem anderen Gerät): die Kachel am PC räumt
   * ihre Session ab. Ohne Kachelkontext springt die Ansicht selbst in
   * die Übersicht zurück. */
  onArchived?: () => void;
  initialCode?: CodeTarget;
  /** Fundstelle aus der Hash-Route (`…/seq/474`): die Sitzung öffnet sich und der
   * Chat läuft zu der Nachricht, die den Fund trägt. */
  initialSeq?: number;
  /** Marke derselben Bitte: ein zweiter Tipp auf dieselbe Karte ist eine neue Bitte. */
  seqAt?: number;
  /** EPIC-P48 / ADR-0071: Graph-, Git- oder Datei-Tab (Hash-Routen). */
  initialTab?: "graph" | "git" | "datei";
  initialFile?: string | null;
  workspaceTab?: import("../workspace/content.ts").SessionTab;
  tile?: TileContext;
}) {
  // EPIC-P6: every call of this view goes to the session's own host.
  const api = useMemo(() => hostApi(session.hostId), [session.hostId]);
  // Bildvorschau gelesener Bilder (Nutzerfund 2026-11-23): nur eigene Sitzungen,
  // weil die Rohroute die Projektwurzel dieses Hubs braucht. Fremde Sitzungen
  // zeigen deshalb keine Vorschau — auch keine falsche Fehlermeldung.
  const sessionRef = useMemo(
    () => sessionRefFor(session, remoteHost(session.hostId)),
    [session.hostId, session.id, session.project],
  );
  const [events, setEvents] = useState<NormalizedEvent[]>([]);
  // EPIC-P67 T67.8: Main-Sync-Stand der Session (N hinter main). null = kein
  // Stand (noch nicht geladen, kein Git/Remote oder direkter Modus) — dann
  // gibt es weder Hinweis noch Menüpunkte, still und ehrlich.
  const [mainSync, setMainSync] = useState<MainSyncCheckDto | null>(null);
  const [mainSyncBusy, setMainSyncBusy] = useState(false);
  const [mainSyncResult, setMainSyncResult] = useState<string | null>(null);
  const [mainSyncModalOpen, setMainSyncModalOpen] = useState(false);
  const [deleteAsk, setDeleteAsk] = useState(false);
  // BUG-0219: Die Abfrage gehört zur Auswahl, nicht zum Mount. Generation und
  // In-Flight-Merker lassen nur die zuletzt gestellte Frage den Stand setzen —
  // eine späte Antwort kann nie einen neueren Stand überschreiben.
  const mainSyncGen = useRef(0);
  const mainSyncAsked = useRef(false);
  const refreshMainSync = async (): Promise<void> => {
    if (mainSyncAsked.current) return;
    mainSyncAsked.current = true;
    const gen = ++mainSyncGen.current;
    try {
      const check = await api.mainSyncCheck(session.id);
      if (gen !== mainSyncGen.current) return;
      setMainSync(check);
      setMainSyncResult(null);
    } catch {
      if (gen !== mainSyncGen.current) return;
      setMainSync(null);
    } finally {
      mainSyncAsked.current = false;
    }
  };
  useEffect(() => {
    void refreshMainSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);
  // BUG-0219: Auswahl ohne Remount (Kachelfokus) und Rückkehr zur offenen
  // Ansicht (Sichtbarkeit) stellen dieselbe Frage erneut — der Hinweis zeigt
  // sonst weiter den Stand eines früheren Zeitpunkts.
  const tileActive = tile?.active ?? true;
  useEffect(() => {
    if (tileActive) void refreshMainSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tileActive]);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && tileActive) void refreshMainSync();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tileActive]);
  /** ADR-0083: Teiltexte des Adapters, bis der dauerhafte Block eintrifft. Kein
   * Nacherzählen: was hier steht, ist wirklich schon uebertragen worden. */
  const [liveText, setLiveText] = useState<{
    assistant: string;
    thinking: string;
  }>({ assistant: "", thinking: "" });
  // 2026-10-25: click-to-expand for the run strip's todo plan (transparency).
  const [todosOpen, setTodosOpen] = useState(false);
  const [recoveryHandover, setRecoveryHandover] = useState(false);
  // T8.2: what this device saw last — until live events arrive.
  const hostKey = remoteHost(session.hostId) ?? "local";
  const [cached] = useState(() => loadTail(hostKey, session.id));
  const [online, setOnline] = useState(() => navigator.onLine);
  // Markieren → Auto-Zwischenablage (Nutzer-Anforderung 2026-10-30): eine
  // fertige Textauswahl im Verlauf landet ohne Kopieren-Knopf in der
  // Clipboard — pointerup ist die Nutzer-Geste, die writeText erlaubt.
  // Auswahl außerhalb des Verlaufs (z. B. Eingabefeld) bleibt unberührt.
  const [copyFlash, setCopyFlash] = useState(false);
  useEffect(() => {
    let flashTimer: number | undefined;
    const onUp = (ev: PointerEvent) => {
      const el = tailRef.current;
      const sel = window.getSelection();
      const text = sel?.toString() ?? "";
      // Nur die Geste ueber dem Verlauf selbst zaehlt: ein spaeterer Tipp anderswo
      // (z. B. im Ablage-Blatt) darf eine stehende Auswahl nicht erneut einlagern —
      // sonst kommt eine soeben entfernte Stufe zurueck (copyIntoShelf schiebt
      // asynchron nach dem Clipboard-Versuch).
      if (!(ev.target instanceof Node) || !el?.contains(ev.target)) return;
      if (!el || !sel || !text.trim() || !el.contains(sel.anchorNode)) return;
      // BUG-0107: transient abgelehntes writeText wurde still geschluckt — der Flash ist
      // der Beleg fürs Kopieren, ein Einzel-Retry gehört dazu. ADR-0090: ohne Clipboard-API
      // bleibt die Auswahl trotzdem eine Stufe in der Ablage — nie still verloren.
      void copyIntoShelf(text, "markierung").then((ok) => {
        if (!ok) return; // kein Clipboard (insecure context) — Kopieren-Button bleibt der Weg
        setCopyFlash(true);
        window.clearTimeout(flashTimer);
        flashTimer = window.setTimeout(() => setCopyFlash(false), 1200);
      });
    };
    document.addEventListener("pointerup", onUp);
    return () => {
      document.removeEventListener("pointerup", onUp);
      window.clearTimeout(flashTimer);
    };
  }, []);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  const tailEvents = events.length === 0 && cached ? cached.events : events;
  const recoveredPrompt = useRecoveredPrompt(tailEvents, api, session.id);
  const shownEvents = useMemo(
    () =>
      recoveredPrompt.prompt
        ? [recoveredPrompt.prompt, ...tailEvents]
        : tailEvents,
    [tailEvents, recoveredPrompt.prompt],
  );
  useEffect(() => {
    const t = setTimeout(
      () => saveTail(hostKey, session.id, shownEvents),
      1000,
    );
    return () => clearTimeout(t);
  }, [shownEvents]);
  // T8.6: where "new since your last visit" starts (null: nothing new / never here).
  const seenAt = useRef(getSeen(seenKey(session.hostId ?? "", session.id)));
  useEffect(() => {
    const last = events.at(-1)?.seq;
    if (last === undefined) return;
    const t = setTimeout(
      () => markSeen(seenKey(session.hostId ?? "", session.id), last),
      1500,
    );
    return () => clearTimeout(t);
  }, [events]);
  const fromCache = events.length === 0 && cached !== null;
  const [conn, setConn] = useState<
    "connecting" | "live" | "reconnecting" | "closed"
  >("connecting");
  const [filter, setFilter] = useState<FilterPreset>(loadFilter);
  const [status, setStatus] = useState(session.status);
  /** WS hat den Status schon gesetzt — ein parallel gestarteter 3s-Poll darf idle nicht mit working überschreiben. */
  const wsStatusRef = useRef<{ status: string; at: number } | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const tailRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  // BUG-0043: nur wer unten liest, wird mit neuen Events nach unten geführt.
  const stickRef = useRef(true);
  const userInputAt = useRef(0);
  /** BUG-0207: „hat sich weggelesen“ — der Leser hat die Spitze selbst verlassen. Unterdrueckt
   * erneutes Anheften, bis er selbst wieder unten ist oder ein neuer Strom beginnt. */
  const awayRef = useRef(false);
  /** BUG-0211: unterste Folge, die gehalten wird — hierher hat der Leser sich hochgeladen. */
  const floorSeqRef = useRef(0);
  /** Während eines Sprungs gilt: kein Abschneiden des Fensters (sonst fällt das
   * Ziel heraus, während die älteren Seiten hereinkommen). */
  const jumpHoldRef = useRef<number | null>(null);
  /** Haltet die Ansicht, als aeltere Eintraege dazukamen: die Haltezeile behaelt ihren
   *  Abstand zum Rand. `floor` ist die aelteste frisch vorgelagerte Folge — der Anker wirkt
   *  erst, wenn diese Zeile tatsaechlich im DOM steht (ein Events-Commit vorher darf ihn
   *  nicht aufbrauchen). */
  const anchorRef = useRef<{
    seq: number;
    floor: number;
    offset: number;
  } | null>(null);
  const loadingOlderRef = useRef(false);
  const [olderNote, setOlderNote] = useState<
    "mehr" /* i18n-ignore: Daten-Key */ | "laden" | "ende" | "fehler"
  >("mehr" /* i18n-ignore: Daten-Key */);
  /** BUG-0208: Seq des Blocks, der einen Live-Strom eingeholt hat — an seinen Anfang rollen. */
  const jumpSeqRef = useRef<number | null>(null);
  /** Suche: derselbe Sprung, aber von außen gesetzt (Fundstelle in der Suche).
   * Der Zähler ist der einzige Weg, den Roll-Effekt neu anzustoßen — ohne ihn
   * ändert sich an den Abhängigkeiten nichts. */
  const [jumpTick, setJumpTick] = useState(0);
  /** laeuft gerade ein Live-Strom? Gezählt wird nach turnId — ein Strom gilt erst mit
   * seinem final-Frame als beendet, sonst ueberlappen sich Bloecke und der gerade
   * gesetzte Sprung an den Nachrichtenanfang wird sofort wieder nach unten gezogen. */
  const openTurnsRef = useRef(new Set<string>());
  /** Zeichenlaengen der laufenden Live-Texte (im WS-Callback ohne State-Lesen). */
  const liveLensRef = useRef({ assistant: 0, thinking: 0 });
  // The tail ends exactly where the fixed controls start — measured, not
  // guessed: a taller composer (draft, recommendation, error) used to cover
  // the last message.
  const [tailMaxHeight, setTailMaxHeight] = useState<number | null>(null);
  // BUG-0053: in a low window (landscape) the controls start folded away — one tap on ▴ brings them back.
  // A choice the person made is kept.
  const [controlsHidden, setControlsHidden] = useState(() => {
    if (tile) return tile.compact;
    const stored = localStorage.getItem("ancientvoid.controlsHidden");
    return stored === null
      ? window.innerHeight < SHORT_VIEWPORT_PX
      : stored === "1";
  });
  // EPIC-P18: a layout change that makes this tile small folds it too.
  const compactTile = tile?.compact;
  useEffect(() => {
    if (compactTile !== undefined) setControlsHidden(compactTile);
  }, [compactTile]);
  const connRef = useRef<TailConnection | null>(null);
  const pendingRef = useRef<NormalizedEvent[]>([]);
  /** rAF id (> 0) or negated timeout id (< 0) of the scheduled flush. */
  const flushRef = useRef<number | null>(null);
  const activeRef = useRef(tile?.active ?? true);
  activeRef.current = tile?.active ?? true;

  // T1.6-3: Chat/Verlauf are the new dock sub-tabs — Chat is exactly the
  // existing "lesen" preset, Verlauf is "ueberwachen"/"debuggen" with a
  // small switcher inside it. `filter` stays the single source of truth
  // (unchanged ancientvoid.filter localStorage key, AC-P1.6-1) so a returning
  // user's last preset — including which tab that implies — still loads
  // correctly; lastVerlaufFilter only remembers which of the two Verlauf
  // presets to restore when hopping back from Chat.
  const [lastVerlaufFilter, setLastVerlaufFilter] = useState<
    Exclude<FilterPreset, "lesen">
  >(() => {
    const stored = loadFilter();
    return stored === "lesen" ? "ueberwachen" : stored;
  });
  // T1.6-4: Bericht is a third dock tab, orthogonal to the Chat/Verlauf
  // filter split above — it replaces the event list with a summary pane
  // instead of filtering it, so it needs its own bit of state rather than
  // being derived from `filter` like Chat/Verlauf are.
  const [activeTab, setActiveTab] = useState<
    | "chat"
    | "verlauf"
    | "bericht"
    | "diff"
    | "graph"
    | "git"
    | "datei"
    | "forge"
    | "suche"
    | "code"
    | "umgebung"
  >(
    () =>
      workspaceTab ?? tile?.only ??
      (initialCode
        ? "code"
        : initialTab === "graph"
          ? "graph"
          : initialTab === "git"
            ? "git"
            : initialFile
              ? "datei"
              : loadFilter() === "lesen"
                ? "chat"
                : "verlauf"),
  );
  const [graphFull, setGraphFull] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // „Mehr“ schließt bei Escape und bei einem Tipp daneben — am Handy deckt das Blatt die Reiter ab.
  // EPIC-P51 T51.5: Esc über die Shortcut-Registry; der Tipp-nebenbei-Listener bleibt lokal.
  useEffect(() => {
    if (!moreOpen) return;
    const off = registerShortcut("sessiontabs.more-close", (e) => {
      e.preventDefault();
      setMoreOpen(false);
    });
    const onDown = (e: PointerEvent) => {
      if (!(e.target as Element | null)?.closest?.(".subtabs-more-wrap"))
        setMoreOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => {
      off();
      window.removeEventListener("pointerdown", onDown);
    };
  }, [moreOpen]);
  useEffect(() => {
    const jump = () => {
      try {
        const pending = JSON.parse(
          sessionStorage.getItem("ancientvoid.source-view") ?? "null",
        ) as { hash?: string; view?: string } | null;
        if (
          pending?.hash !==
            sessionHash(session.id, remoteHost(session.hostId)) ||
          pending.view !== "forge"
        )
          return;
        if (tile && !activeRef.current) return;
        sessionStorage.removeItem("ancientvoid.source-view");
        selectTab("forge");
      } catch {
        sessionStorage.removeItem("ancientvoid.source-view");
      }
    };
    jump();
    window.addEventListener("ancientvoid:source-jump", jump);
    return () => window.removeEventListener("ancientvoid:source-jump", jump);
  }, [session.id, session.hostId]);
  /** EPIC-P48: im Datei-Tab geöffnete Datei (Knoten-Klick aus dem Graph). */
  const [openFile, setOpenFile] = useState<string | null>(initialFile ?? null);

  // T1.5-6: the PWA could watch and stop a session, but never reply to
  // one — POST /api/sessions/:id/steer existed server-side and both real
  // adapters implement it, nothing in the client ever called it.
  const [steerSupported, setSteerSupported] = useState(false);
  /** ADR-0085: nimmt der Adapter Eingaben mitten im laufenden Zug an (Pi, live). */
  const [midTurnInput, setMidTurnInput] = useState(false);
  // ADR-0085: läuft ein Zug, entscheidet diese Wahl, was der Senden-Knopf tut —
  // "vormerken (am Zugende)" oder "jetzt lenken". Der Hub kann beides; die Wahl bleibt
  // über Neuladen hinweg erhalten, weil sie eine Gewohnheit des Nutzers ist.
  const [delivery, setDelivery] = useState<"queue" | "now">(() =>
    typeof localStorage !== "undefined" &&
    localStorage.getItem("ancientvoid.queueDelivery") === "now"
      ? "now"
      : "queue",
  );
  const chooseDelivery = (mode: "queue" | "now") => {
    setDelivery(mode);
    try {
      localStorage.setItem("ancientvoid.queueDelivery", mode);
    } catch {
      /* privater Modus: die Wahl gilt dann nur für diesen Laden */
    }
  };
  /** T7.5: an observer (clip) cannot stop the harness — only stop watching. */
  const [observerOnly, setObserverOnly] = useState(false);
  // T1.6-4: claude's result line is the one real source for both costUsd
  // and tokensEst (ADR-0006) — reusing capabilities().cost as the signal
  // for "this adapter's Bericht numbers are real" avoids inventing a
  // second capability flag for data that already arrives together.
  const [reportNumbersReal, setReportNumbersReal] = useState(false);
  /** BUG-0061: the hub's per-registration enhance support (undefined =
   * older hub, the composer falls back to its id set). */
  const [adapterEnhance, setAdapterEnhance] = useState<boolean | undefined>(
    undefined,
  );
  // 2026-10-26: readable host names (own hostname / tailnet peer names).
  const [hostNames, setHostNames] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let alive = true;
    api
      .fleet()
      .then((overview) => {
        if (!alive) return;
        const names = new Map<string, string>();
        for (const host of overview.hosts)
          names.set(host.hostId, host.label ?? host.hostId.slice(0, 8));
        setHostNames(names);
      })
      .catch(() => undefined); // offline: the short id stays as fallback
    return () => {
      alive = false;
    };
  }, [api]);
  // ADR-0036: the adapter's declared external continuation command.
  const [adapterResume, setAdapterResume] = useState<
    { argv: string[]; ref: "native" | "token"; hub?: true } | undefined
  >(undefined);
  // ADR-0042: die gemeldeten Slash-Commands des Adapters fürs Antwortfeld.
  const [adapterCommands, setAdapterCommands] = useState<
    readonly SlashCommand[] | undefined
  >(undefined);
  /** ADR-0032: the model's context window — configured on the adapter,
   * without it the context chip names no percentage. */
  const [contextWindow, setContextWindow] = useState<number | null>(null);
  // T7.10: files and images for the next reply.
  const [replyAttachments, setReplyAttachments] = useState<AttachmentRecord[]>(
    [],
  );
  const [reply, setReply] = useState("");
  // T8.4: the reply is a draft on this device and on the hub (ADR-0025).
  // EPIC-P10.5: a video result handed to this session (Medien → „In Session verwenden“).
  const [handedOver] = useState(() => takeHandOver(session.id));
  const draft = useDraft({
    api,
    hostKey: remoteHost(session.hostId) ?? "local",
    sessionId: session.id,
    text: reply,
    setText: setReply,
    attachments: replyAttachments,
    setAttachments: setReplyAttachments,
    pending: handedOver,
  });
  const [replyBusy, setReplyBusy] = useState(false);
  const [replyError, setReplyError] = useState("");
  // Same text sent again after a failure keeps its input id (BUG-0016).
  const pendingInput = useRef<{ text: string; id: string } | null>(null);
  // T5.5: another device holds the writer lease — offer to take it over.
  const [leaseHeld, setLeaseHeld] = useState(false);
  const [archived, setArchived] = useState(session.archived === true);
  const [features, setFeatures] = useState<HarnessFeatures | null>(null);
  // EPIC-P15 T15.3: neu laden, wenn etwas vorgemerkt wurde.
  const [queueTick, setQueueTick] = useState(0);

  useEffect(() => {
    let alive = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const load = () =>
      api
        .adapters()
        .then((adapters) => {
          if (!alive) return;
          const info = adapters.find((a) => a.id === session.adapter);
          // Honest per-adapter check, not a blanket "always show a reply
          // box": an adapter without capabilities.steer gets no reply field
          // at all rather than one that would silently fail every time.
          setSteerSupported(
            info?.capabilities.features?.followUp ??
              info?.capabilities.steer ??
              false,
          );
          setMidTurnInput(
            (info?.capabilities.midTurnInput ?? false) ||
              (info?.capabilities.promptDelivery ?? "live") === "live",
          );
          setObserverOnly(
            info?.capabilities.features
              ? !info.capabilities.features.followUp &&
                  !info.capabilities.features.interrupt
              : false,
          );
          setFeatures(info?.capabilities.features ?? null);
          setReportNumbersReal(info?.capabilities.cost ?? false);
          setAdapterEnhance(
            typeof info?.enhance === "boolean" ? info.enhance : undefined,
          );
          setAdapterResume(info?.capabilities.resume);
          setAdapterCommands(info?.capabilities.commands);
          setContextWindow(
            typeof info?.capabilities.contextWindowTokens === "number"
              ? info.capabilities.contextWindowTokens
              : null,
          );
        })
        .catch(() => {
          if (!alive) return;
          setSteerSupported(false);
          setMidTurnInput(false);
          setReportNumbersReal(false);
          // BUG-0022: the hub was unreachable while opening — ask again
          // instead of hiding the reply field until a reload.
          retry = setTimeout(() => void load(), 3000);
        });
    void load();
    return () => {
      alive = false;
      clearTimeout(retry);
    };
  }, [session.adapter]);

  useEffect(() => {
    const base = window.location.origin;
    connRef.current = connectTail({
      url: base,
      token: getToken(),
      sessionId: session.id,
      hostId: remoteHost(session.hostId),
      // EPIC-P18 T18.6 (K2 with four tiles): one render per frame, not per
      // WS batch — a background tile at most every 100 ms. Four tiles at
      // 30 ev/s each re-rendered 120×/s and queued up behind each other.
      onEvents: (incoming) => {
        pendingRef.current.push(...incoming);
        if (flushRef.current !== null) return;
        const flush = () => {
          flushRef.current = null;
          const batch = pendingRef.current;
          pendingRef.current = [];
          setEvents((prev) => {
            const merged = [...prev, ...batch];
            return tailWindow(merged, TAIL_ROWS, floorSeqRef.current);
          });
          // BUG-0270: Status aus dem Strom, nicht erst aus dem 3s-Poll — sonst bleibt
          // die letzte Antwort im laufenden Zug und Übersicht/Nyx sagen „aktiv“.
          const hint = statusHintFromBatch(batch);
          if (hint !== null) {
            wsStatusRef.current = { status: hint, at: Date.now() };
            setStatus(hint);
            const host = remoteHost(session.hostId);
            const hub = getHubStatus();
            publishHubStatus({
              sessions: hub.sessions.map((s) =>
                s.id === session.id && remoteHost(s.hostId) === host ? { ...s, status: hint as typeof s.status } : s,
              ),
            });
          }
          // ADR-0083: der Block hat den Teiltext eingeholt — die Live-Blase verschwindet.
          const assistantBlocks = batch.filter((e) => e.type === "assistant");
          if (assistantBlocks.length) {
            // BUG-0208: die Nachricht ist fertig gestreamt — ihr Anfang wird vorgemerkt,
            // damit die Ansicht dorthin rueckt statt am Strom-Ende stehenzubleiben.
            if (liveLensRef.current.assistant > 0)
              jumpSeqRef.current = Math.min(
                ...assistantBlocks.map((e) => e.seq),
              );
            liveLensRef.current.assistant = 0;
            setLiveText((p) => (p.assistant ? { ...p, assistant: "" } : p));
          }
          if (batch.some((e) => e.type === "thinking")) {
            liveLensRef.current.thinking = 0;
            setLiveText((p) => (p.thinking ? { ...p, thinking: "" } : p));
          }
        };
        flushRef.current = activeRef.current
          ? requestAnimationFrame(flush)
          : -window.setTimeout(flush, BACKGROUND_FLUSH_MS);
      },
      // ADR-0083: echte Live-Frames — kohäriert am Adapter (≤ 150 ms), hier nur angesetzt.
      onFrames: (frames) => {
        // BUG-0207: Frames lassen den Chat wachsen, ohne dass ein Ereignis eintrifft.
        // Ein neu beginnender Strom holt das Mitrollen zurueck — aber nicht gegen einen
        // Leser, der sich bewusst weiter oben etwas ansieht.
        const open = openTurnsRef.current;
        const wasStreaming = open.size > 0;
        let assistantText = "";
        let thinkingText = "";
        for (const f of frames) {
          if (f.turnId && f.stream) {
            if (f.final) open.delete(f.turnId);
            else open.add(f.turnId);
          }
          if (!f.text) continue;
          if (f.stream === "assistant") assistantText += f.text;
          else thinkingText += f.text;
        }
        liveLensRef.current.assistant += assistantText.length;
        liveLensRef.current.thinking += thinkingText.length;
        if (!wasStreaming && open.size > 0 && !awayRef.current)
          stickRef.current = true;
        if (assistantText || thinkingText) {
          setLiveText((prev) => ({
            assistant: assistantText
              ? prev.assistant + assistantText
              : prev.assistant,
            thinking: thinkingText
              ? prev.thinking + thinkingText
              : prev.thinking,
          }));
        }
      },
      onState: setConn,
    });
    return () => {
      connRef.current?.close();
      const pending = flushRef.current;
      if (pending !== null) {
        if (pending < 0) clearTimeout(-pending);
        else cancelAnimationFrame(pending);
      }
      flushRef.current = null;
    };
  }, [session.id]);

  // T1.6-4: extends the existing 3s status poll to also carry costUsd/
  // tokensEst/updatedAt for the Bericht tab — not a second independent
  // timer (same principle as T1.5-3's usage poll).
  const [record, setRecord] = useState<SessionRecord>(session);
  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const rec = await api.session(session.id);
        const ws = wsStatusRef.current;
        // Ein vor dem settle gestarteter Poll kann noch „working“ liefern, nachdem
        // turn_end den Status bereits auf idle gesetzt hat — den Rückschritt verwerfen.
        const staleWorking =
          ws !== null &&
          Date.now() - ws.at < 5_000 &&
          ws.status === "idle" &&
          rec.status === "working";
        if (!staleWorking) {
          setStatus(rec.status);
          if (rec.status !== "working") wsStatusRef.current = null;
        }
        setRecord(rec);
      } catch {
        // offline — keep last state
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [session.id]);

  // T1.6-4/T1.6-5: fetched while Bericht or Diff is the open tab, not continuously — both are
  // periodic-check views, not a live stream, and share the one /diff endpoint. EPIC-P43 T43.5:
  // additionally once whenever no turn runs, so the „Änderungen“ tab knows its count (and,
  // empty, moves under „Mehr“ — Kleinkram-Regel 2).
  const [loadedDiff, setLoadedDiff] = useState<{
    sessionId: string;
    value: SessionDiffResult;
  } | null>(null);
  const diff = loadedDiff?.sessionId === session.id ? loadedDiff.value : null;
  const [diffErrorId, setDiffErrorId] = useState<string | null>(null);
  const [usage, setUsage] = useState<AdapterUsage | null>(null);
  const turnRunning = status === "working" || status === "starting";
  useEffect(() => {
    if (activeTab !== "bericht" && activeTab !== "diff" && turnRunning) return;
    let alive = true;
    api
      .sessionDiff(session.id)
      .then((d) => {
        if (!alive) return;
        setLoadedDiff({ sessionId: session.id, value: d });
        setDiffErrorId(null);
      })
      // BUG-0164: Ein Nachladefehler macht den letzten geladenen Stand nicht unlesbar.
      .catch(() => alive && setDiffErrorId(session.id));
    {
      api
        .adapterUsage(session.adapter)
        .then((u) => alive && setUsage(u))
        .catch(() => alive && setUsage(null));
    }
    return () => {
      alive = false;
    };
  }, [activeTab, session.id, session.adapter, turnRunning]);

  // Layout-Effekt: gespeichert im selben Commit, in dem die Wahl sichtbar wird — sonst verliert ein sofortiges Neuladen sie (BUG-0146).
  useLayoutEffect(() => {
    localStorage.setItem("ancientvoid.filter", filter);
    if (filter !== "lesen") setLastVerlaufFilter(filter);
  }, [filter]);

  const selectTab = (tab: import("../workspace/content.ts").SessionTab) => {
    if (openWorkspaceContent({ sessionId: session.id, ...(remoteHost(session.hostId) ? { hostId: remoteHost(session.hostId)! } : {}), content: { kind: "session", tab } })) return;
    setActiveTab(tab);
    if (tab === "chat") setFilter("lesen");
    if (tab === "verlauf") setFilter(lastVerlaufFilter);
  };
  // EPIC-P43.5: Der Key der Kachel ist die Session — Sprünge innerhalb derselben
  // Session (datei→code) wechseln nur das Ziel der Karte, ohne Remount. Verbindung
  // (WS) und Entwurf bleiben; der Tab folgt der Kartenreferenz direkt, ohne das
  // openWorkspaceContent-Echo (das Grid hat den Wechsel bereits vollzogen).
  useEffect(() => {
    if (workspaceTab) setActiveTab(workspaceTab);
  }, [workspaceTab, initialFile, initialCode?.path, initialCode?.line]);
  useEffect(() => {
    if (initialFile != null) setOpenFile(initialFile);
  }, [initialFile]);
  const showChatTab = () => selectTab("chat");
  const showVerlaufTab = () => selectTab("verlauf");
  const showBerichtTab = () => selectTab("bericht");
  const showDiffTab = () => selectTab("diff");
  const showSucheTab = () => selectTab("suche");
  const showCodeTab = () => selectTab("code");
  const showUmgebungTab = () => selectTab("umgebung");

  // Follow new events only where they are shown — in Bericht/Diff/Suche/
  // Code a running session used to scroll the search field away (T7.6).
  // EPIC-P43 AC-P43-7: gemerkte Scrollposition (Gerät) gewinnt vor „ans Ende“.
  // Restore pollt kurz + ResizeObserver: scrollHeight kann steigen, ohne dass
  // die Border-Box wächst (z. B. nachgeladenes Diff, padding in Tests).
  useEffect(() => {
    const saved = readTailScroll(session.id, activeTab);
    stickRef.current = saved === null;
    awayRef.current = false;
    jumpSeqRef.current = null;
    openTurnsRef.current.clear();
    if (saved === null) return;
    let done = false;
    let raf = 0;
    let tries = 0;
    const apply = () => {
      if (done) return;
      const node = tailRef.current;
      if (!node || node.scrollHeight <= node.clientHeight + 8) return;
      node.scrollTop = saved;
      stickRef.current = false;
      done = true;
    };
    const tick = () => {
      apply();
      if (!done && ++tries < 180) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const el = tailRef.current;
    const ro = el ? new ResizeObserver(apply) : null;
    if (el && ro) ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [activeTab, session.id]);
  // BUG-0044: ändert sich die Höhe (Dock ein-/ausgeblendet), bleibt der Fuß sichtbar.
  // BUG-0056: nicht auf Code/Suche/Bericht — dort schiebt „nach unten“ das Suchfeld aus dem Bild.
  useLayoutEffect(() => {
    if (activeTab !== "chat" && activeTab !== "verlauf") return;
    if (stickRef.current && Date.now() > jumpHoldUntilRef.current)
      tailRef.current?.scrollTo({ top: tailRef.current.scrollHeight });
  }, [tailMaxHeight, activeTab]);

  useEffect(() => {
    const measure = () => {
      fitSessionMenu(menuRef.current);
      const tail = tailRef.current;
      const dock = dockRef.current;
      if (!tail || !dock) return;
      // EPIC-P18: in a tile the list ends at the tile's bottom, not the window's.
      // BUG-0097: Dokument-Koordinaten statt viewport-relative — sonst friert
      // ein einmal gescrollter Zustand die Höhe ein. Und unter html-zoom
      // (ui-scale) messen die Rects visuelle Pixel: die Höhe wird deshalb
      // durch --ui-zoom geteilt, sonst läuft der Chat unter den Dock und
      // schiebt die Seite über das Viewport.
      const frame = tail.closest<HTMLElement>("[data-tile]");
      const scrollY = window.scrollY;
      const tailTop = tail.getBoundingClientRect().top + scrollY;
      const bottom = frame
        ? frame.getBoundingClientRect().bottom + scrollY
        : window.innerHeight + scrollY;
      const available =
        bottom - tailTop - dock.getBoundingClientRect().height - 8;
      setTailMaxHeight(Math.max(48, Math.floor(available))); // BUG-0053: no floor above what is free — the list must not slide under the dock
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (dockRef.current) observer.observe(dockRef.current);
    // BUG-0044: auch was über der Liste liegt (Laufleiste, Tabs, Hinweise) ändert ihre Oberkante.
    if (tailRef.current?.parentElement)
      observer.observe(tailRef.current.parentElement);
    const frame = tailRef.current?.closest<HTMLElement>("[data-tile]");
    if (frame) observer.observe(frame);
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, []);

  // Run strip: progress of the current turn and the provider's quota.
  const [now, setNow] = useState(Date.now());
  const [quotaUsage, setQuotaUsage] = useState<AdapterUsage | null>(null);
  useEffect(() => {
    if (status !== "working") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [status]);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .adapterUsage(session.adapter)
        .then((u) => alive && setQuotaUsage(u))
        .catch(() => undefined);
    void load();
    const timer = setInterval(() => void load(), 15_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [session.adapter]);
  const progress = runProgress(events, status, now);
  const activeBackground = useMemo(
    () => record.openActivities?.filter(({ id }) => !id.startsWith("tool:")) ?? backgroundActivities(events),
    [events, record.openActivities],
  );
  const providerFailure = observerOnly ? null : currentProviderFailure(events);
  const factoryLink = useMemo(() => {
    for (const e of events) {
      const p = e.payload as {
        kind?: string;
        factory?: { role?: string; partner?: string };
      };
      if (
        p.kind === "factory.linkage" &&
        typeof p.factory?.partner === "string" &&
        ["driver", "observer"].includes(p.factory.role ?? "")
      )
        return p.factory;
    }
    return null;
  }, [events]);
  const isLoop = session.adapter.startsWith("loop:");
  const loopView = useMemo(
    () => (isLoop ? deriveLoopView(events) : null),
    [isLoop, events],
  );
  // EPIC-P29 T29.6: Seq des letzten workspace.*-Events — die Umgebungsansicht
  // refresht daran (kein eigener Timer neben dem 3-s-Session-Poll).
  const workspaceSeq = useMemo(() => {
    let seq = 0;
    for (const e of events) {
      const kind = (e.payload as { kind?: unknown }).kind;
      if (typeof kind === "string" && kind.startsWith("workspace."))
        seq = e.seq;
    }
    return seq;
  }, [events]);
  // T21.3: measured turns of the same adapter/model — fetched when a turn starts, never guessed client-side.
  const [estimate, setEstimate] = useState<RunEstimate | null>(null);
  useEffect(() => {
    if (status !== "working") return;
    let alive = true;
    api
      .runEstimate(session.id)
      .then((e) => alive && setEstimate(e))
      .catch(() => alive && setEstimate(null));
    return () => {
      alive = false;
    };
  }, [api, session.id, status === "working"]);
  const quota = quotaSummary(quotaUsage, events);
  // ADR-0032: tokens per finished turn + the current context fill; the
  // window of the chosen model (model announce) beats the static adapter value.
  const tokenStats = useMemo(() => turnTokenStats(shownEvents), [shownEvents]);
  const windowTokens = contextWindowFromEvents(shownEvents) ?? contextWindow;
  const context = contextText(tokenStats.lastContextTokens, windowTokens);
  const tokensKnown =
    (record.metrics?.tokens ?? "unknown") !== "unknown" || record.tokensEst > 0;
  // BUG-0184 / ADR-0084: „erzeugt“ und „verarbeitet“ rechnet der Hub ueber den
  // gesamten EventStore — der Client sieht nie alle Ereignisse, deshalb kommt die
  // Bilanz von dort und nicht aus dem hier geladenen Schwanz.
  const [tokenTotals, setTokenTotals] = useState<SessionTokenTotals | null>(
    null,
  );
  const [tokenRefresh, setTokenRefresh] = useState(0);
  useEffect(() => setTokenTotals(null), [session.id]);
  useEffect(() => {
    let alive = true;
    api
      .sessionTokens(session.id)
      .then((t) => alive && setTokenTotals(t))
      .catch(() => alive && setTokenTotals(null));
    return () => {
      alive = false;
    };
  }, [api, session.id, tokenRefresh, status]);
  // Die Zahlen waechst mit jedem Modell-Aufruf. Nachgeladen wird alle 10 s, nicht pro
  // Ereignis: der Hub geiht dafuer durch die ganze Historie (K2). Still stehende
  // Sessions holen einmal. `status` in den Deps oben: eine beim Mount geladene
  // Bilanz ist oft noch vor dem Zug-Ende geholt (alle null) — ohne Nachladen beim
  // Übergang zu idle stünde sie für immer da (BUG-0185).
  useEffect(() => {
    if (status !== "working") return;
    const timer = setInterval(() => setTokenRefresh((n) => n + 1), 10_000);
    return () => clearInterval(timer);
  }, [status]);

  // EPIC-P20 T20.1: in a desktop tile the reading tabs (Diff, Bericht, Suche, Code) get the
  // height of the composer too — it stays one tap away (▴), and the tab's own choice resets
  // when the tab changes. The phone view and the chat tabs keep the device's choice.
  const [openedInReadingTab, setOpenedInReadingTab] = useState(false);
  useEffect(() => setOpenedInReadingTab(false), [activeTab]);
  const readingTab = tile !== undefined && READING_TABS.has(activeTab);
  const controlsFolded = readingTab ? !openedInReadingTab : controlsHidden;

  const toggleControls = () => {
    if (readingTab) {
      setOpenedInReadingTab((v) => !v);
      return;
    }
    setControlsHidden((hidden) => {
      // A tile's fold is that tile's; the single view keeps the device choice.
      if (!tile)
        localStorage.setItem("ancientvoid.controlsHidden", hidden ? "0" : "1");
      return !hidden;
    });
  };

  const backgroundTile = tile !== undefined && !tile.active;
  const filtered = useMemo(() => {
    const preset = FILTERS.find((f) => f.id === filter)!;
    return shownEvents.filter(preset.keep);
  }, [shownEvents, filter]);
  // EPIC-P18 T18.6: a tile without focus keeps only its newest rows in the
  // DOM — four tiles of 500 rows each re-laid out on every update broke K2.
  // Focus brings the full history back.
  const visible = useMemo(
    () =>
      backgroundTile && filtered.length > BACKGROUND_ROWS
        ? filtered.slice(-BACKGROUND_ROWS)
        : filtered,
    [filtered, backgroundTile],
  );
  const hiddenOlder = filtered.length - visible.length;
  // EPIC-P43 T43.4: der Chat in Zügen — aus dem ungefilterten Strom, damit Schritte nicht verloren gehen.
  const live = status === "working" || status === "starting";
  const chat = useChatEvents(shownEvents, api);

  // BUG-0207/0208: Mitrollen haengt jetzt an Ereignissen UND an Live-Frames — frames
  // aenderten die alte Abhaengigkeit nie, der Text wuchs unter dem Rand weg. Ist ein
  // gestreamter Block fertig, rueckt die Ansicht an seinen Anfang, der sonst oberhalb
  // der Lesespitze laege. Steht absichtlich NACH dem tailMaxHeight-Anheften (BUG-0044),
  // damit der Sprung nicht sofort wieder nach unten gezogen wird, und nach `chat`,
  // weil die Zeile des Blocks erst mit dem Chat-Datensatz im DOM erscheint.
  useLayoutEffect(() => {
    if (activeTab !== "chat" && activeTab !== "verlauf") return;
    const el = tailRef.current;
    if (!el) return;
    const seq = jumpSeqRef.current;
    if (seq !== null) {
      let raf = 0;
      let tries = 0;
      const attempt = () => {
        if (jumpSeqRef.current !== seq) return; // durch eine neuere Absicht ersetzt
        const node =
          tailRef.current?.querySelector<HTMLElement>(`[data-seq="${seq}"]`) ??
          (tries > 8 ? resolveSeqNode(seq) : null);
        if (node) {
          jumpSeqRef.current = null;
          const box = tailRef.current?.getBoundingClientRect();
          // Nur springen, wenn der Anfang oberhalb der Lesespitze liegt — ist die
          // Nachricht ganz sichtbar, waere ein Sprung nur Flackern.
          if (box && node.getBoundingClientRect().top < box.top - 8) {
            stickRef.current = false;
            jumpHoldUntilRef.current = Date.now() + 8_000;
            node.scrollIntoView({ behavior: "auto", block: "start" });
          } else {
            jumpHoldUntilRef.current = Date.now() + 4_000;
          }
          // Nachleuchten: die Fundstelle ist gefunden, sie muss aber auch als solche
          // zu sehen sein — 2,2 s, damit das Auge sie erkennt.
          node.classList.add("hit-target");
          window.setTimeout(() => node.classList.remove("hit-target"), 2200);
          return;
        }
        if (++tries < 300) raf = requestAnimationFrame(attempt);
        else jumpSeqRef.current = null; // nie im DOM aufgetaucht — nicht ewig nachhalten
      };
      attempt();
      return () => cancelAnimationFrame(raf);
    }
    if (stickRef.current && Date.now() > jumpHoldUntilRef.current) el.scrollTo({ top: el.scrollHeight });
  }, [events, chat.events, liveText, activeTab, filter, session.id, jumpTick]);

  /** BUG-0211: der Schwanz des Hubs enthaelt alles, der Client hielt nur die letzten
   *  TAIL_ROWS — damit war der Anfang eines langen Chats nie erreichbar. Aeltere werden in
   *  Seiten geholt, solange der Leser nach oben will. */
  const loadOlder = async (): Promise<void> => {
    const first = events[0];
    if (!first || first.seq <= 1 || loadingOlderRef.current) return;
    loadingOlderRef.current = true;
    setOlderNote("laden");
    const el = tailRef.current;
    const row = (el?.querySelector(".event.assistant[data-seq]") ??
      el?.querySelector("[data-seq]")) as HTMLElement | null;
    const anchor =
      el && row
        ? {
            seq: Number(row.getAttribute("data-seq")),
            offset:
              row.getBoundingClientRect().top - el.getBoundingClientRect().top,
          }
        : null;
    try {
      const page = await api.events(
        session.id,
        0,
        Math.min(2000, first.seq - 1),
      );
      const older = page
        .filter((e) => e.seq < first.seq)
        .map((e) => ({
          ...e,
          sessionId: session.id,
          payload: (e.payload ?? {}) as Record<string, unknown>,
        }));
      if (older.length === 0) {
        setOlderNote("ende");
        return;
      }
      anchorRef.current = anchor ? { ...anchor, floor: older[0]!.seq } : null;
      floorSeqRef.current = older[0]!.seq;
      setEvents((prev) => {
        const merged = [...older, ...prev];
        // Ein Sprung zu einer Fundstelle darf das Ziel nicht selbst abschneiden:
        // das Fenster hängt unten am nachgeladenen Rand, bei einem Sprung wäre die
        // Fundstelle nach dem letzten Nachladen genau herausgefallen.
        if (jumpHoldRef.current !== null) return merged;
        return tailWindow(merged, TAIL_ROWS, floorSeqRef.current);
      });
      setOlderNote(older[0]!.seq <= 1 ? "ende" : "mehr" /* i18n-ignore: Daten-Key */);
    } catch {
      setOlderNote("fehler");
    } finally {
      loadingOlderRef.current = false;
    }
  };

  /** Suche: eine Fundstelle in **dieser** Sitzung anspringen. Liegt sie
   * außerhalb des gehaltenen Fensters, werden die älteren Seiten so weit
   * nachgeholt, bis sie da ist — sonst läuft der Sprung ins Leere (der
   * DOM-Wartezyklus unten nach 120 Frames ehrlich aufgibt). */
  const jumpToSeq = async (seq: number): Promise<void> => {
    setActiveTab("chat");
    jumpHoldRef.current = seq;
    let lastFloor = Number.POSITIVE_INFINITY;
    for (let tries = 0; tries < 30; tries++) {
      // Der Haltepunkt ist am Anfang unbekannt: beim Öffnen einer Sitzung ist
      // floorSeqRef noch 0 (gesetzt erst durch das erste Nachladen). Ohne den
      // Blick auf die geladene Seite bricht die Schleife sofort ab und der
      // Sprung geht ins Leere — genau der Fall aus der Suche / dem Sitzungsfilter.
      const floor = floorSeqRef.current || events[0]?.seq || 0;
      if (loadingOlderRef.current) {
        await new Promise((r) => setTimeout(r, 120)); // ein laufender Nachladelauf erst auslaufen lassen
        continue;
      }
      if (floor <= 1 || seq >= floor) break;
      if (floor >= lastFloor) break; // kein Fortschritt — nicht endlos nachladen
      lastFloor = floor;
      await loadOlder();
    }
    jumpSeqRef.current = seq;
    setJumpTick((n) => n + 1);
    jumpHoldRef.current = null;
  };

  /** Fundstelle aus der Adresse (`…/seq/474`): die Sitzung öffnet sich, der Chat
   * läuft zu der Nachricht, und sie leuchtet kurz nach. Der Anker wird hier aus der
   * Adresse gelesen — über Props gereicht wird er nicht, weil dieselbe Sitzung in
   * einer Arbeitsflächen-Kachel oder in einem eigenen Fenster leben kann und dort
   * niemand den Anker weitergeben würde. */
  const jumpedSeqRef = useRef<number | string | null>(null);
  /** Nach einem Sprung zur Fundstelle nicht sofort ans Ende zurückfallen — die
   * Stelle muss lesbar bleiben, auch wenn die Sitzung gerade weiterläuft. */
  const jumpHoldUntilRef = useRef(0);
  const seqFromHash = (): number | null => {
    // Die Sitzung ist an ihrer Id erkannt — host-qualifiziert (`hosts/<rechner>/…`)
    // oder nicht; dazwischen kann noch ein Tab stehen (graph/git/datei).
    const anchor = new RegExp(`sessions/${escapeForRegExp(session.id)}(?:/[^/]+)*/seq/(\\d+)$`);
    const m = anchor.exec(location.hash);
    return m ? Number(m[1]) : null;
  };
  /** Die Fundstelle ist eine Ereignis-Id, gemalt wird aber in Zügen: liegt die Id
   * mitten in einem Turn, ist der Turn das Ziel — er enthält die Stelle, und nur er
   * liegt im DOM. */
  const resolveSeqNode = (seq: number): HTMLElement | null => {
    const root = tailRef.current;
    if (!root) return null;
    const exact = root.querySelector<HTMLElement>(`[data-seq="${seq}"]`);
    if (exact) return exact;
    const nodes = [...root.querySelectorAll<HTMLElement>("[data-seq]")]
      .map((n) => ({ node: n, at: Number(n.getAttribute("data-seq")) }))
      .filter((x) => Number.isFinite(x.at))
      .sort((a, b) => a.at - b.at);
    if (!nodes.length) return null;
    let pick = nodes[0]!;
    for (const x of nodes) {
      if (x.at <= seq) pick = x;
      else break;
    }
    return pick.node;
  };

  /** Schon beim ersten Rendern merken: die App schreibt die Adresse um, sobald ein
   * anderer Fokus wechselt — wäre der Anker dann weg, wäre der Sprung ein Zufall. */
  const pendingSeqRef = useRef<number | null>(initialSeq ?? seqFromHash());
  const runJump = (seq: number): void => {
    void (async () => {
      await jumpToSeq(seq);
      // Der Layout-Effect (jumpSeqRef) scrollt und leuchtet nach, sobald die Zeile im
      // DOM steht. Hier nur: darauf warten, dann die Fundstellen-Adresse abräumen.
      for (let tries = 0; tries < 120 && jumpSeqRef.current !== null; tries++) {
        await new Promise((r) => setTimeout(r, 50));
      }
      if (seqFromHash() === null && location.hash.includes("/seq/")) {
        history.replaceState(null, "", sessionHash(session.id, remoteHost(session.hostId)));
      }
    })();
  };

  const [hashTick, setHashTick] = useState(0);
  useEffect(() => {
    const on = () => {
      // Gleich hier merken: die App schreibt die Adresse um, sobald ein anderer
      // Fokus greift — wer den Anker erst in der nächsten Renderstufe holt, findet
      // ihn nicht mehr.
      const seq = seqFromHash();
      if (seq !== null) pendingSeqRef.current = seq;
      setHashTick((n) => n + 1);
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  useEffect(() => {
    const neuAusAdresse = pendingSeqRef.current !== null;
    const seq = pendingSeqRef.current ?? initialSeq ?? seqFromHash();
    if (seq === null || seq === undefined || !events.length) return;
    // Eine Bitte ist an ihre Marke gebunden, nicht an die Zahl: derselbe Tipp auf
    // dieselbe Karte ist eine neue Bitte und muss wieder springen.
    const marker = seqAt ?? (neuAusAdresse ? `bitte:${hashTick}:${seq}` : `seq:${seq}`);
    if (jumpedSeqRef.current === marker) return;
    jumpedSeqRef.current = marker;
    pendingSeqRef.current = null;
    runJump(seq);
  }, [initialSeq, seqAt, events.length, session.id, hashTick]);

  // Vorgelagerte Eintraege verschieben den Inhalt — die Lesestelle haelt an ihrem Abstand.
  useLayoutEffect(() => {
    const a = anchorRef.current;
    const el = tailRef.current;
    if (!a || !el) return;
    if (!el.querySelector(`[data-seq="${a.floor}"]`)) return; // die Vorlage ist noch nicht gemalt — Anker halten
    anchorRef.current = null;
    const row = (el.querySelector(`.event.assistant[data-seq="${a.seq}"]`) ??
      el.querySelector(`[data-seq="${a.seq}"]`)) as HTMLElement | null;
    // Der Scrollpunkt wandert um genau die Strecke, die die Haltezeile durch die Vorlage
    // zurueckgelegt hat — so bleibt sie sichtbar, wo sie war.
    if (row)
      el.scrollTop =
        el.scrollTop +
        (row.getBoundingClientRect().top - el.getBoundingClientRect().top) -
        a.offset;
    else el.scrollTop = Math.min(el.scrollTop + 400, el.scrollHeight); // Haltezeile fehlt — nicht springen lassen
  }, [events]);
  const lastPrompt = lastUserPrompt(shownEvents);
  const chatItems = useMemo(() => {
    const all = turnsOf(chat.events, live);
    if (!backgroundTile || all.length <= BACKGROUND_ROWS) return all;
    const recent = all.slice(-BACKGROUND_ROWS);
    const prompt = all.find(
      (item) => item.kind === "event" && item.event.seq === lastPrompt?.seq,
    );
    return prompt && !recent.includes(prompt)
      ? [prompt, ...recent.slice(1)]
      : recent;
  }, [chat.events, live, backgroundTile, lastPrompt]);
  const firstNew =
    seenAt.current !== null && seenAt.current > 0
      ? visible.find((e) => e.seq > seenAt.current!)
      : undefined;
  const newCount = firstNew
    ? visible.filter((e) => e.seq >= firstNew.seq).length
    : 0;

  // T1.8: tool_use <-> tool_result status + anchor navigation, built from
  // the full (unfiltered) stream so a match isn't missed just because one
  // side got filtered out under the current preset.
  const toolResultByToolId = useMemo(() => {
    const map = new Map<string, NormalizedEvent>();
    for (const e of shownEvents) {
      if (e.type === "tool_result") {
        const id = toolIdOf(e);
        if (id) map.set(id, e);
      }
    }
    return map;
  }, [shownEvents]);

  const toggleExpanded = (seq: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(seq)) next.delete(seq);
      else next.add(seq);
      return next;
    });
  };

  const jumpTo = (anchor: string) => {
    // EPIC-P18: anchors repeat across tiles — search this view only.
    tailRef.current
      ?.querySelector(`[id="${CSS.escape(anchor)}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const [title, setTitle] = useState(session.title ?? null);
  // T9.4: the text entry knows which session is open (bound to its plans).
  // EPIC-P18: with several tiles only the focused one speaks for "here".
  const ownsHere = tile?.active ?? true;
  useEffect(() => {
    if (!ownsHere) return;
    setHere({
      page: "session",
      sessionId: session.id,
      hostId: session.hostId ?? null,
      sessionRevision: record.inputRevision ?? null,
    });
  }, [session.id, record.inputRevision, ownsHere]);
  useEffect(() => {
    if (!ownsHere) return;
    // Another tile may already have taken "here" in the same commit.
    return () => {
      if (getHere().sessionId === session.id)
        setHere({
          page: "dashboard",
          sessionId: null,
          hostId: null,
          sessionRevision: null,
        });
    };
  }, [ownsHere]);
  // T9.4: "Such im Code nach …" lands here.
  useEffect(() => {
    const check = () => {
      const pending = JSON.parse(
        sessionStorage.getItem("ancientvoid.pendingCodeSearch") ?? "null",
      ) as { sessionId?: string } | null;
      if (pending?.sessionId === session.id && (!tile || activeRef.current)) selectTab("code");
    };
    check();
    window.addEventListener("ancientvoid:code-search", check);
    return () => window.removeEventListener("ancientvoid:code-search", check);
  }, [session.id]);
  const [pinned, setPinned] = useState(session.pinned === true);
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const menuRef = useRef<HTMLDetailsElement>(null);
  const titleRef = useRef(titleDraft);
  titleRef.current = titleDraft;
  useEffect(
    () =>
      renaming
        ? registerField("session_title", {
            get: () => titleRef.current,
            set: setTitleDraft,
          })
        : undefined,
    [renaming],
  );
  const menuDo = (fn: () => void) => {
    if (menuRef.current) menuRef.current.open = false;
    fn();
  };
  const saveTitle = async () => {
    try {
      const updated = await api.setSessionMeta(session.id, {
        title: titleDraft,
      });
      setTitle(updated.title ?? null);
      setRenaming(false);
    } catch (err) {
      setReplyError(
        err instanceof Error ? err.message : t("session.rename_failed"),
      );
    }
  };
  const togglePin = async () => {
    try {
      const updated = await api.setSessionMeta(session.id, { pinned: !pinned });
      setPinned(updated.pinned === true);
    } catch (err) {
      setReplyError(
        err instanceof Error ? err.message : t("session.pin_failed"),
      );
    }
  };

  // Archivieren verlässt die Ansicht: am Handy/Tablet zurück in die
  // Übersicht, am PC räumt die Kachel die Session ab. „Zurückholen“
  // bleibt dagegen in der Ansicht — die Session ist wieder aktiv.
  const leaveArchived = () => {
    if (tile) onArchived?.();
    else onNavigate("dashboard");
  };
  const toggleArchive = async () => {
    const next = !archived;
    try {
      const updated = await api.setArchived(session.id, next);
      setArchived(updated.archived === true);
      if (updated.archived === true) leaveArchived();
    } catch (err) {
      setReplyError(
        err instanceof Error ? err.message : t("session.archive_failed"),
      );
    }
  };

  // Eine Session, die ein anderes Gerät archiviert (am Handy archiviert →
  // PC-Kachel, am PC archiviert → geöffnete Handy-Ansicht), verlässt den
  // Vordergrund genauso wie nach dem eigenen Klick — der 3-s-Poll darüber
  // meldet den Übergang. Eine schon archiviert geöffnete Session (Archiv-
  // liste) bleibt offen: nur nicht-archiviert → archiviert löst aus.
  const wasArchived = useRef(session.archived === true);
  useEffect(() => {
    const now = record.archived === true;
    if (now && !wasArchived.current) leaveArchived();
    wasArchived.current = now;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record.archived]);

  const stop = async () => {
    // Real bug found live-testing T3.10: this used to swallow every
    // failure silently (`.catch(() => undefined)`) — the button could do
    // nothing and the user would have no way to know. Now surfaces a real
    // failure the same way a rejected reply already does.
    try {
      const ack = await api.stopSession(session.id);
      if (!ack.ok) setReplyError(t("session.stop_failed"));
    } catch (err) {
      setReplyError(
        err instanceof Error ? err.message : t("session.stop_failed"),
      );
    }
  };

  /** EPIC-P15 T15.3: Pause — hält den laufenden Zug an, die Session bleibt fortsetzbar. */
  const pause = async () => {
    try {
      const ack = await api.steer(session.id, { kind: "park" });
      if (!ack.ok) setReplyError(steerRejectText(ack.detail));
    } catch (err) {
      setReplyError(
        err instanceof Error ? err.message : t("session.pause_failed"),
      );
    }
  };

  const sendText = async (
    text: string,
    takeover = false,
    queue?: boolean,
    submittedSources: SourceRef[] = [],
  ) => {
    if (!text.trim() && replyAttachments.length === 0) return;
    setReplyBusy(true);
    setReplyError("");
    setLeaseHeld(false);
    try {
      if (pendingInput.current?.text !== text)
        pendingInput.current = { text, id: newInputId() };
      const ids = replyAttachments.map((a) => a.id);
      const ack = await api.steer(
        session.id,
        { kind: "prompt", text, ...(ids.length ? { attachmentIds: ids } : {}) },
        pendingInput.current.id,
        takeover,
        queue,
      );
      if (ack.ok) {
        if (queue || ack.detail === "queued") setQueueTick((t) => t + 1);
        pendingInput.current = null;
        setReply("");
        setReplyAttachments([]);
        void draft.clear();
        consumeSources(session.id, submittedSources);
      } else {
        setLeaseHeld(ack.detail === "writer lease held");
        // A rejected steer (e.g. claude's "no thread_id captured yet") is
        // shown, not swallowed — an AC-P1.5-7 requirement, and the same
        // honesty standard the rest of this app already applies.
        if (ack.detail === "revision conflict") pendingInput.current = null;
        setReplyError(steerRejectText(ack.detail));
      }
    } catch (err) {
      setReplyError(
        err instanceof Error ? err.message : t("session.answer_failed"),
      );
    } finally {
      setReplyBusy(false);
    }
  };

  const sendReply = (takeover = false, queue?: boolean) => {
    // EPIC-P43.5 T43.5-1: Quellenchips wandern als markierter Block in den
    // Prompt — dieselbe Form wie die Vorschau im Composer, danach verbraucht.
    const sources = sourcesOf(session.id);
    if (sources.length === 0) return sendText(reply, takeover, queue);
    const text = `${reply}${reply.trim() ? "\n\n" : ""}${sourcesBlock(sources)}`;
    return sendText(text, takeover, queue, sources);
  };
  const running =
    status === "working" ||
    status === "starting" ||
    status === "waiting_approval";
  const showReply = steerSupported;
  // T1.6-3/AC-P1.6-2: no back-arrow up top anymore — "Übersicht" in the
  // dock below is the one way back, reachable from anywhere with one tap.
  const modelLabel = session.model ?? latestModelName(events);
  // 2026-10-26: the model is ALWAYS visible — the adapter's own event wins
  // (it names what really runs), then the record (session choice or the
  // registration's configured default), else the honest "Standardmodell".
  const shownModel =
    typeof modelLabel === "string" && modelLabel
      ? modelLabel
      : typeof session.model === "string" && session.model
        ? session.model
        : t("common.default_model");
  // Ja/Nein-Rückfrage: die letzte Assistant-Nachricht endet auf „?“ —
  // QuickConfirm bietet dann Ja/Nein, solange das Antwortfeld leer ist.
  const agentQuestion = lastAssistantQuestion(shownEvents);
  // EPIC-P43 T43.4: vier Reiter — Chat, Änderungen (Diff und Bericht), Befehle (Code, Datei), Mehr.
  // Die übrigen Ansichten liegen unter „Mehr“; ihre Adressen und Zustände bleiben dieselben.
  type Tab = typeof activeTab;
  // Kleinkram-Regel 2: ein leerer Reiter rückt unter „Mehr“ und sagt dort in einem Satz, was fehlt.
  const changed = changeSummary(diff);
  const noChanges = changed?.files === 0;
  const MAIN: {
    label: string;
    icon: TabIconName;
    tabs: readonly Tab[];
    show: () => void;
    count?: number;
  }[] = [
    { label: t("session.chat_tab"), icon: "chat", tabs: ["chat"], show: showChatTab },
    ...(noChanges
      ? []
      : [
          {
            label: t("session.changes"),
            icon: "diff" as TabIconName,
            tabs: ["diff", "bericht"] as Tab[],
            show: showDiffTab,
            count: changed?.files ?? 0,
          },
        ]),
    {
      label: t("session.commands"),
      icon: "datei",
      tabs: ["code", "datei"],
      show: showCodeTab,
    },
  ];
  const MORE: {
    id: Tab;
    label: string;
    icon: TabIconName;
    show: () => void;
  }[] = [
    ...(noChanges
      ? [
          {
            id: "diff" as Tab,
            label: t("session.changes"),
            icon: "diff" as TabIconName,
            show: showDiffTab,
          },
        ]
      : []),
    { id: "verlauf", label: t("session.history"), icon: "verlauf", show: showVerlaufTab },
    { id: "bericht", label: t("session.report"), icon: "bericht", show: showBerichtTab },
    // Die aus dem Graph geöffnete Datei (EPIC-P48); ohne Datei sagt die Ansicht das selbst.
    {
      id: "datei",
      label: t("session.file_tab"),
      icon: "datei",
      show: () => {
        setActiveTab("datei");
        openLayer("files");
      },
    },
    {
      id: "graph",
      label: t("session.graph_tab"),
      icon: "graph",
      show: () => setActiveTab("graph"),
    },
    {
      id: "git",
      label: t("session.git_tab"),
      icon: "git",
      show: () => {
        setActiveTab("git");
        location.hash = `${sessionHash(session.id, remoteHost(session.hostId))}/git`;
      },
    },
    {
      id: "forge",
      label: t("session.gitlab_tab"),
      icon: "forge",
      show: () => setActiveTab("forge"),
    },
    { id: "suche", label: t("session.search"), icon: "suche", show: showSucheTab },
    {
      id: "umgebung",
      label: t("session.environment"),
      icon: "umgebung",
      show: showUmgebungTab,
    },
  ];
  const inMore = MORE.some(
    (m) => m.id === activeTab && !MAIN.some((t) => t.tabs.includes(m.id)),
  );
  const tabButtons = (
    <>
      {MAIN.map((t) => {
        const on = t.tabs.includes(activeTab);
        return (
          <button
            key={t.label}
            type="button"
            class={on ? "active" : ""}
            title={t.label}
            aria-current={on ? "page" : undefined}
            onClick={() => {
              setMoreOpen(false);
              if (!openWorkspaceContent({ sessionId: session.id, ...(remoteHost(session.hostId) ? { hostId: remoteHost(session.hostId)! } : {}), content: { kind: "session", tab: t.tabs[0]! } })) t.show();
            }}
          >
            <TabIcon name={t.icon} />
            <span class="lb">{t.label}</span>
            {t.count ? <span class="tab-count num">{t.count}</span> : null}
          </button>
        );
      })}
      <span class="subtabs-more-wrap">
        <button
          type="button"
          class={inMore ? "active" : ""}
          title={t("common.more")}
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          aria-current={inMore ? "page" : undefined}
          onClick={() => setMoreOpen((on) => !on)}
        >
          <TabIcon name="mehr" /* i18n-ignore: Icon-Key */ />
          <span class="lb">
            {inMore
              ? (MORE.find((m) => m.id === activeTab)?.label ?? t("common.more"))
              : t("common.more")}
          </span>
        </button>
        {moreOpen && (
          <div class="subtabs-more" role="menu" aria-label={t("session.more_views")}>
            {MORE.map((m) => (
              <button
                key={m.id}
                type="button"
                role="menuitem"
                class={activeTab === m.id ? "active" : ""}
                onClick={() => {
                  setMoreOpen(false);
                  if (!openWorkspaceContent({ sessionId: session.id, ...(remoteHost(session.hostId) ? { hostId: remoteHost(session.hostId)! } : {}), content: { kind: "session", tab: m.id } })) m.show();
                }}
              >
                <TabIcon name={m.icon} />
                <span>{m.label}</span>
              </button>
            ))}
            {/* Ebenen über der Session (EPIC-P43, Regel 6: ohne Randlasche über dem Inhalt). */}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMoreOpen(false);
                openLayer("browser");
              }}
            >
              <TabIcon name="browser" />
              <span>{t("session.browser")}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMoreOpen(false);
                openLayer("devices");
              }}
            >
              <TabIcon name="geraete" />
              <span>{t("session.devices")}</span>
            </button>
          </div>
        )}
      </span>
    </>
  );
  const showVerlaufFilterBar = activeTab === "verlauf";
  // EPIC-P43 T43.7 (ADR-0068): jede Ansicht lässt sich am PC herauslösen; läuft sie in einem Fenster,
  // steht hier ein Platzhalter mit „Fenster zeigen“ und „Zurückholen“.
  const openWindows = useOpenWindows();
  const viewKind = tile && !tile.only ? viewKindOfTab(activeTab) : null;
  const sessionHost = remoteHost(session.hostId);
  const viewTarget: WindowTarget | null = viewKind
    ? {
        kind: viewKind,
        sessionId: session.id,
        ...(sessionHost ? { hostId: sessionHost } : {}),
      }
    : null;
  const viewWindow = viewTarget ? windowFor(openWindows, viewTarget) : null;
  const detach =
    viewKind && viewTarget ? (
      <DetachButton target={viewTarget} label={VIEW_LABEL[viewKind]} />
    ) : null;
  const detachHead = detach ? <div class="view-head">{detach}</div> : null;
  const diffWarning =
    diffErrorId === session.id ? (
      <p class="dim" role="status" aria-label={t("session.diff_state")}>
        {diff
          ? t("session.stale_loaded")
          : t("session.changes_load_failed")}
      </p>
    ) : null;

  return (
    <ApiContext.Provider value={api}>
      {/* 2026-10-26: the whole session view carries the same traveling border
       * as an active overview card — "this agent is working" must be visible
       * from any tab (chat/diff/code), not only from the small status pill. */}
      <div
        data-tab={activeTab}
        class={`session-live${status === "working" ? " st-working" : status === "waiting_approval" ? " st-waiting" : ""}${graphFull ? " graph-full" : ""}`}
      >
        {copyFlash && (
          <div class="copy-flash" role="status">
            {t("common.copied_to_clipboard")}
          </div>
        )}
        <div>
          {/* T8.5: Kopf — Übersicht-Knopf, Titel, Stop abseits von Senden,
           * Rest in ⋯. BUG-0279: statt Historie-Rücksprung (popView) führt
           * der Knopf am Handy deterministisch in die Übersicht; der Stack
           * pendelte sonst zwischen Sessions. */}
          <div class={`topbar session-topbar${tile ? " tile-top" : ""}`}>
            {tile?.head?.start}
            <Button
              aria-label={t("app.to_overview")}
              title={t("app.to_overview")}
              onClick={() => onNavigate("dashboard")}
              class="back-btn"
            >
              <TabIcon name="uebersicht" />
            </Button>
            <div class="session-top-main">
              {renaming ? (
                <form
                  class="rename-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveTitle();
                  }}
                >
                  <input
                    aria-label={t("session.new_title")}
                    value={titleDraft}
                    maxLength={80}
                    onFocus={() => touchField("session_title")}
                    onInput={(e) =>
                      setTitleDraft((e.target as HTMLInputElement).value)
                    }
                  />
                  <Button type="submit" variant="primary">
                    {t("common.ok")}
                  </Button>
                </form>
              ) : (
                <div class="session-top-title">
                  {title ?? projectName(session.project)}
                </div>
              )}
              <div class="dim session-top-meta">
                {mainSync && mainSync.behind > 0 && (
                  <>
                    {/* ADR-0102: Der Hinweis ist der Knopf — Klick pullt main und mischt
                     * ihn ein (Konflikte gunsten der Session), der Ablauf im Modal. */}
                    <button
                      type="button"
                      class="mainsync-badge"
                      data-testid="mainsync-behind"
                      title={t("session.main_sync_badge_action")}
                      onClick={() => setMainSyncModalOpen(true)}
                    >
                      {mainSync.behind} {t("session.behind_main")}
                    </button>
                    {" · "}
                  </>
                )}
                {projectName(session.project)} ·{" "}
                {loopView ? (
                  <LoopBadge adapter={session.adapter} view={loopView} />
                ) : (
                  session.adapter
                )}{" "}
                · {loopView ? "" : `${shownModel} · `}
                {session.hostId
                  ? (hostNames.get(session.hostId) ??
                    (session.hostId === "local"
                      ? t("common.this_machine")
                      : session.hostId.slice(0, 8)))
                  : t("common.this_machine")}{" "}
                · <LiveStatus sessionId={session.id} status={status} />
                {session.controlMode !== "mirror" && (
                  <>
                    {" · "}
                    <WorkplaceBadge session={record} />
                  </>
                )}
              </div>
            </div>
            {tile && !tile.only && (
              <nav class="subtabs-wrap tile-tabs" aria-label={t("session.views")}>
                {tabButtons}
              </nav>
            )}
            {!tile?.only &&
              !observerOnly &&
              features?.interrupt &&
              (status === "working" ||
                status === "starting" ||
                status === "waiting_approval") && (
                <Button onClick={() => void pause()}>{t("session.pause")}</Button>
              )}
            {!tile?.only && !observerOnly && status !== "stopped" && (
              <Button onClick={stop} variant="danger" class="stop-btn">
                {t("session.stop")}
              </Button>
            )}
            {!tile?.only && (
              <details
                class="session-menu"
                ref={menuRef}
                onToggle={(e) => fitSessionMenu(e.currentTarget)}
              >
                <summary aria-label={t("session.more_actions")} title={t("session.more_actions")}>
                  ⋯
                </summary>
                <div class="session-menu-items">
                  <StatusNote sessionId={session.id} />
                  {mainSync && (
                    <div class="mainsync-menu" data-testid="mainsync-menu">
                      <button
                        type="button"
                        disabled={mainSyncBusy}
                        onClick={() =>
                          void (async () => {
                            setMainSyncBusy(true);
                            setMainSyncResult(null);
                            try {
                              const check = await api.mainSyncCheck(session.id);
                              setMainSync(check);
                              setMainSyncResult(
                                check.behind === 0
                                  ? t("session.up_to_date", { "branch": check.branch })
                                  : check.conflicts && check.conflicts.length > 0
                                    ? t("session.conflict_in_session", { "behind": check.behind, "branch": check.branch, "conflicts": check.conflicts.join(", ") })
                                    : t("session.dry_run_clean", { "behind": check.behind, "branch": check.branch }),
                              );
                            } catch {
                              setMainSyncResult(t("session.check_failed"));
                            } finally {
                              setMainSyncBusy(false);
                            }
                          })()
                        }
                      >
                        {t("session.check_main")}
                      </button>
                      <button
                        type="button"
                        disabled={mainSyncBusy || (mainSync.behind === 0 && mainSync.conflicts === null && !mainSyncResult)}
                        onClick={() =>
                          void (async () => {
                            setMainSyncBusy(true);
                            setMainSyncResult(null);
                            try {
                              const result = await api.mainSyncApply(session.id);
                              if (result.outcome === "applied") setMainSyncResult(t("session.merged_into_main", { "to": result.to }));
                              else if (result.outcome === "conflict") setMainSyncResult(t("session.conflict_nothing", { "files": (result.files ?? []).join(", ") }));
                              else if (result.outcome === "failed") setMainSyncResult(t("session.failed_reason", { "reason": result.reason }));
                              else setMainSyncResult(t("session.skipped_detail", { "reason": result.reason, "detail": result.detail ? `: ${result.detail}` : "" }));
                              const check = await api.mainSyncCheck(session.id);
                              setMainSync(check);
                            } catch {
                              setMainSyncResult(t("session.merge_failed"));
                            } finally {
                              setMainSyncBusy(false);
                            }
                          })()
                        }
                      >
                        {t("session.merge_main")}
                      </button>
                      <span class="dim mainsync-last">
                        {t("session.last_reconciled")} {mainSync.lastSyncedAt ? new Date(mainSync.lastSyncedAt).toLocaleTimeString() : t("common.never")}
                      </span>
                      {mainSyncResult && (
                        <p class="dim mainsync-result" role="status" data-testid="mainsync-result">
                          {mainSyncResult}
                        </p>
                      )}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      menuDo(() => {
                        setTitleDraft(title ?? "");
                        setRenaming(true);
                      })
                    }
                  >
                    {t("session.rename")}
                  </button>
                  <button
                    type="button"
                    onClick={() => menuDo(() => void togglePin())}
                  >
                    {pinned ? t("common.detach") : t("common.pin")}
                  </button>
                  <button
                    type="button"
                    onClick={() => menuDo(() => void toggleArchive())}
                  >
                    {archived ? t("common.unarchive") : t("common.archive_btn")}
                  </button>
                  <button
                    type="button"
                    class="danger"
                    onClick={() =>
                      menuDo(() => setDeleteAsk(true))
                    }
                  >
                    {t("common.delete")}
                  </button>
                </div>
              </details>
            )}
            <div class={`conn-dot ${conn}`} title={conn} />
            {tile?.head?.end}
          </div>

          {fromCache && cached && (
            <div class="badge-stale offline-note">
              {t("session.saved_state_from")}{" "}
              {fmtDateTime(cached.at)}
              {online ? " — verbinde…" : " — offline"}
            </div>
          )}
          {firstNew && (
            <Chip
              onClick={() => jumpTo("seit-letztem-besuch")}
              class="new-jump"
            >
              ↓ {newCount} {t("session.new_since_last_visit")}
            </Chip>
          )}
          {!online && (
            <div class="badge-stale offline-note">
              {t("composer.offline_draft_kept")}
            </div>
          )}
          <div class="run-strip">
            {progress &&
              (progress.percent !== null ? (
                <div class="run-progress-wrap">
                  <button
                    type="button"
                    class="run-progress"
                    title={t("session.todo_list_hint")}
                    onClick={() => setTodosOpen((v) => !v)}
                  >
                    <div class="run-bar">
                      <span style={`width: ${progress.percent}%`} />
                    </div>
                    <span>
                      {todosOpen ? "▾" : "▸"} {progress.done}/{progress.total}{" "}
                      {t("composer.tasks")} {progress.percent} %
                      {progress.etaMs !== null
                        ? ` · noch ca. ${formatMinutes(progress.etaMs)}`
                        : ""}
                    </span>
                  </button>
                  {todosOpen && progress.todos.length > 0 && (
                    <ol class="run-todo-list">
                      {progress.todos.map((t, idx) => (
                        <li key={idx} class={`todo-${t.status}`}>
                          <span class="todo-marker">
                            {t.status === "completed"
                              ? "✔"
                              : t.status === "in_progress" ||
                                  t.status === "in-progress"
                                ? "▶"
                                : t.status === "cancelled"
                                  ? "✖"
                                  : "○"}
                          </span>
                          <span
                            class={`todo-text ${t.status === "completed" ? "done" : ""}`}
                          >
                            {t.text}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              ) : (
                <div class="run-progress dim">
                  {t("session.running_since")} {formatMinutes(progress.elapsedMs)}
                  {/* BUG-0167: Server-Median vorziehen — der Client-Rechner kennt nur sein gekapptes Fenster. */}
                  {estimate?.sessionMedianMs != null
                    ? t("session.turn_median", { "med": formatMinutes(estimate.sessionMedianMs), "count": estimate.sessionTurns ?? 0 })
                    : progress.medianTurnMs !== null
                      ? t("session.turn_median", { "med": formatMinutes(progress.medianTurnMs), "count": progress.turnCount })
                      : " · ohne Plan kein Fortschritt messbar"}
                  {estimateText(estimate, progress.elapsedMs)
                    ? ` · ${estimateText(estimate, progress.elapsedMs)}`
                    : ""}
                </div>
              ))}
            <StatusLine
              totals={tokenTotals}
              processedFallback={tokensKnown ? record.tokensEst : null}
              fill={tokenStats.lastContextTokens}
              windowTokens={windowTokens}
              maxOutputTokens={outputLimitFromEvents(shownEvents)}
              quota={quota}
            />
          </div>

          {factoryLink?.partner && (
            <div>
              {t("session.factory_dash")}{" "}
              {factoryLink.role === "driver"
                ? t("session.driver_chat")
                : t("session.observer_progress")}{" "}
              ·{" "}
              <a
                href={sessionHash(
                  factoryLink.partner,
                  remoteHost(session.hostId),
                )}
              >
                {factoryLink.role === "driver"
                  ? t("session.open_progress")
                  : t("session.open_driver_chat")}
              </a>
            </div>
          )}
          {(status === "interrupted" || status === "error") && (
            <InterruptedBanner
              failed={status === "error"}
              events={events}
              since={record.updatedAt}
              nativeResume={adapterResume?.hub === true}
              autoResumeOnLimit={record.autoResumeOnLimit === true}
              onAutoResumeLimit={async (on) => {
                const updated = await api.setSessionMeta(session.id, {
                  autoResumeOnLimit: on,
                });
                setStatus(updated.status);
                setRecord(updated);
              }}
              onStop={async () => {
                await stop();
              }}
              onHandover={() => setRecoveryHandover(true)}
              onResume={async () => {
                const ack = await api.resumeSession(session.id);
                if (!ack.ok)
                  throw new Error(ack.detail ?? t("session.resume_failed"));
                const updated = await api.session(session.id);
                setStatus(updated.status);
                setRecord(updated);
              }}
              onArchive={async () => {
                const updated = await api.setArchived(session.id, true);
                setArchived(updated.archived === true);
                setStatus(updated.status);
                leaveArchived();
              }}
            />
          )}
          {recoveryHandover && (
            <RecoveryHandover
              session={record}
              api={api}
              onClose={() => setRecoveryHandover(false)}
              onHandedOver={(created) => {
                location.hash = sessionHash(
                  created.id,
                  remoteHost(session.hostId),
                );
              }}
            />
          )}
          {(status === "working" || status === "waiting_approval") && activeBackground.length > 0 && (
            <div class="dim">
              <p role="status">
                {t("session.background_work_active")} {activeBackground.length} {t("session.open_activity")}
                {activeBackground.length === 1 ? "" : "en"}
              </p>
              <ul aria-label={t("session.active_background_tasks")}>
                {activeBackground.map(({ id, label, startedAt }) => (
                  <li key={id}>
                    {label} {t("session.since_dash")} <time dateTime={startedAt}>{fmtDateTime(startedAt, { dateStyle: "short", timeStyle: "short" })}</time>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {loopView && (
            <LoopPanel
              sessionId={session.id}
              adapter={session.adapter}
              view={loopView}
              disabled={observerOnly || status === "stopped"}
              api={api}
              onError={setReplyError}
              factory={
                factoryLink?.role && factoryLink.partner
                  ? { role: factoryLink.role, partner: factoryLink.partner }
                  : null
              }
              hostId={remoteHost(session.hostId) ?? null}
            />
          )}

          {activeTab === "chat" && !viewWindow && lastPrompt && (
            <PinnedPrompt
              event={lastPrompt}
              onJump={() => {
                stickRef.current = false;
                awayRef.current = true; // explicit nach oben gesprungen — nicht zurueckziehen
                userInputAt.current = Date.now();
                tailRef.current
                  ?.querySelector(`[data-seq="${lastPrompt.seq}"]`)
                  ?.scrollIntoView({ behavior: "auto", block: "start" });
              }}
            />
          )}
          {activeTab === "chat" && chat.failed && (
            <div class="chat-load-warning" role="status">
              {t("session.some_step_details_unloadable")}{" "}
              <button type="button" class="link-btn" onClick={chat.retry}>
                {t("session.reload")}
              </button>
            </div>
          )}
          {activeTab === "chat" && recoveredPrompt.failed && (
            <div class="chat-load-warning" role="status">
              {t("session.last_prompt_unloadable")}{" "}
              <button
                type="button"
                class="link-btn"
                onClick={recoveredPrompt.retry}
              >
                {t("session.reload")}
              </button>
            </div>
          )}
          <div
            ref={tailRef}
            class={`tail-scroll${activeTab === "chat" ? " chat-readable" : ""}`}
            onWheel={(event) => {
              userInputAt.current = Date.now();
              if (event.deltaY < 0) stickRef.current = false;
            }}
            onTouchMove={() => (userInputAt.current = Date.now())}
            onPointerDown={() => (userInputAt.current = Date.now())}
            onKeyDown={() => (userInputAt.current = Date.now())}
            onScroll={() => {
              const el = tailRef.current;
              if (!el) return;
              // Unten angekommen: wieder mitlaufen. Nach oben nur auf Nutzereingabe —
              // Layout-Änderungen lösen ebenfalls scroll-Ereignisse aus.
              if (el.scrollHeight - el.clientHeight - el.scrollTop < 48) {
                stickRef.current = true;
                awayRef.current = false; // zurueck an der Spitze — Mitlaufen ist wieder gewollt
              } else if (Date.now() - userInputAt.current < 800) {
                stickRef.current = false;
                awayRef.current = true; // BUG-0207: bewusst weggelesen, nicht erneut festpinnen
                // BUG-0211: am oberen Rand — die frueheren Eintraege daholen. Nur bei eigener
                // Eingabe, damit das Nachziehen der Anker-Korrektur nicht endlos nachlaedt.
                if (
                  el.scrollTop <= 24 &&
                  events.length > 0 &&
                  events[0]!.seq > 1
                )
                  void loadOlder();
              }
              writeTailScroll(
                session.id,
                activeTab,
                stickRef.current ? 0 : el.scrollTop,
              );
            }}
            style={`overflow-y: auto; max-height: ${tailMaxHeight !== null ? `calc(${tailMaxHeight}px / var(--ui-zoom, 1))` : "60vh"}`}
          >
            {events.length > 0 && events[0]!.seq > 1 && (
              /* BUG-0211: der Anfang eines langen Chats ist nur erreichbar, wenn die frueheren
             Eintraege geholt werden — der Hub hat sie, der Client hielt nur TAIL_ROWS. */
              <div class="tail-older" data-testid="load-older">
                <button
                  type="button"
                  class="link-btn"
                  disabled={olderNote === "laden"}
                  onClick={() => void loadOlder()}
                >
                  {olderNote === "laden"
                    ? t("session.older_loading")
                    : t("session.older_entries", { "n": events[0]!.seq - 1 })}
                </button>
                {olderNote === "fehler" && (
                  <span class="tail-older-hint dim">
                    {t("session.hub_not_answering")}
                  </span>
                )}
              </div>
            )}
            {viewWindow && viewKind ? (
              <div class="ui-empty detached-placeholder">
                <p>{VIEW_LABEL[viewKind]} {t("session.runs_in_own_window")}</p>
                <div class="row">
                  <Button
                    onClick={() =>
                      postWindowMessage({ type: "focus", id: viewWindow.id })
                    }
                  >
                    {t("session.show_window")}
                  </Button>
                  <Button
                    onClick={() =>
                      postWindowMessage({ type: "recall", id: viewWindow.id })
                    }
                  >
                    {t("common.unarchive")}
                  </Button>
                </div>
              </div>
            ) : activeTab === "bericht" ? (
              <>
                {detachHead}
                {diffWarning}
                <ReportPane
                  record={record}
                  createdAt={session.createdAt}
                  status={status}
                  numbersReal={reportNumbersReal}
                  diff={diff}
                  usage={usage}
                  context={{
                    fill: tokenStats.lastContextTokens,
                    window: windowTokens,
                  }}
                />
              </>
            ) : activeTab === "diff" ? (
              <>
                <ChangesHead
                  diff={diff}
                  record={record}
                  status={status}
                  detach={detach}
                />
                {diffWarning}
                {noChanges ? (
                  <div class="ui-empty">
                    <p>{t("session.nothing_changed_yet")}</p>
                    <Button onClick={showChatTab}>{t("session.to_chat")}</Button>
                  </div>
                ) : (
                  <DiffReview diff={diff} session={session} />
                )}
                <section class="changes-report" aria-label={t("session.report")}>
                  <h3 class="section-title">{t("session.report")}</h3>
                  <ReportPane
                    record={record}
                    createdAt={session.createdAt}
                    status={status}
                    numbersReal={reportNumbersReal}
                    diff={diff}
                    usage={usage}
                    context={{
                      fill: tokenStats.lastContextTokens,
                      window: windowTokens,
                    }}
                    applyInHead
                  />
                </section>
              </>
            ) : activeTab === "forge" ? (
              <>
                {detachHead}
                <ForgePanel
                  session={session}
                  onOpenSession={(id) => {
                    location.hash = sessionHash(id, remoteHost(session.hostId));
                  }}
                />
              </>
            ) : activeTab === "graph" ? (
              <>
                <div class="graph-pane-tools">
                  <Button
                    aria-label={t("session.graph_in_own_window")}
                    title={t("session.in_own_window")}
                    onClick={() =>
                      void openPopout({
                        kind: "graph",
                        sessionId: session.id,
                        ...(remoteHost(session.hostId)
                          ? { hostId: remoteHost(session.hostId)! }
                          : {}),
                      })
                    }
                  >
                    {t("session.own_window")}
                  </Button>
                </div>
                <GraphPane
                  target={`session=${encodeURIComponent(session.id)}`}
                  hostId={remoteHost(session.hostId) ?? null}
                  onFullscreen={setGraphFull}
                  onOpenFile={(path) => {
                    if (openWorkspaceContent({ sessionId: session.id, ...(remoteHost(session.hostId) ? { hostId: remoteHost(session.hostId)! } : {}), content: { kind: "session", tab: "datei", file: path } })) return;
                    setOpenFile(path);
                    setActiveTab("datei");
                    // BUG-0233: am PC/Tablet den Dateibaum mit aufgehen lassen —
                    // die Auswahl im Kontext des Repos lesen (ab 700 px wie TABLET/WIDE).
                    if (matchMedia("(min-width: 700px)").matches) openLayer("files");
                    // Deeplink wie beim Code-Tab: Back/Reload bleibt nachvollziehbar.
                    location.hash = fileHash(
                      session.id,
                      path,
                      remoteHost(session.hostId),
                    );
                  }}
                />
              </>
            ) : activeTab === "git" ? (
              <GitGraphPane
                target={`session=${encodeURIComponent(session.id)}`}
                hostId={remoteHost(session.hostId) ?? null}
                sessionId={session.id}
              />
            ) : activeTab === "datei" ? (
              <>
                {openFile && (
                  <div class="graph-pane-tools">
                    <Button
                      aria-label={t("session.file_in_own_window")}
                      title={t("session.in_own_window")}
                      onClick={() =>
                        void openPopout({
                          kind: "file",
                          sessionId: session.id,
                          path: openFile,
                          ...(remoteHost(session.hostId)
                            ? { hostId: remoteHost(session.hostId)! }
                            : {}),
                        })
                      }
                    >
                      {t("session.own_window")}
                    </Button>
                  </div>
                )}
                {openFile ? (
                  <FileViewer
                    target={`session=${encodeURIComponent(session.id)}`}
                    path={openFile}
                    hostId={remoteHost(session.hostId) ?? null}
                    sessionId={session.id}
                  />
                ) : (
                  <CodePane
                    active={tile?.active ?? true}
                    sessionId={session.id}
                    hostId={remoteHost(session.hostId) ?? null}
                    onOpenDiff={showDiffTab}
                  />
                )}
              </>
            ) : activeTab === "suche" ? (
              <>
                {detachHead}
                <SearchPane project={session.project} sessionId={session.id} onJumpToSeq={(seq) => void jumpToSeq(seq)} />
              </>
            ) : activeTab === "code" ? (
              <>
                <div class="view-head">
                  <Button
                    aria-label={t("common.open_file_tree")}
                    title={t("session.file_tree_shortcut")}
                    onClick={() => openLayer("files")}
                  >
                    {t("session.file_tree")}
                  </Button>
                  {detach}
                </div>
                <CodePane
                    active={tile?.active ?? true}
                  sessionId={session.id}
                  hostId={remoteHost(session.hostId) ?? null}
                  {...(initialCode ? { initial: initialCode } : {})}
                  onOpenDiff={showDiffTab}
                />
              </>
            ) : activeTab === "umgebung" ? (
              <>
                {detachHead}
                <WorkspaceRuntimePane
                  sessionId={session.id}
                  refreshSeq={workspaceSeq}
                />
              </>
            ) : activeTab === "chat" ? (
              chatItems.length === 0 ? (
                <div class="ui-empty">
                  {live
                    ? t("session.tail_loading", { "suffix": shownModel ? ` · ${shownModel}` : "" })
                    : t("session.no_messages")}
                </div>
              ) : (
                <ChatTurns
                  key={session.id}
                  sessionId={session.id}
                  sessionRef={sessionRef}
                  items={chatItems}
                  live={liveText}
                  expanded={expanded}
                  onToggleExpand={toggleExpanded}
                  onJump={jumpTo}
                  firstNewSeq={firstNew?.seq ?? null}
                  onOpenVerlauf={showVerlaufTab}
                  after={(item, next) => {
                    if (item.kind !== "event" && item.kind !== "work")
                      return null;
                    const last =
                      item.kind === "event"
                        ? item.event.seq
                        : itemLastSeq(item);
                    const closed = turnsClosedBetween(
                      tokenStats.turns,
                      last,
                      next ? itemFirstSeq(next) : null,
                    );
                    if (closed.length === 0) return null;
                    const turnFill = closed[closed.length - 1]!.contextTokens;
                    return (
                      <div class="turn-stats dim">
                        {turnStatsText(
                          tokenStats.turns.findIndex(
                            (t) => t.endSeq === closed[0]!.endSeq,
                          ) + 1,
                          closed,
                        )}
                      </div>
                    );
                  }}
                />
              )
            ) : visible.length === 0 ? (
              <div class="ui-empty">
                {status === "working" || status === "starting"
                  ? t("session.tail_loading", { "suffix": shownModel ? ` · ${shownModel}` : "" })
                  : t("session.no_messages")}
              </div>
            ) : (
              <>
                {hiddenOlder > 0 && (
                  <div class="dim" data-testid="older-hidden">
                    {hiddenOlder} {t("session.older_entries")}
                  </div>
                )}
                {visible.map((e, i) => {
                  // ADR-0032: the token bill of a turn shows under its last
                  // visible row — even where the filter hides session.turn_end.
                  const closed = turnsClosedBetween(
                    tokenStats.turns,
                    e.seq,
                    visible[i + 1]?.seq ?? null,
                  );
                  return (
                    <Fragment key={e.seq}>
                      {needsDaySeparator(visible[i - 1]?.ts, e.ts) && (
                        <div class="day-sep" data-testid="day-sep">
                          <span>{dayLabel(e.ts)}</span>
                        </div>
                      )}
                      {e.seq === firstNew?.seq && (
                        <div class="new-divider" id="seit-letztem-besuch">
                          {t("session.new_since_last_visit_cap")}
                        </div>
                      )}
                      <EventRow
                        event={e}
                        expanded={expanded.has(e.seq)}
                        onToggleExpand={() => toggleExpanded(e.seq)}
                        sessionRef={sessionRef}
                        toolResult={
                          e.type === "tool_use"
                            ? toolResultByToolId.get(toolIdOf(e) ?? "")
                            : undefined
                        }
                        onJump={jumpTo}
                      />
                      {closed.length > 0 && (
                        <div class="turn-stats dim">
                          {turnStatsText(
                            tokenStats.turns.findIndex(
                              (t) => t.endSeq === closed[0]!.endSeq,
                            ) + 1,
                            closed,
                          )}
                        </div>
                      )}
                    </Fragment>
                  );
                })}
              </>
            )}
          </div>

          {!tile?.only && (
            <div class="dock-stack" ref={dockRef}>
              <button
                class="dock-toggle"
                type="button"
                aria-label={
                  controlsFolded
                    ? t("session.show_controls")
                    : t("session.hide_controls")
                }
                title={
                  controlsFolded
                    ? t("session.show_controls")
                    : t("session.hide_controls")
                }
                aria-expanded={!controlsFolded}
                onClick={toggleControls}
              >
                {controlsFolded ? "▴" : "▾"}
              </button>
              {controlsFolded && observerOnly && status !== "stopped" && (
                <div class="composer-actions">
                  <span class="observer-note">
                    {t("session.observe_only")}
                  </span>
                  <Button onClick={() => void stop()}>
                    {t("session.end_observation")}
                  </Button>
                </div>
              )}
              {providerFailure && (
                <HandoverBar
                  failure={providerFailure}
                  session={record}
                  api={api}
                  onHandedOver={(created) => {
                    location.hash = sessionHash(
                      created.id,
                      remoteHost(session.hostId),
                    );
                  }}
                  onRepaired={async () => {
                    const updated = await api.session(session.id);
                    setStatus(updated.status);
                    setRecord(updated);
                  }}
                />
              )}
              <SessionApprovals sessionId={session.id} api={api} />
              {!controlsFolded && !observerOnly && (
                <SessionConfigure
                  session={record}
                  features={features}
                  api={api}
                  onChanged={(patch) =>
                    setRecord((prev) => ({ ...prev, ...patch }))
                  }
                />
              )}
              {!controlsFolded && (showReply || status !== "stopped") && (
                <div class="dock-actions">
                  {replyError && (
                    <div class="reply-error">
                      {replyError}
                      {leaseHeld && (
                        <Button
                          onClick={() => void sendReply(true)}
                          disabled={replyBusy}
                        >
                          {t("common.apply")}
                        </Button>
                      )}
                      {/* T8.6: a failed send is one tap from the next try — same input id, no double turn. */}
                      {!leaseHeld &&
                        online &&
                        (reply.trim() || replyAttachments.length > 0) && (
                          <Button
                            onClick={() => void sendReply()}
                            disabled={replyBusy}
                          >
                            {t("common.retry")}
                          </Button>
                        )}
                    </div>
                  )}
                  {showReply && draft.conflict && (
                    <div class="draft-conflict" role="alert">
                      <div>
                        {draft.conflict.device ?? t("session.other_device")} {t("session.has_changed_draft")}{" "}
                        <em>
                          „{draft.conflict.text.slice(0, 160) || "(leer)"}“
                        </em>
                      </div>
                      <div class="row">
                        <Button onClick={draft.takeTheirs}>
                          {t("session.accept_theirs")}
                        </Button>
                        <Button onClick={draft.keepMine} variant="primary">
                          {t("session.keep_mine")}
                        </Button>
                      </div>
                    </div>
                  )}
                  {showReply && (
                    <PcOpenNotice
                      sessionId={session.id}
                      api={api}
                      resume={adapterResume}
                    />
                  )}
                  {showReply && (
                    <QueueList
                      sessionId={session.id}
                      api={api}
                      refreshKey={queueTick}
                      working={turnRunning}
                      steerable={midTurnInput}
                    />
                  )}
                  {showReply &&
                    !draft.conflict &&
                    !reply.trim() &&
                    agentQuestion && (
                      <QuickConfirm
                        disabled={replyBusy || !online}
                        onAnswer={(text) => void sendText(text)}
                      />
                    )}
                  {showReply && (
                    <Composer
                      value={reply}
                      onChange={setReply}
                      fieldId="reply"
                      placeholder={t("session.answer_ph")}
                      disabled={replyBusy}
                      adapter={session.adapter}
                      project={session.project}
                      adapterEnhance={adapterEnhance}
                      commands={adapterCommands}
                      commandScope="steer"
                      onSubmit={
                        !replyBusy &&
                        online &&
                        (reply.trim() || replyAttachments.length > 0)
                          ? () =>
                              void sendReply(
                                false,
                                running ? delivery === "queue" : undefined,
                              )
                          : undefined
                      }
                      attachments={replyAttachments}
                      onAttachmentsChange={setReplyAttachments}
                      sourceTarget={session.id}
                      extraActions={
                        <>
                          {running ? (
                            // Läuft ein Zug, ersetzt die Zustellwahl den Senden-Knopf — kein zweiter
                            // Knopf daneben (BUG-0053: im Querformat ist neben der Eingabe kein Platz).
                            // ADR-0085: der Chip wählt, was der Knopf tut. Er steht rechts vom
                            // Hauptknopf (Zuerst die Handlung, dann die Art) und ist der Baustein
                            // `Chip` mit Linienzeichen — Nutzerfund 18.11.: das Emoji wirkte billig.
                            <>
                              <Button
                                aria-busy={replyBusy}
                                data-testid={
                                  delivery === "now" ? "send-now" : "send-queue"
                                }
                                onClick={() =>
                                  void sendReply(false, delivery === "queue")
                                }
                                disabled={
                                  replyBusy ||
                                  !online ||
                                  (!reply.trim() &&
                                    replyAttachments.length === 0)
                                }
                                variant="primary"
                                class={replyBusy ? "busy" : undefined}
                              >
                                {replyBusy
                                  ? t("common.loading_dots")
                                  : delivery === "now"
                                    ? t("session.steer_now")
                                    : t("session.queue_up")}
                              </Button>
                              {midTurnInput && (
                                /* Der Name ohne das Wort "vormerken": der Hauptknopf heißt so, und
                              die Rollensuche findet Teilzeichenketten — sonst zählt eine Spec zwei Knöpfe. */
                                <Chip
                                  class="delivery-choice"
                                  data-testid="delivery-toggle"
                                  active={delivery === "now"}
                                  aria-label={
                                    delivery === "now"
                                      ? t("session.delivery_steer_now")
                                      : t("session.delivery_wait")
                                  }
                                  title={
                                    delivery === "now"
                                      ? t("session.steer_now_hint")
                                      : t("session.wait_hint")
                                  }
                                  onClick={() =>
                                    chooseDelivery(
                                      delivery === "now" ? "queue" : "now",
                                    )
                                  }
                                >
                                  {delivery === "now" ? (
                                    <BoltGlyph />
                                  ) : (
                                    <WaitGlyph />
                                  )}
                                  {delivery === "now" ? "lenken" : t("session.at_turn_end")}
                                </Chip>
                              )}
                            </>
                          ) : (
                            <Button
                              aria-busy={replyBusy}
                              onClick={() => void sendReply()}
                              disabled={
                                replyBusy ||
                                !online ||
                                (!reply.trim() && replyAttachments.length === 0)
                              }
                              variant="primary"
                              class={replyBusy ? "busy" : undefined}
                            >
                              {replyBusy
                                ? t("common.loading_dots")
                                : status === "stopped" || status === "parked"
                                  ? t("session.next")
                                  : t("session.send")}
                            </Button>
                          )}
                        </>
                      }
                    />
                  )}
                  {!showReply && status !== "stopped" && (
                    <div class="composer-actions">
                      {observerOnly ? (
                        <>
                          <span class="observer-note">
                            {t("session.observe_only_multiline")}
                          </span>
                          <Button onClick={stop}>{t("session.end_observation")}</Button>
                        </>
                      ) : null}
                    </div>
                  )}
                </div>
              )}
              {/* AC-P1.6-2: this sub-filter used to sit right under the topbar
               * (top ~15% zone) — moved down here so every control, not just the
               * dock/tabs, lives in the thumb zone. */}
              {!controlsFolded && showVerlaufFilterBar && (
                <div class="filter-bar dock-filter-bar">
                  {FILTERS.filter((f) => f.id !== "lesen").map((f) => (
                    <button
                      key={f.id}
                      class={`chip ${filter === f.id ? "active" : ""}`}
                      onClick={() => setFilter(f.id)}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              )}
              {!tile && (
                <nav class="subtabs-wrap" aria-label={t("session.views")}>
                  {tabButtons}
                </nav>
              )}
            </div>
          )}
        </div>
      </div>
      <MainSyncModal
        open={mainSyncModalOpen}
        onClose={() => setMainSyncModalOpen(false)}
        api={api}
        sessionId={session.id}
        initial={mainSync}
        onDone={() => void refreshMainSync()}
      />
      <ConfirmDialog
        open={deleteAsk}
        onClose={() => setDeleteAsk(false)}
        onConfirm={() => {
          setDeleteAsk(false);
          void api
            .deleteSession(session.id)
            .then(leaveArchived)
            .catch((err) =>
              setReplyError(
                err instanceof Error
                  ? err.message
                  : t("session.delete_failed"),
              ),
            );
        }}
        title={t("common.delete")}
        body={t("session.delete_forever_q")}
        danger
        confirmLabel={t("common.delete")}
      />
    </ApiContext.Provider>
  );
}

/** EPIC-P43 T43.2: der Zustand im Kopf — eigener Baustein, damit die Hub-Abfrage nicht die ganze Session neu zeichnet. */
function LiveStatus({
  sessionId,
  status,
}: {
  sessionId: string;
  status: string;
}) {
  const hub = useHubStatus();
  return (
    <StatusDot
      status={status}
      question={hub.questionSessions.includes(sessionId)}
    />
  );
}
