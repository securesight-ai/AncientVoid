import { t } from "../../shared/i18n/index.ts";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { getToken, hostApi, hubApi, remoteHost, type AdapterUsage, type FleetHost, type SessionRecord } from "../../shared/api.ts";
import { parseAppHash, type ToolPageId, TOOL_PAGE_IDS } from "../../app/route.ts";
import { NyxWindow } from "../nyx/Nyx.tsx";
import { SessionTail } from "../session/SessionTail.tsx";
import { GraphPane } from "../graph/GraphPane.tsx";
import { FileViewer } from "../files/FileViewer.tsx";
import { FilesLayer } from "../files/FilesLayer.tsx";
import { ToolPane } from "../shell/ToolPane.tsx";
import { VaultPane } from "../vault/VaultPane.tsx";
import { NyxFab } from "../stt/NyxFab.tsx";
import { BrowserPanel } from "../browser/BrowserLayer.tsx";
import { DevicePanel } from "../devices/DeviceLayer.tsx";
import { publishHubStatus } from "../shell/hub-status.ts";
import { App } from "../../app/App.tsx";
import { HEARTBEAT_MS, SESSION_VIEW_KINDS, VIEW_LABEL, VIEW_TAB, type SessionViewKind, type WindowTarget } from "./protocol.ts";
import { rememberWindowGeometry, onWindowMessage, openPopout, postWindowMessage, startWindowHub } from "./windows.ts";
import { projectName } from "../../shared/project-name.ts";
import { Button } from "../../shared/ui/index.ts";

type ViewTarget = Extract<WindowTarget, { kind: SessionViewKind }>;
function isViewTarget(target: WindowTarget): target is ViewTarget {
  return (SESSION_VIEW_KINDS as readonly string[]).includes(target.kind);
}

function targetFromHash(hash: string): WindowTarget | null {
  const route = parseAppHash(hash);
  // ADR-0068: die Ansicht steht im Query, die Hash-Route bleibt die der Session bzw. `#/`.
  const view = new URLSearchParams(location.search).get("view");
  if (view === "queue") return { kind: "queue" };
  if (view === "nyx") return { kind: "nyx" };
  const viewKind = SESSION_VIEW_KINDS.find((k) => k === view);
  if (viewKind && route.view === "tail") return { kind: viewKind, sessionId: route.sessionId, ...(route.hostId ? { hostId: route.hostId } : {}) };
  if (route.view === "list" && route.page === "vault") return route.vaultFile ? { kind: "vault", path: route.vaultFile } : { kind: "vault" };
  if (route.view === "devices") return { kind: "device" };
  if (route.view === "filetree") return { kind: "filetree" };
  // Ein Anhang ist kein eigenes Popout-Fenster — das Hauptfenster oeffnet ihn als Vollbild.
  if (route.view === "attachment") return null;
  if (route.view === "tail") {
    if (route.browser) return { kind: "browser", sessionId: route.sessionId, ...(route.hostId ? { hostId: route.hostId } : {}) };
    if (route.tab === "graph") return { kind: "graph", sessionId: route.sessionId, ...(route.hostId ? { hostId: route.hostId } : {}) };
    if (route.tab === "datei" && route.file) return { kind: "file", sessionId: route.sessionId, path: route.file, ...(route.hostId ? { hostId: route.hostId } : {}) };
    return { kind: "session", sessionId: route.sessionId, ...(route.hostId ? { hostId: route.hostId } : {}) };
  }
  return (TOOL_PAGE_IDS as readonly string[]).includes(route.page) ? { kind: "tool", page: route.page as ToolPageId } : null;
}

/** Werkzeugseiten lesen ihre Daten aus dem Hub-Status, den im Hauptfenster `App` füllt — hier füllt ihn das Fenster selbst. */
function useToolData(active: boolean) {
  useEffect(() => {
    if (!active) return;
    let alive = true;
    const tick = async () => {
      try {
        const [fleet, adapters] = await Promise.all([
          hubApi.fleet().catch(async () => ({ self: "", hosts: [] as FleetHost[], sessions: await hubApi.sessions() })),
          hubApi.adapters(),
        ]);
        const usage = Object.fromEntries(await Promise.all(adapters.map(async (a) => [a.id, await hubApi.adapterUsage(a.id)] as const))) as Record<string, AdapterUsage>;
        if (alive) publishHubStatus({ connected: true, error: "", lastOkAt: Date.now(), sessions: fleet.sessions, hosts: fleet.hosts, adapters, usage });
      } catch (err) {
        if (alive) publishHubStatus({ connected: false, error: err instanceof Error ? err.message : "load failed" });
      }
    };
    void tick();
    const timer = setInterval(tick, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [active]);
}

/**
 * EPIC-P34 T34.10: die schlanke Hülle eines eigenen Fensters — eine Session oder eine Werkzeugseite ohne Dock, Liste
 * und Kachel-Tasten. Sie schreibt nie `ancientvoid.workspace` und nie den Hash des Hauptfensters; ihr einziger Draht
 * ins Hauptfenster ist der Kanal (ADR-0053).
 */
export function PopoutShell() {
  const target = useMemo(() => targetFromHash(location.hash), []);
  const id = useRef(crypto.randomUUID()).current;
  const [session, setSession] = useState<SessionRecord | null>(null);
  // Titel-Zeile: Session-Titel, sonst der Projektname — eine Session ohne Titel heißt nicht nur „Session“.
  const sessionLabel = session?.title ?? (session ? projectName(session.project) : undefined) ?? t("common.session_cap");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!target) return;
    const stop = startWindowHub();
    const hello = () => { rememberWindowGeometry(target); postWindowMessage({ type: "hello", id, target }); };
    hello();
    const beat = setInterval(() => { rememberWindowGeometry(target); postWindowMessage({ type: "heartbeat", id }); }, HEARTBEAT_MS);
    const off = onWindowMessage((msg) => {
      if (msg.type === "ping") hello();
      // ADR-0068: „Zurückholen“ aus dem Hauptfenster — wie „In die App zurück“.
      if (msg.type === "recall" && msg.id === id) {
        postWindowMessage({ type: "return", id, target });
        window.close();
      }
      if (msg.type === "focus" && msg.id === id) {
        window.focus();
        // Prüfbar ohne Bildschirm: Browser dürfen `focus()` ohne Nutzeraktion verweigern.
        document.documentElement.dataset.focusRequests = String(Number(document.documentElement.dataset.focusRequests ?? "0") + 1);
      }
    });
    const bye = () => postWindowMessage({ type: "bye", id, target });
    window.addEventListener("pagehide", bye);
    return () => {
      clearInterval(beat);
      off();
      window.removeEventListener("pagehide", bye);
      bye();
      stop();
    };
  }, []);

  useEffect(() => {
    if (!target || !("sessionId" in target)) return;
    hostApi(target.hostId)
      .session(target.sessionId)
      .then((s) => {
        setSession(s);
        const label = s.title ?? projectName(s.project) ?? t("common.session_cap");
        document.title = `⧉ ${target.kind === "graph" ? `Graph · ${label}` : target.kind === "file" ? `${target.path.split("/").pop()} · ${label}` : isViewTarget(target) ? `${VIEW_LABEL[target.kind]} · ${label}` : label}`;
      })
      .catch(() => setError("Diese Session gibt es nicht mehr oder sie ist nicht erreichbar."));
  }, []);
  useToolData(target?.kind === "tool");

  // Offline: das Fenster sagt es, statt still zu veralten (der Tail verbindet sich selbst neu).
  const [online, setOnline] = useState(navigator.onLine);
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

  const giveBack = () => {
    if (target) postWindowMessage({ type: "return", id, target });
    window.close();
  };

  if (!target) return <div class="popout-shell"><div class="ui-empty">{t("windows.window_no_target")}</div></div>;
  if (!getToken()) return <div class="popout-shell"><div class="ui-empty">{t("windows.not_signed_in")}</div></div>;
  return (
    <div class="popout-shell">
      <header class="popout-bar">
        <span class="popout-title">
          ⧉ {isViewTarget(target) ? `${VIEW_LABEL[target.kind]} · ${sessionLabel}` : target.kind === "queue" ? "Warteschlange" : target.kind === "nyx" ? "Nyx" : target.kind === "tool" ? "Werkzeug" : target.kind === "filetree" ? "Dateibaum" : target.kind === "vault" ? `Notizen${target.path ? ` · ${target.path.split("/").pop()}` : ""}` : target.kind === "browser" ? `Browser · ${sessionLabel}` : target.kind === "device" ? "Android-Geräte" : target.kind === "graph" ? `Repo-Graph · ${sessionLabel}` : target.kind === "file" ? `Datei · ${target.path.split("/").pop()}` : sessionLabel}
        </span>
        <Button onClick={giveBack}>
          {t("windows.back_to_app")}
        </Button>
      </header>
      {!online && <div class="popout-offline" role="status">{t("windows.offline_reconnect")}</div>}
      {isViewTarget(target) ? (
        // ADR-0068: genau diese Ansicht — keine Reiter, kein Antwortfeld, kein Session-Menü.
        error ? (
          <div class="ui-empty">{error}</div>
        ) : session ? (
          <section class="tile popout-tile" data-tile="1" aria-label={VIEW_LABEL[target.kind]}>
            <SessionTail key={session.id} session={session} onNavigate={() => undefined} tile={{ active: true, compact: false, only: VIEW_TAB[target.kind] }} />
          </section>
        ) : (
          <div class="ui-empty dim">{t("common.loading_dots")}</div>
        )
      ) : target.kind === "nyx" ? (
        <div class="popout-tool">
          <NyxWindow />
        </div>
      ) : target.kind === "filetree" ? (
        // BUG-0128: Baum und alle offenen Dateien der Seitenleiste als genau ein Fenster —
        // derselbe Gerät-Zustand (localStorage), die Sidebar füllt das Fenster.
        <div class="popout-files">
          <FilesLayer wide focusedSessionId={null} windowed />
        </div>
      ) : target.kind === "queue" ? (
        <div class="popout-tool popout-queue">
          <App
            page="dashboard"
            dock={false}
            ready={() => location.reload()}
            onOpen={(s) => void openPopout({ kind: "session", sessionId: s.id, ...(remoteHost(s.hostId) ? { hostId: remoteHost(s.hostId)! } : {}) })}
          />
        </div>
      ) : target.kind === "session" ? (
        error ? (
          <div class="ui-empty">{error}</div>
        ) : session ? (
          <section class="tile popout-tile" data-tile="1" aria-label={t("common.session_cap")}>
            <SessionTail key={session.id} session={session} onNavigate={() => undefined} tile={{ active: true, compact: false }} />
          </section>
        ) : (
          <div class="ui-empty dim">{t("common.loading_dots")}</div>
        )
      ) : target.kind === "graph" ? (
        error ? (
          <div class="ui-empty">{error}</div>
        ) : (
          // EPIC-P48: Der Graph des eigenen Fensters öffnet Dateien als weitere eigene Fenster.
          <div class="popout-graph">
            <GraphPane
              target={`session=${encodeURIComponent(target.sessionId)}`}
              hostId={target.hostId ?? null}
              onOpenFile={(path) => void openPopout({ kind: "file", sessionId: target.sessionId, path, ...(target.hostId ? { hostId: target.hostId } : {}) })}
            />
          </div>
        )
      ) : target.kind === "file" ? (
        error ? (
          <div class="ui-empty">{error}</div>
        ) : (
          <div class="popout-file">
            <FileViewer target={`session=${encodeURIComponent(target.sessionId)}`} path={target.path} hostId={target.hostId ?? null} />
          </div>
        )
      ) : target.kind === "vault" ? (
        // EPIC-P49: Der Vault lädt seine Daten selbst — dasselbe Ziel wie der Tab, als Fenster.
        <div class="popout-tool">
          <VaultPane {...(target.path ? { initialFile: target.path } : {})} />
        </div>
      ) : target.kind === "browser" ? (
        // EPIC-P39 T39.3-Rest: Browser-Panel als eigenes Fenster; lädt Status/Bild selbst per HTTP.
        error ? (
          <div class="ui-empty">{error}</div>
        ) : (
          <div class="popout-browser">
            <BrowserPanel
              sessionId={target.sessionId}
              label={sessionLabel === t("common.session_cap") ? null : sessionLabel}
              hostId={target.hostId ?? null}
              onClose={giveBack}
            />
          </div>
        )
      ) : target.kind === "device" ? (
        // EPIC-P42: Geräte-Panel als eigenes Fenster — host-scoped, Lease braucht eine Session im Hauptfenster.
        <div class="popout-browser">
          <DevicePanel sessionId={null} label={null} hostId={null} onClose={giveBack} />
        </div>
      ) : (
        <div class="popout-tool">
          <ToolPane
            page={target.page}
            onClose={giveBack}
            onSwitchToken={() => location.reload()}
            closeLabel={t("windows.back_to_app")}
            escCloses={false}
          />
        </div>
      )}
      <NyxFab />
    </div>
  );
}
