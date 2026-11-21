import { useEffect, useState } from "preact/hooks";
import { loadSidebar, saveSidebar, SIDEBAR_ENTRIES, SIDEBAR_EVENT, SIDEBAR_KEY } from "../shell/sidebar.ts";
import { Button } from "../../shared/ui/index.ts";
import { SettingRow, SettingsSection, Switch } from "./parts.tsx";

export function SidebarSettings() {
  const [prefs, setPrefs] = useState(loadSidebar);
  useEffect(() => {
    const sync = () => setPrefs(loadSidebar());
    const storage = (e: StorageEvent) => { if (e.key === SIDEBAR_KEY || e.key === null) sync(); };
    window.addEventListener(SIDEBAR_EVENT, sync);
    window.addEventListener("storage", storage);
    return () => { window.removeEventListener(SIDEBAR_EVENT, sync); window.removeEventListener("storage", storage); };
  }, []);
  const move = (index: number, by: number) => {
    const order = [...prefs.order];
    [order[index], order[index + by]] = [order[index + by]!, order[index]!];
    saveSidebar({ ...prefs, order });
  };
  return <SettingsSection title="Sidebar" testid="sidebar-settings">
    <p class="dim">Reihenfolge und Sichtbarkeit auf PC und Tablet. Die Sidebar bleibt über ihre eigene Taste erreichbar.</p>
    {prefs.order.map((id, i) => {
      const entry = SIDEBAR_ENTRIES.find((e) => e.id === id)!;
      return <SettingRow key={id} label={entry.label}>
        <Button aria-label={`${entry.label} nach oben`} title={`${entry.label} nach oben`} disabled={i === 0} onClick={() => move(i, -1)}>↑</Button>
        <Button aria-label={`${entry.label} nach unten`} title={`${entry.label} nach unten`} disabled={i === prefs.order.length - 1} onClick={() => move(i, 1)}>↓</Button>
        <Switch label={`${entry.label} anzeigen`} checked={!prefs.hidden.includes(id)} onChange={(show) => saveSidebar({ ...prefs, hidden: show ? prefs.hidden.filter((x) => x !== id) : [...prefs.hidden, id] })} />
      </SettingRow>;
    })}
    <Button onClick={() => saveSidebar({ order: SIDEBAR_ENTRIES.map((e) => e.id), hidden: [], minimized: false })}>Sidebar zurücksetzen</Button>
  </SettingsSection>;
}
