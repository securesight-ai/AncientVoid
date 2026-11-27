import type { ListPage } from "../../app/route.ts";
import type { TabIconName } from "../../shared/TabIcon.tsx";

export const SIDEBAR_ENTRIES: readonly { id: string; label: string; icon: TabIconName; page?: ListPage; action?: "toggle-depth3d" }[] = [
  { id: "dashboard", label: "Start", icon: "uebersicht", page: "dashboard" },
  { id: "search", label: "Suchen", icon: "suche" },
  { id: "projects", label: "Projektansicht", icon: "baum" },
  { id: "new", label: "Session", icon: "neu", page: "new" },
  { id: "swarms", label: "Swarms", icon: "teams", page: "swarms" },
  { id: "media", label: "Medien", icon: "medien", page: "media" },
  { id: "vault", label: "Notizen", icon: "notizen", page: "vault" },
  { id: "automationen", label: "Automationen", icon: "automationen", page: "automationen" },
  { id: "settings", label: "Einstellungen", icon: "einstellungen", page: "settings" },
  { id: "depth3d", label: "3D an/aus", icon: "tiefe", action: "toggle-depth3d" },
  { id: "statistics", label: "Statistik", icon: "bericht", page: "statistics" },
  { id: "terminal", label: "Terminal", icon: "terminal", page: "terminal" },
  { id: "releasenotes", label: "Release-Notes", icon: "verlauf", page: "releasenotes" },
  { id: "pentest", label: "Pentest", icon: "scan", page: "pentest" },
];
export interface SidebarPreferences { order: string[]; hidden: string[]; minimized: boolean }
export const SIDEBAR_KEY = "ancientvoid.sidebar.v1";
export const SIDEBAR_EVENT = "ancientvoid:sidebar";

/** Like custom-rag's ordneSidebar: saved known IDs first, new entries appended. */
export function parseSidebar(raw: string | null): SidebarPreferences {
  let data: Partial<SidebarPreferences> = {};
  try { data = JSON.parse(raw ?? "{}") ?? {}; } catch { /* Use the catalog defaults. */ }
  const known = SIDEBAR_ENTRIES.map((e) => e.id);
  const ids = (value: unknown) => Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string" && known.includes(id)))] : [];
  return { order: [...new Set([...ids(data.order), ...known])], hidden: ids(data.hidden), minimized: data.minimized === true };
}
export const loadSidebar = () => parseSidebar(localStorage.getItem(SIDEBAR_KEY));
export function saveSidebar(value: SidebarPreferences): void {
  localStorage.setItem(SIDEBAR_KEY, JSON.stringify(value));
  window.dispatchEvent(new Event(SIDEBAR_EVENT));
}
