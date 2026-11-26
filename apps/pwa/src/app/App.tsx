import { t } from "../shared/i18n/index.ts";
import { useEffect, useRef, useState } from "preact/hooks";
import { hubApi, type AdapterInfo, type AdapterUsage, type ApprovalRequest, type FleetHost, type SessionRecord } from "../shared/api.ts";
import { Dashboard } from "../features/overview/Dashboard.tsx";
import { NotificationCenter } from "../features/notifications/Notifications.tsx";
import { GlobalDock, type Page } from "./Dock.tsx";
import { pageHash } from "./route.ts";
import { setHere } from "../shared/command-context.ts";
import { openCommandBar } from "../features/commands/CommandBar.tsx";
import { ApprovalQueuePane } from "../features/approvals/Approvals.tsx";
import { StatusPage } from "../features/status/StatusPage.tsx";
import { SettingsPage } from "../features/settings/SettingsPage.tsx";
import { CreateSession } from "../features/new-session/CreateSession.tsx";
import { MediaPage } from "../features/media/MediaPage.tsx";
import { DesktopPage } from "../features/desktop/DesktopPage.tsx";
import { VaultTabs } from "../features/vault/VaultTabs.tsx";
import { TeamsPane } from "../features/team/TeamsPane.tsx";
import { AutomationsPane } from "../features/automations/AutomationsPane.tsx";
import { StatisticsPage } from "../features/statistics/StatisticsPage.tsx";
import { TerminalPage } from "../features/terminal/TerminalPage.tsx";
import { ReleaseNotesPage } from "../features/release-notes/ReleaseNotesPage.tsx";
import { publishHubStatus } from "../features/shell/hub-status.ts";
import { getLastSession } from "../features/shell/last-session.ts";
import { DetachButton } from "../features/windows/DetachButton.tsx";
import { NyxButton } from "../features/nyx/Nyx.tsx";
import { Button } from "../shared/ui/index.ts";

export function App({
  onOpen,
  ready,
  page,
  vaultFile = null,
  vaultTab = "notizen",
  statTab = null,
  wide = false,
  dock = true,
  bell = false,
}: {
  /** `newTile`: Ctrl/⌘-click — open next to the others (EPIC-P18). */
  onOpen: (session: SessionRecord, opts?: { newTile?: boolean; seq?: number; seqAt?: number }) => void;
  ready: () => void;
  /** T8.1: the page comes from the URL (#/neu, #/status …). */
  page: Page;
  /** EPIC-P49: Vault-Datei aus dem Hash (#/notizen/datei/<path>). */
  vaultFile?: string | null;
  /** EPIC-P74 T74.6: Reiter im Notizen-Bereich aus dem Hash (#/notizen/wissen). */
  vaultTab?: "notizen" | "wissen";
  /** EPIC-P34 T34.2: on a wide screen the tool pages live in the detail column (ToolPane); the list stays the list. */
  /** BUG-0257: Reiter der Analyse-Seite aus dem Hash (#/statistik/metriken). */
  statTab?: "hosts" | "metriken" | "inferenz" | null;
  wide?: boolean;
  /** EPIC-P43 T43.7: die Warteschlange als eigenes Fenster hat kein Dock (ADR-0053 Punkt 2). */
  dock?: boolean;
  /** EPIC-P64 T64.4: Glocke als Flusselement im Topbar (nur am PC mit sichtbarer Liste — main.tsx rendert sie sonst). */
  bell?: boolean;
}) {
  const shown: Page = wide ? "dashboard" : page;
  useEffect(() => setHere({ page, sessionId: null, hostId: null, sessionRevision: null }), [page]);
  const setPage = (p: Page) => {
    location.hash = pageHash(p);
  };
  const [sessions, setSessions] = useState<SessionRecord[] | null>(null);
  // EPIC-P6: hosts of the fleet (just this hub when nothing is paired).
  const [hosts, setHosts] = useState<FleetHost[]>([]);
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [usage, setUsage] = useState<Record<string, AdapterUsage>>({});
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  // T1.6-2: bottom-dock navigation replaces the top icon buttons ("Buttons
  // oben sind sehr schlecht zu bedienen" — real ergonomics feedback from
  // the mockup review). Settings didn't exist as a destination before.
  // T1.6-3: initialPage lets SessionTail's dock jump straight to "new" or
  // "settings" instead of always landing back on the dashboard.
  // T2.6: pending-approval count for the Dashboard banner. A 501 (no
  // ApprovalService configured on this hub) is a real, common state, not
  // an error to surface — same "feature genuinely absent" handling as
  // Approvals.tsx itself.
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  // BUG-0045: ein einzelner fehlgeschlagener Abruf ist kein Ausfall — erst der
  // zweite in Folge zeigt die Fehlerkarte (die Seite sonst nach unten schiebt).
  const failedPolls = useRef(0);

  useEffect(() => {
    let alive = true;
    // **Eigene Sitzungen sofort**, die Flotten-Sicht dahinter. Die eigene Liste liegt in
    // Millisekunden vor (gemessen 6 ms gegen `/api/sessions`), die Flotten-Sicht muss
    // jeden Partner befragen (gemessen 3,0 s; bei einem abwesenden Rechner deutlich
    // länger). Ohne diesen Schritt hing die Liste nach dem Zurücktippen auf dem Handy
    // sekundenlang bei „loading…“ und war nicht mehr zu brauchen — Nutzerfund
    // 24.11.2026: „Zurück-Taste funktioniert nicht, ich muss die App schließen“.
    hubApi
      .sessions()
      .then((eigene) => {
        if (alive) setSessions((vorher) => vorher ?? eigene);
      })
      .catch(() => undefined);
    const tick = async () => {
      try {
        const [fleet, a] = await Promise.all([
          // An older hub has no /api/fleet — its own list is the whole fleet.
          hubApi.fleet().catch(async () => ({ self: "", hosts: [] as FleetHost[], sessions: await hubApi.sessions() })),
          hubApi.adapters(),
        ]);
        if (!alive) return;
        setSessions(fleet.sessions);
        setHosts(fleet.hosts);
        setAdapters(a);
        failedPolls.current = 0;
        setError("");
        publishHubStatus({ connected: true, error: "", lastOkAt: Date.now(), sessions: fleet.sessions, hosts: fleet.hosts });
        hubApi
          .approvals("pending")
          .then((pending) => {
            if (!alive) return;
            setPendingApprovals(pending.length);
            const questions = pending.filter((p) => (p.tool?.questions?.length ?? 0) > 0).map((p) => p.sessionId);
            setApprovals((prev) => (prev.length === pending.length && prev.every((p, i) => p.id === pending[i]!.id) ? prev : pending));
            publishHubStatus({ pendingApprovals: pending.length, questionSessions: questions });
          })
          // 501: dieser Hub hat keine Freigaben — echte 0. Sonst den letzten Stand behalten.
          .catch((err: unknown) => {
            if (alive && err instanceof Error && /^501|not configured/.test(err.message)) {
              setPendingApprovals(0);
              setApprovals([]);
              publishHubStatus({ pendingApprovals: 0, questionSessions: [] });
            }
          });
        // T1.5-3/ADR-0004: one usage snapshot per known adapter, not per
        // session — fetched alongside the existing poll, not a second
        // independent timer.
        const usageEntries = await Promise.all(
          a.map(async (adapter) => [adapter.id, await hubApi.adapterUsage(adapter.id)] as const),
        );
        if (!alive) return;
        const usageByAdapter = Object.fromEntries(usageEntries);
        setUsage(usageByAdapter);
        publishHubStatus({ adapters: a, usage: usageByAdapter });
      } catch (err) {
        failedPolls.current += 1;
        if (alive && failedPolls.current >= 2) {
          const message = err instanceof Error ? err.message : "load failed";
          setError(message);
          publishHubStatus({ connected: false, error: message });
        }
      }
    };
    void tick();
    const timer = setInterval(tick, 3000);
    // T8.6: "Erneut versuchen" restarts the poll at once.
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [retry]);

  return (
    <div class="app-page">
      <div class="topbar">
        {/* EPIC-P23 T23.1: "AncientVoid" leads to the overview from everywhere, the last session marked there. */}
        <h1>
          <button class="brand-link" type="button" title={t("app.to_overview")} onClick={() => setPage("dashboard")}>
            <img class="brand-logo" src="/assets/logo.webp" alt="" width="28" height="28" />
            <span class="brand-name">{t("app.ancientvoid")}</span>
          </button>
        </h1>
        <div style="display: flex; gap: 10px; align-items: center">
          {/* EPIC-P43 T43.8: die kleine Nyx — Gesamtzustand; Antippen öffnet das Blatt mit allem, was wartet. */}
          <NyxButton online={!error} sessions={sessions ?? []} approvals={approvals} onChanged={() => setRetry((n) => n + 1)} />
          {/* Real user feedback (2026-09-19): provider/quota detail used to
           * sit inline on the Dashboard, dominating small screens before
           * any session ever showed — moved to its own page, reached from
           * here. */}
          <button class="link-btn command-open" type="button" onClick={openCommandBar} aria-label={t("common.voice_order")} title={t("common.voice_order")}>
            ✦
          </button>
          <button class="link-btn" onClick={() => setPage("status")} title={t("common.provider_status")}>
            {t("common.status")}
          </button>
          {/* Real connection health, not a decorative always-green dot — same
           * classes SessionTail already uses for its own WS status. */}
          <span class={`conn-dot ${error ? "closed" : "live"}`} title={error ? error : t("common.connected")} />
          {/* EPIC-P43 T43.7: die Warteschlange als eigenes Fenster (nur am PC, letzte Taste im Kopf). */}
          {shown === "dashboard" && <DetachButton target={{ kind: "queue" }} label={t("common.queue")} />}
          {/* EPIC-P64 T64.4: am PC mit sichtbarer Liste sitzt die Glocke als
           * Flusselement rechts im Kopf der Listenspalte — kein Overlay. */}
          {bell && <NotificationCenter flow />}
        </div>
      </div>

      {error && (
        <div class="card" data-testid="load-error" role="alert" style="color: var(--err)">
          {error}{" "}
          <Button onClick={() => setRetry((n) => n + 1)}>
            {t("common.retry")}
          </Button>
        </div>
      )}

      {shown === "new" && (
        <CreateSession
          adapters={adapters}
          hosts={hosts}
          onCreated={(s) => onOpen(s)}
        />
      )}

      {shown === "settings" && <SettingsPage onSwitchToken={ready} />}

      {shown === "approvals" && <ApprovalQueuePane />}

      {shown === "status" && <StatusPage adapters={adapters} usage={usage} />}

      {shown === "media" && <MediaPage sessions={sessions ?? []} />}

      {shown === "pc" && <DesktopPage />}

      {shown === "vault" && <VaultTabs {...(vaultFile ? { initialFile: vaultFile } : {})} initialTab={vaultTab} />}
      {shown === "teams" && <TeamsPane />}
      {shown === "automationen" && <AutomationsPane />}
      {shown === "statistics" && <StatisticsPage {...(statTab ? { tab: statTab } : {})} />}
      {shown === "terminal" && <TerminalPage />}
      {shown === "releasenotes" && <ReleaseNotesPage />}
      {shown === "dashboard" &&
        (sessions === null ? (
          <div class="empty">{t("common.loading_short")}</div>
        ) : (
          <Dashboard
            sessions={sessions}
            hosts={hosts}
            onOpen={onOpen}
            pendingApprovals={pendingApprovals}
            approvals={approvals}
            onOpenApprovals={() => setPage("approvals")}
            lastSession={getLastSession()}
            probeAvailable={adapters.some((a) => a.id === "dummy")}
          />
        ))}

      {dock && (
        <div class="dock-stack">
          <GlobalDock active={page} onNavigate={setPage} />
        </div>
      )}
    </div>
  );
}
