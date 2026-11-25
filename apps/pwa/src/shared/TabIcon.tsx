/** Schlichte Strich-Icons (24er Raster) für die Icon-Leiste; die Beschriftung bleibt im DOM (sr-only), damit Rollen-Namen stabil sind. */
const PATHS = {
  chat: "M4 5h16v10H9l-5 4z",
  verlauf: "M4 6h16M4 12h16M4 18h10",
  bericht: "M5 20V10M12 20V4M19 20v-7",
  diff: "M8 4v16M4 8h8M14 16h6M17 4l-3 3 3 3M17 20l3-3-3-3",
  suche: "M10.5 17a6.5 6.5 0 1 1 0-13 6.5 6.5 0 0 1 0 13zM15.5 15.5 20 20",
  scan: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8.5v7M8.5 12h7",
  code: "M9 7l-5 5 5 5M15 7l5 5-5 5",
  umgebung: "M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10",
  uebersicht: "M4 5h7v7H4zM13 5h7v4h-7zM13 11h7v8h-7zM4 14h7v5H4z",
  neu: "M12 5v14M5 12h14",
  entdeckt: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM15.5 8.5l-2 5-5 2 2-5z",
  medien: "M4 6h16v12H4zM10 9.5v5l4.5-2.5z",
  einstellungen: "M4 7h10M18 7h2M4 17h2M10 17h10M16 4v6M8 14v6",
  forge: "M7 4v10M7 14a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM17 10a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zm0 0v1c0 3-2 4-5 4H9",
  graph: "M5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM12 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM19 17a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6.5 15.5L10.5 10M14 8.5l3.5 5M7 19h10",
  git: "M6 4v16M6 8h6l4 4v8M10 12h4",
  datei: "M6 3h8l4 4v14H6zM14 3v4h4",
  teams: "M12 3v4M5 21l3-4h8l3 4M4 8h16v6H4z",
  automationen: "M12 3v5M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM12 12l3.5-2M7 12h1M16 12h1M12 16h.01",
  notizen: "M7 3h10v14l-3.5 4L10 17H7zM10 8h5M10 12h5",
  mehr: "M5 12h.01M12 12h.01M19 12h.01",
  baum: "M4 4h6v4H4zM14 10h6v4h-6zM14 17h6v4h-6zM7 8v11h7M7 12h7",
  browser: "M3 5h18v14H3zM3 9h18M6 7h.01M9 7h.01",
  geraete: "M8 3h8v18H8zM11 18h2",
  terminal: "M4 5h16v14H4zM7 9l3 3-3 3M12 15h5",
} as const;

export type TabIconName = keyof typeof PATHS;

export function TabIcon({ name }: { name: TabIconName }) {
  return (
    <svg class="tab-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
