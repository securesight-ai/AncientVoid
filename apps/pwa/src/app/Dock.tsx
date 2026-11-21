import { Sidebar } from "../features/shell/Sidebar.tsx";
// EPIC-P43 T43.3: das Dock hat vier Ziele und eine Haupttaste — Start, Suchen, ＋, Teams, Mehr.
// Alles Übrige (Medien, Notizen, Automationen, Einstellungen, Provider-Status) liegt einen
// Tipp weiter im Blatt „Mehr“; am PC (Leiste links, 21-icon-rail.css) stehen diese Ziele weiterhin
// einzeln in der Leiste, dort gibt es kein „Mehr“. „approvals“ wird aus der Übersicht erreicht,
// „Entdeckt“ ist seit EPIC-P47 ein Umschalt-State der Übersicht (kein eigener Menüpunkt mehr).
// `active` hebt nie etwas hervor, solange eine Seite offen ist, die kein Dock-Ziel ist.
import { useEffect, useRef, useState } from "preact/hooks";
import { Sheet } from "../shared/ui/index.ts";
import { TabIcon, type TabIconName } from "../shared/TabIcon.tsx";
import { openCommandBar } from "../features/commands/CommandBar.tsx";
import { openLayer } from "../shared/layers.ts";
import { ariaCombo, comboLabel, registerShortcut } from "../shared/shortcuts/registry.ts";
import { t } from "../shared/i18n/index.ts";
export type { ListPage as Page } from "./route.ts";
import type { ListPage as Page } from "./route.ts";

const MORE: readonly { page: Page; icon: TabIconName; label: string; title: string }[] = [
  { page: "media", icon: "medien", label: t("dock.media"), title: t("dock.mediaTitle") },
  { page: "vault", icon: "notizen", label: t("dock.vault"), title: t("dock.vaultTitle") },
  { page: "automationen", icon: "automationen", label: t("dock.automations"), title: t("dock.automationsTitle") },
  { page: "settings", icon: "einstellungen", label: t("dock.settings"), title: t("dock.settingsTitle") },
  { page: "aimetrics", icon: "bericht", label: t("dock.aimetrics"), title: t("dock.aimetricsTitle") },
  { page: "inference", icon: "bericht", label: t("inference.dock"), title: t("inference.dockTitle") },
  { page: "statistics", icon: "bericht", label: t("dock.statistics"), title: t("dock.statisticsTitle") },
  { page: "terminal", icon: "terminal", label: t("dock.terminal"), title: t("dock.terminalTitle") },
  { page: "releasenotes", icon: "verlauf", label: t("dock.releasenotes"), title: t("dock.releasenotesTitle") },
];

/**
 * Die eine globale Navigation. Am Handy und Tablet eine Reihe unten, am PC die Leiste links.
 */
export function GlobalDock({ active, onNavigate }: { active: Page | null; onNavigate: (page: Page) => void }) {
  const [desktop, setDesktop] = useState(() => matchMedia("(min-width: 700px)").matches);
  useEffect(() => {
    const mq = matchMedia("(min-width: 700px)");
    const sync = () => setDesktop(mq.matches);
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  const [more, setMore] = useState(false);
  useEffect(() => {
    if (!more) return;
    // EPIC-P51 T51.5: Esc über die Shortcut-Registry.
    return registerShortcut("dock.more-close", (e) => {
      e.preventDefault();
      setMore(false);
    });
  }, [more]);
  const go = (page: Page) => {
    setMore(false);
    onNavigate(page);
  };
  const inMore = MORE.some((m) => m.page === active) || active === "status";
  // EPIC-P51 T51.6: Roving-Navigation — Pfeiltasten bewegen den Fokus durchs
  // Dock (PC: Leiste links ↑/↓, Handy: Leiste unten ←/→; beide Achsen wirken).
  const dockRef = useRef<HTMLElement>(null);
  const onDockKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const items = [...(dockRef.current?.querySelectorAll<HTMLButtonElement>("button.dock-item:not([disabled])") ?? [])];
    const idx = items.indexOf(document.activeElement as HTMLButtonElement);
    if (idx === -1) return;
    const forward = e.key === "ArrowDown" || e.key === "ArrowRight";
    const next = items[(idx + (forward ? 1 : items.length - 1)) % items.length];
    e.preventDefault();
    next.focus();
  };
  if (desktop) return <Sidebar active={active} onNavigate={onNavigate} />;
  return (
    <nav class="dock" aria-label={t("dock.nav")} ref={dockRef} onKeyDown={onDockKey}>
      <button class={`dock-item ${active === "dashboard" ? "active" : ""}`} type="button" title={t("dock.start")} onClick={() => go("dashboard")}>
        <TabIcon name="uebersicht" /><span class="lb">{t("dock.start")}</span>
      </button>
      <button class="dock-item" type="button" title={t("dock.searchTitle", { combo: comboLabel("command.toggle") })} aria-keyshortcuts={ariaCombo("command.toggle")} data-shortcut="command.toggle" onClick={() => { setMore(false); openCommandBar(); }}>
        <TabIcon name="suche" /><span class="lb">{t("dock.search")}</span>
      </button>
      <button class={`dock-item dock-main ${active === "new" ? "active" : ""}`} type="button" title={t("dock.newSession")} aria-label={t("dock.newSession")} onClick={() => go("new")}>
        <TabIcon name="neu" />
      </button>
      <button class={`dock-item ${active === "teams" ? "active" : ""}`} type="button" title={t("dock.teams")} onClick={() => go("teams")}>
        <TabIcon name="teams" /><span class="lb">Teams</span>
      </button>
      <button class={`dock-item dock-more ${inMore ? "active" : ""}`} type="button" title={t("dock.more")} aria-haspopup="dialog" aria-expanded={more} onClick={() => setMore((on) => !on)}>
        <TabIcon name="mehr" /><span class="lb">{t("dock.more")}</span>
      </button>
      {MORE.map((m) => (
        <button key={m.page} class={`dock-item dock-extra ${active === m.page ? "active" : ""}`} type="button" title={m.title} onClick={() => go(m.page)}>
          <TabIcon name={m.icon} /><span class="lb">{m.label}</span>
        </button>
      ))}
      <button class="dock-item dock-extra" type="button" title={t("dock.filetreeTitle", { combo: comboLabel("files.toggle") })} aria-keyshortcuts={ariaCombo("files.toggle")} data-shortcut="files.toggle" onClick={() => openLayer("files")}>
        <TabIcon name="baum" /><span class="lb">{t("dock.filetree")}</span>
      </button>
      {more && (
        <Sheet open onClose={() => setMore(false)} label={t("dock.more")} class="more-sheet">
            {MORE.map((m) => (
              <button key={m.page} class={`more-item ${active === m.page ? "active" : ""}`} type="button" onClick={() => go(m.page)}>
                <TabIcon name={m.icon} />
                <span>{m.label}</span>
              </button>
            ))}
            <button class={`more-item ${active === "status" ? "active" : ""}`} type="button" onClick={() => go("status")}>
              <TabIcon name="bericht" />
              <span>{t("dock.providerStatus")}</span>
            </button>
            {/* Ohne offene Session: Dateibaum über alle Projekte (früher die Randlasche „Dateien“). */}
            <button class="more-item" type="button" onClick={() => { setMore(false); openLayer("files"); }}>
              <TabIcon name="baum" />
              <span>{t("dock.filetree")}</span>
            </button>
        </Sheet>
      )}
    </nav>
  );
}
