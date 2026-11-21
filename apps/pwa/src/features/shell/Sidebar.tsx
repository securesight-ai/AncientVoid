import { t } from "../../shared/i18n/index.ts";
import { useEffect, useState } from "preact/hooks";
import type { ListPage } from "../../app/route.ts";
import { TabIcon } from "../../shared/TabIcon.tsx";
import { openCommandBar } from "../commands/CommandBar.tsx";
import { openLayer } from "../../shared/layers.ts";
import { loadSidebar, saveSidebar, SIDEBAR_ENTRIES, SIDEBAR_EVENT, SIDEBAR_KEY } from "./sidebar.ts";

export function Sidebar({ active, onNavigate }: { active: ListPage | null; onNavigate: (page: ListPage) => void }) {
  const [prefs, setPrefs] = useState(loadSidebar);
  useEffect(() => {
    const sync = () => setPrefs(loadSidebar());
    const storage = (e: StorageEvent) => { if (e.key === SIDEBAR_KEY || e.key === null) sync(); };
    window.addEventListener(SIDEBAR_EVENT, sync);
    window.addEventListener("storage", storage);
    return () => { window.removeEventListener(SIDEBAR_EVENT, sync); window.removeEventListener("storage", storage); };
  }, []);
  return <nav class={`dock sidebar${prefs.minimized ? " minimized" : ""}`} aria-label={t("shell.sidebar")} onKeyDown={(e) => {
    if (!["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft"].includes(e.key)) return;
    const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>(".dock-item")].filter((button) => button.offsetParent !== null);
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    e.preventDefault();
    buttons[(at + (e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : buttons.length - 1)) % buttons.length]?.focus();
  }}>
    <button type="button" class="dock-item" aria-label={prefs.minimized ? t("shell.sidebar_expand") : t("shell.sidebar_minimize")} aria-expanded={!prefs.minimized} onClick={() => saveSidebar({ ...prefs, minimized: !prefs.minimized })}>☰</button>
    <div class="sidebar-entries" hidden={prefs.minimized}>
      {prefs.order.filter((id) => !prefs.hidden.includes(id)).map((id) => {
        const entry = SIDEBAR_ENTRIES.find((e) => e.id === id)!;
        return <button key={id} type="button" class={`dock-item${active === entry.page ? " active" : ""}`} title={entry.label} aria-label={id === "new" ? t("common.new_session") : entry.label} data-sidebar-id={id} onClick={() => entry.page ? onNavigate(entry.page) : id === "search" ? openCommandBar() : openLayer("files")}>
          <TabIcon name={entry.icon} /><span class="lb">{entry.label}</span>
        </button>;
      })}
    </div>
    {/* Recovery stays outside the configurable entries, even if every entry is hidden. */}
    <button type="button" class="dock-item" aria-label={t("shell.sidebar_configure")} title={t("shell.sidebar_configure")} onClick={() => onNavigate("settings")}><TabIcon name="einstellungen" /></button>
  </nav>;
}
