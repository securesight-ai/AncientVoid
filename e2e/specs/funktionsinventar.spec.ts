import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { test, expect, cardAction } from "../support/fixtures.ts";
import { repoRoot, type TestHub } from "../support/hub.ts";

/**
 * EPIC-P43 T43.0 (AC-P43-1, Leitplanke E10): das Funktionsinventar als Gate.
 * Jede Zeile aus docs/funktionsinventar.md mit Nachweis „inventar“ hat hier
 * einen Eintrag, der die Funktion über ihren dokumentierten Weg erreicht —
 * am Handy, am Tablet und am PC. Ein Umbau ändert Weg und Eintrag im selben
 * Commit; ein Eintrag entfällt nur mit dokumentierter Nutzerentscheidung.
 *
 * Ein Eintrag ist ein `test.step` (sein Name trägt die ID); je Bereich und
 * Formfaktor läuft ein Test mit eigenem Hub, sonst kostete das Inventar das
 * Gate rund 200 Hub-Starts.
 */
type Form = "mobile" | "tablet" | "desktop";

interface Ctx {
  page: Page;
  hub: TestHub;
  form: Form;
  /** PC: Liste + Kacheln (ab 1280 px). */
  wide: boolean;
  sessionId: string;
  /** Die Session-Ansicht — am PC die erste Kachel. */
  s: Locator;
  /** Ein Tipp/Klick des dokumentierten Wegs; wird gegen die Obergrenze gezählt. */
  tap: (target: Locator) => Promise<void>;
}

interface Entry {
  id: string;
  name: string;
  /** Ohne Angabe: alle drei Formfaktoren. */
  forms?: readonly Form[];
  /** Ausgangspunkt: Start oder die geöffnete Session (Epic §3.1). Ein eigener Hash ist ein Deeplink. */
  from: "start" | "session" | `#/${string}`;
  /** Obergrenze der Interaktionen; Standard 3 (Epic §3.1). */
  max?: number;
  reach: (c: Ctx) => Promise<void>;
}

const PC: readonly Form[] = ["desktop"];
const TOUCH: readonly Form[] = ["mobile", "tablet"];

const dock = (c: Ctx, name: string) => c.page.locator(".dock").getByRole("button", { name, exact: true });
/** EPIC-P43 T43.3: Ziele, die am Handy/Tablet unter „Mehr“ liegen; am PC stehen sie einzeln in der Leiste. */
const nav = async (c: Ctx, name: string) => {
  if (!(await dock(c, name).isVisible())) await c.tap(dock(c, "Mehr"));
  await c.tap(dock(c, name));
};
/** EPIC-P43 T43.4: Chat, Änderungen, Befehle sind Reiter (Änderungen trägt eine Zahl); der Rest liegt unter „Mehr“. */
const tab = (c: Ctx, name: string) => c.s.locator(".subtabs-wrap").getByRole("button", { name: new RegExp(`^${name}`) });
const more = async (c: Ctx, name: string) => {
  await c.tap(c.s.locator('.subtabs-wrap [aria-haspopup="menu"]'));
  await c.tap(c.s.getByRole("menu", { name: "Weitere Ansichten" }).getByRole("menuitem", { name, exact: true }));
};
const menu = (c: Ctx) => c.s.locator(".session-menu summary");
/** dabe85d5: Ab 700 px öffnen ✦/Strg+K/Dock-Suche die Suchkarte statt des Dialogs;
 * unter 700 px (Handy) bleibt der Dialog. */
const auftragOderSuchkarte = (c: Ctx) => c.page.getByRole("dialog", { name: "Auftrag in Worten" }).or(c.page.locator(".command-card"));
/** dabe85d5: Ab 700 px öffnen Session-Ansichten eigene Karten — die fokussierte Karte ist das Ziel. */
const card = (c: Ctx) => c.page.locator(".tile.focused");
/** EPIC-P43 T43.5 (Regel 3): Kartenaktion — mit Maus beim Überfahren, auf Touch über das Menü „⋯“. */
const cardDo = async (c: Ctx, card: Locator, name: string) => {
  const inline = card.locator(".session-card-actions").getByRole("button", { name, exact: true });
  if (await inline.isVisible()) {
    await card.hover();
    return c.tap(inline);
  }
  await c.tap(card.locator(".row-menu-btn"));
  await c.tap(card.getByRole("menu").getByRole("menuitem", { name, exact: true }));
};
const settingsGroup = (name: string): Entry["reach"] => async (c) => {
  await nav(c, "Einstellungen");
  await expect(c.page.getByRole("heading", { name, exact: true }).first()).toBeVisible();
};
/** Composer sichtbar machen: in einer Kachel kann die Steuerung eingeklappt sein. */
const controls = async (c: Ctx) => {
  const show = c.s.getByRole("button", { name: "Steuerung einblenden" });
  if (await show.count()) await c.tap(show);
};

const GLOBAL: Entry[] = [
  { id: "G01", name: "Start", from: "#/neu", reach: async (c) => { await c.tap(dock(c, "Start")); await expect(c.page.locator(".dashboard")).toBeVisible(); } },
  { id: "G02", name: "Neue Session", from: "start", reach: async (c) => { await c.tap(dock(c, "Neue Session")); await expect(c.page.getByRole("button", { name: "Starten" })).toBeVisible(); } },
  { id: "G03", name: "Entdeckt", from: "start", reach: async (c) => { await c.tap(c.page.locator(".overview-switch").getByRole("tab", { name: "Gefunden", exact: true })); await expect(c.page.locator(".discovery")).toBeVisible(); } },
  { id: "G04", name: "Entdeckt über den Chip „Gefunden“", from: "start", reach: async (c) => { await c.tap(c.page.locator(".dashboard-summary").getByRole("button", { name: "Gefunden" })); await expect(c.page.locator(".discovery")).toBeVisible(); } },
  { id: "G05", name: "Medien", from: "start", reach: async (c) => { await nav(c, "Medien"); await expect(c.page.locator(".media-caps")).toBeVisible(); } },
  { id: "G06", name: "Teams", from: "start", reach: async (c) => { await c.tap(dock(c, "Teams")); await expect(c.page.getByTestId("teams-pane").first()).toBeVisible(); } },
  { id: "G07", name: "Notizen", from: "start", reach: async (c) => { await nav(c, "Notizen"); await expect(c.page).toHaveURL(/#\/notizen$/); await expect(c.page.locator(".vault-pane, .vault-picker, .files-error, .empty").first()).toBeVisible({ timeout: 20_000 }); } },
  { id: "G08", name: "Automationen", from: "start", reach: async (c) => { await nav(c, "Automationen"); await expect(c.page.getByTestId("automations-pane")).toBeVisible(); } },
  { id: "G09", name: "Einstellungen: Darstellung (Erscheinungsbild, Akzent, Größe)", from: "start", reach: settingsGroup("Darstellung") },
  { id: "G10", name: "Einstellungen: Schrift", from: "start", reach: settingsGroup("Schrift") },
  { id: "G11", name: "Einstellungen: Vorschau", from: "start", reach: settingsGroup("Vorschau") },
  { id: "G12", name: "Einstellungen: Benachrichtigungen", from: "start", reach: settingsGroup("Benachrichtigungen") },
  { id: "G13", name: "Einstellungen: Geräte", from: "start", reach: settingsGroup("Geräte") },
  { id: "G14", name: "Einstellungen: Flotte", from: "start", reach: settingsGroup("Flotte") },
  { id: "G15", name: "Einstellungen: Dienste", from: "start", reach: settingsGroup("Dienste") },
  { id: "G16", name: "Einstellungen: Sicherheit & Verbindung", from: "start", reach: settingsGroup("Sicherheit & Verbindung") },
  {
    id: "G17",
    name: "Helles Erscheinungsbild",
    from: "start",
    reach: async (c) => {
      await nav(c, "Einstellungen");
      await c.tap(c.page.locator(".segmented").getByRole("button", { name: "Hell" }));
      await expect(c.page.locator("html")).toHaveAttribute("data-theme", "light");
     
    },
  },
  { id: "G18", name: "PC-Eingabe (Am PC eintippen)", from: "start", reach: async (c) => { await nav(c, "Einstellungen"); await c.tap(c.page.locator("[data-testid=pc-input] summary")); await expect(c.page.locator("[data-testid=pc-input]").locator(".desktop-page, [data-testid=desktop-setup], .desktop-head").first()).toBeVisible(); } },
  { id: "G19", name: "Freigaben-Seite (Deeplink)", from: "#/freigaben", reach: async (c) => { await expect(c.page.locator(".approval-queue, .approvals-pane, .empty, .ui-empty").first()).toBeVisible(); await expect(c.page).toHaveURL(/#\/freigaben$/); } },
  { id: "G20", name: "Provider-Status", from: "start", reach: async (c) => { await c.tap(c.page.locator(".topbar").getByRole("button", { name: "Status" })); await expect(c.page.locator(".status-page")).toBeVisible(); } },
  { id: "G59", name: "Provider-Status über „Mehr“", forms: TOUCH, from: "start", reach: async (c) => { if (c.wide) await c.tap(c.page.locator(".topbar").getByRole("button", { name: "Status" })); else { await c.tap(dock(c, "Mehr")); await c.tap(dock(c, "Provider-Status")); } await expect(c.page.locator(".status-page")).toBeVisible(); } },
  { id: "G60", name: "Suchen im Dock", from: "start", reach: async (c) => { await c.tap(dock(c, "Suchen")); await expect(auftragOderSuchkarte(c)).toBeVisible(); } },
  { id: "G21", name: "Benachrichtigungen (Glocke)", from: "start", reach: async (c) => { await c.tap(c.page.getByRole("button", { name: /^Benachrichtigungen/ }).first()); await expect(c.page.getByRole("dialog", { name: "Benachrichtigungen" })).toBeVisible(); } },
  { id: "G22", name: "Auftrag in Worten (Taste)", from: "start", reach: async (c) => { await c.tap(c.page.getByRole("button", { name: "Auftrag in Worten (Strg+K)" })); await expect(auftragOderSuchkarte(c)).toBeVisible(); } },
  { id: "G23", name: "Auftrag in Worten (Strg+K)", forms: PC, from: "start", reach: async (c) => { await c.page.keyboard.press("Control+k"); await expect(auftragOderSuchkarte(c)).toBeVisible(); } },
  { id: "G24", name: "Umschalter Projekte", from: "start", reach: async (c) => { await c.tap(c.page.getByRole("tab", { name: "Projekte" })); await expect(c.page.locator(".project-card").first()).toBeVisible(); } },
  { id: "G25", name: "Umschalter Hosts", from: "start", reach: async (c) => { await c.tap(c.page.getByRole("tab", { name: "Hosts" })); await expect(c.page.locator(".host-card").first()).toBeVisible(); } },
  { id: "G26", name: "Archiv", from: "start", reach: async (c) => { await c.tap(c.page.locator(".dashboard-summary").getByRole("button", { name: /^Archiv/ })); await expect(c.page.locator(".dashboard-summary").getByRole("button", { name: "Aktive" })).toBeVisible(); } },
  { id: "G27", name: "Sessions filtern", from: "start", reach: async (c) => { await c.page.getByLabel("Sessions filtern").fill("Inventar"); await expect(c.page.locator(".session-card")).toHaveCount(1); } },
  { id: "G28", name: "Session öffnen", from: "start", reach: async (c) => { await c.tap(c.page.locator(".session-card").filter({ hasText: "Inventar-Aufgabe" }).locator(".session-open")); await expect(c.page.locator(".session-top-title").first()).toHaveText("Inventar-Aufgabe"); } },
  { id: "G29", name: "Karte: Repo-Graph", from: "start", reach: async (c) => { await cardDo(c, c.page.locator(".session-card").filter({ hasText: "Inventar-Aufgabe" }), "Repo-Graph"); await expect(c.page.locator(".graph-pane").first()).toBeVisible(); } },
  {
    id: "G30",
    name: "Karte: Anheften und Lösen",
    from: "start",
    reach: async (c) => {
      const card = c.page.locator(".session-card").filter({ hasText: "Füllsession 1" });
      await cardDo(c, card, "Anheften");
      await expect(c.page.getByRole("region", { name: "Angeheftet" })).toContainText("Füllsession 1");
      await cardAction(card, "Lösen");
      await expect(c.page.getByRole("region", { name: "Angeheftet" })).toHaveCount(0);
    },
  },
  {
    id: "G31",
    name: "Karte: Archivieren, Zurückholen, Löschen im Archiv",
    from: "start",
    reach: async (c) => {
      const card = c.page.locator(".session-card").filter({ hasText: "Füllsession 2" });
      await cardDo(c, card, "Archivieren");
      await expect(card).toHaveCount(0);
      await c.tap(c.page.locator(".dashboard-summary").getByRole("button", { name: /^Archiv/ }));
      await card.locator(".row-menu-btn").click();
      await expect(card.getByRole("menuitem", { name: "Löschen" })).toBeVisible();
      await card.locator(".row-menu-btn").click();
      await cardDo(c, card, "Zurückholen");
      await expect(card).toHaveCount(0);
    },
    // Drei Funktionen in einem Eintrag; auf Touch je zwei Tipps über „⋯“.
    max: 5,
  },
  { id: "G32", name: "Verbindungsanzeige", from: "start", reach: async (c) => { await expect(c.page.locator(".topbar .conn-dot.live").first()).toBeVisible(); } },
  { id: "G33", name: "Marke führt zur Übersicht", from: "#/neu", reach: async (c) => { await c.tap(c.page.locator(".brand-link").first()); await expect(c.page.locator(".dashboard")).toBeVisible(); } },
  { id: "G58", name: "Neue Session: Skill oder Agent wählen", from: "#/neu", reach: async (c) => { await c.page.getByLabel("Adapter").selectOption("opencode"); await expect(c.page.getByRole("button", { name: "+ Skill/Agent" })).toBeVisible(); } },
];

const SESSION: Entry[] = [
  { id: "S01", name: "Reiter Chat", from: "session", reach: async (c) => { await c.tap(tab(c, "Chat")); await expect(c.s.locator(".tail-scroll").getByText(/Antwort auf: Inventar-Aufgabe/)).toBeVisible(); } },
  { id: "S02", name: "Mehr: Verlauf mit Überwachen/Debuggen", from: "session", reach: async (c) => { await more(c, "Verlauf"); await controls(c); await c.tap(c.s.locator(".dock-filter-bar").getByRole("button", { name: "Debuggen" })); await expect(c.s.locator(".dock-filter-bar .chip.active")).toHaveText("Debuggen"); }, max: 5 },
  { id: "S03", name: "Mehr: Bericht", from: "session", reach: async (c) => { await more(c, "Bericht"); await expect(card(c).locator(".kv-list").first()).toContainText("Dauer"); } },
  {
    id: "S04",
    name: "Reiter Änderungen (Diff und Bericht) — ohne Änderungen unter „Mehr“",
    from: "session",
    reach: async (c) => {
      // Ohne Änderungen rückt der Reiter unter „Mehr“, sobald der Diff geladen ist (Kleinkram-Regel 2) — erst die Leiste ruhig werden lassen.
      const changes = tab(c, "Änderungen");
      let last = -1;
      await expect.poll(async () => { const n = await changes.count(); const calm = n === last; last = n; return calm; }, { intervals: [600] }).toBe(true);
      if (last > 0) await c.tap(changes);
      else await more(c, "Änderungen");
      await expect(card(c).locator("[data-testid=diff-review], .ui-empty").first()).toBeVisible();
    },
  },
  { id: "S05", name: "Mehr: Graph", from: "session", reach: async (c) => { await more(c, "Graph"); await expect(card(c).locator(".graph-pane")).toBeVisible(); } },
  { id: "S06", name: "Mehr: Datei", from: "session", reach: async (c) => { await more(c, "Datei"); await expect(card(c).locator(".code-pane")).toBeVisible(); } },
  { id: "S07", name: "Mehr: GitLab", from: "session", reach: async (c) => { await more(c, "GitLab"); await expect(card(c).locator(".forge-panel")).toBeVisible(); } },
  { id: "S08", name: "Mehr: Suche", from: "session", reach: async (c) => { await more(c, "Suche"); await expect(card(c).locator(".search-pane")).toBeVisible(); } },
  { id: "S09", name: "Reiter Befehle (Code)", from: "session", reach: async (c) => { await c.tap(tab(c, "Befehle")); await expect(card(c).locator(".code-pane")).toBeVisible(); } },
  { id: "S10", name: "Mehr: Umgebung", from: "session", reach: async (c) => { await more(c, "Umgebung"); await expect(card(c).getByText(/ancientvoid\.workspace\.json|Umgebung/).first()).toBeVisible(); } },
  { id: "S11", name: "Zurück zur Übersicht", forms: TOUCH, from: "session", reach: async (c) => { if (c.wide) await c.tap(dock(c, "Start")); else await c.tap(c.s.getByRole("button", { name: "Zur Übersicht" })); await expect(c.page.locator(".dashboard")).toBeVisible(); } },
  { id: "S12", name: "Stop", from: "session", reach: async (c) => { await expect(c.s.locator(".stop-btn")).toBeVisible(); } },
  { id: "S13", name: "Menü: Umbenennen", from: "session", reach: async (c) => { await c.tap(menu(c)); await c.tap(c.s.locator(".session-menu-items").getByRole("button", { name: "Umbenennen" })); await expect(c.s.getByLabel("Neuer Titel")).toBeVisible(); } },
  { id: "S14", name: "Menü: Anheften", from: "session", reach: async (c) => { await c.tap(menu(c)); await expect(c.s.locator(".session-menu-items").getByRole("button", { name: "Anheften" })).toBeVisible(); } },
  { id: "S15", name: "Menü: Archivieren", from: "session", reach: async (c) => { await c.tap(menu(c)); await expect(c.s.locator(".session-menu-items").getByRole("button", { name: "Archivieren" })).toBeVisible(); } },
  { id: "S16", name: "Menü: Löschen", from: "session", reach: async (c) => { await c.tap(menu(c)); await expect(c.s.locator(".session-menu-items").getByRole("button", { name: "Löschen" })).toBeVisible(); } },
  { id: "S19", name: "Kopf: Projekt, Adapter, Modell, Host, Zustand, Arbeitsort", from: "session", reach: async (c) => { await expect(c.s.locator(".session-top-meta")).toContainText("claude"); await expect(c.s.locator(".session-top-meta .status")).toHaveAttribute("data-status", /.+/); await expect(c.s.locator(".workplace-badge")).toBeVisible(); await expect(c.s.locator(".session-topbar .conn-dot")).toBeVisible(); } },
  // EPIC-P43 T43.4: die Statuszeile zeigt nur Gemessenes; Kontextfenster und Kontingent stehen immer im Bericht.
  { id: "S20", name: "Statuszeile: Tokens, Kontext; Kontingent und Fenster im Bericht", from: "session", reach: async (c) => { await expect(c.s.locator(".status-line .run-tokens")).toContainText("Tokens"); await more(c, "Bericht"); await expect(card(c).locator(".kv-list").first()).toContainText("Kontingent"); await expect(card(c).locator(".kv-list").first()).toContainText("Kontextfenster"); } },
  { id: "S21", name: "Composer: Antworten und Senden", from: "session", reach: async (c) => { await c.tap(tab(c, "Chat")); await controls(c); await c.s.getByPlaceholder("Antworten…").fill("Inventar-Entwurf"); await expect(c.s.getByRole("button", { name: "Senden" })).toBeEnabled(); await c.s.getByPlaceholder("Antworten…").fill(""); } },
  { id: "S22", name: "Composer: Anhang", from: "session", reach: async (c) => { await c.tap(tab(c, "Chat")); await controls(c); await expect(c.s.locator(".attach-btn")).toBeVisible(); await expect(c.s.getByLabel("Dateien anhängen")).toBeAttached(); } },
  { id: "S23", name: "Composer: Eingabe maximieren", from: "session", reach: async (c) => { await c.tap(tab(c, "Chat")); await controls(c); await c.tap(c.s.getByRole("button", { name: "Eingabe maximieren" })); await expect(c.s.getByRole("button", { name: "Eingabe verkleinern" })).toBeVisible(); } },
  { id: "S24", name: "Nyx-FAB: Spracheingabe", from: "session", reach: async (c) => { await c.tap(tab(c, "Chat")); await expect(c.page.locator('[data-testid=nyx-fab]')).toBeVisible(); } },
  { id: "S25", name: "Composer: Verbessern", from: "session", reach: async (c) => { await c.tap(tab(c, "Chat")); await controls(c); await c.tap(c.s.getByPlaceholder("Antworten…")); await expect(c.s.getByRole("button", { name: "Verbessern" })).toBeVisible(); } },
  { id: "S26", name: "Composer: Slash-Commands", from: "session", reach: async (c) => { await c.tap(tab(c, "Chat")); await controls(c); await c.s.getByPlaceholder("Antworten…").fill("/"); await expect(c.s.getByRole("listbox", { name: "Commands" })).toBeVisible(); await c.s.getByPlaceholder("Antworten…").fill(""); } },
  { id: "S28", name: "Modus und Modell", from: "session", reach: async (c) => { await c.tap(tab(c, "Chat")); await controls(c); await expect(c.s.locator(".session-configure")).toBeVisible(); } },
  { id: "S30", name: "Steuerung ein- und ausblenden", from: "session", reach: async (c) => { await c.tap(tab(c, "Chat")); await controls(c); await c.tap(c.s.getByRole("button", { name: "Steuerung ausblenden" })); await expect(c.s.getByRole("button", { name: "Steuerung einblenden" })).toBeVisible(); } },
  { id: "S31", name: "Kopieren je Ereignis", from: "session", reach: async (c) => { await c.tap(tab(c, "Chat")); await expect(c.s.locator(".tail-scroll").getByRole("button", { name: "Kopieren" }).first()).toBeAttached(); } },
  { id: "S32", name: "Dateibaum (Reiter Befehle)", from: "session", reach: async (c) => { await c.tap(tab(c, "Befehle")); await c.tap(card(c).getByRole("button", { name: "Dateibaum öffnen" })); await expect(c.page.getByTestId("files-sidebar")).toBeVisible(); } },
  { id: "S33", name: "Browser-Arbeitsplatz (Mehr)", from: "session", reach: async (c) => { await more(c, "Browser"); await expect(c.page.getByTestId("browser-panel")).toBeVisible(); } },
  { id: "S34", name: "Graph in eigenes Fenster", forms: PC, from: "session", reach: async (c) => { await more(c, "Graph"); await expect(card(c).getByRole("button", { name: "Graph in eigenes Fenster" })).toBeVisible(); } },
  // EPIC-P42: Android-Testgeräte — ohne SDK sichtbar blockiert, das Panel selbst ist immer erreichbar.
  { id: "S65", name: "Android-Testgeräte (Mehr)", from: "session", reach: async (c) => { await more(c, "Geräte"); await expect(c.page.getByTestId("device-panel")).toBeVisible(); } },
  { id: "S66", name: "Android-Testgeräte in eigenes Fenster", forms: PC, from: "session", reach: async (c) => { await more(c, "Geräte"); await expect(c.page.getByRole("button", { name: "Geräte in eigenes Fenster" })).toBeVisible(); } },
];

const DESKTOP: Entry[] = [
  { id: "P01", name: "Layoutwahl (sechs Layouts)", forms: PC, from: "session", reach: async (c) => { await expect(c.page.locator(".tile-layout-btn")).toHaveCount(7); await c.tap(c.page.getByRole("button", { name: "Zwei nebeneinander" })); await expect(c.page.locator(".tile")).toHaveCount(2); } },
  { id: "P02", name: "Kachel-Aktionen: Fokus, Tauschen, Layout, Schließen", forms: PC, from: "session", reach: async (c) => { const bar = c.page.getByRole("group", { name: "Kachel-Aktionen" }); for (const name of ["‹ Fokus", "Fokus ›", "⇄ Tauschen", "⟳ Layout", "✕ Schließen"]) await expect(bar.getByRole("button", { name })).toBeVisible(); } },
  { id: "P03", name: "Liste einklappen", forms: PC, from: "session", reach: async (c) => { await c.tap(c.page.locator(".tile-list-toggle")); await expect(c.page.locator(".split.list-collapsed")).toBeVisible(); } },
  { id: "P04", name: "Tastaturhinweise", forms: PC, from: "session", reach: async (c) => { await c.page.keyboard.press("Shift+Slash"); await expect(c.page.locator(".cheatsheet")).toBeVisible(); await expect(c.page.locator(".cheatsheet-key").filter({ hasText: /^Alt\+1$/ })).toBeVisible(); await c.page.keyboard.press("Escape"); } },
  { id: "P05", name: "Kachel in eigenes Fenster (Taste)", forms: PC, from: "session", reach: async (c) => { await expect(c.page.getByRole("button", { name: "Kachel 1 in eigenem Fenster öffnen" })).toBeVisible(); } },
  { id: "P06", name: "Kachel am Griff herausziehen", forms: PC, from: "session", reach: async (c) => { await expect(c.page.locator('[data-tile="1"] .tile-grip')).toBeVisible(); } },
  { id: "P07", name: "Kachel schließen", forms: PC, from: "session", reach: async (c) => { await c.tap(c.page.getByRole("button", { name: "Kachel 1 schließen" })); await expect(c.page.locator(".tile-empty")).toContainText("Session links wählen"); } },
  { id: "P08", name: "Statusleiste", forms: PC, from: "session", reach: async (c) => { const bar = c.page.getByRole("status", { name: "Statusleiste" }); await expect(bar).toContainText("verbunden"); await expect(bar.locator(".status-focus")).toContainText("Inventar-Aufgabe"); } },
  { id: "P09", name: "Werkzeugseite in der Detailspalte: eigenes Fenster und Schließen", forms: PC, from: "#/einstellungen", reach: async (c) => { const pane = c.page.locator(".tool-pane"); await expect(pane.getByRole("button", { name: "In eigenem Fenster öffnen" })).toBeVisible(); await c.tap(pane.locator(".tool-pane-close")); await expect(pane).toHaveCount(0); } },
  { id: "P10", name: "Ansichten im Kachelkopf", forms: PC, from: "session", reach: async (c) => {
      // Chat, Befehle und „Mehr“ immer; „Änderungen“ nur mit Änderungen (Kleinkram-Regel 2).
      const rail = c.s.locator(".session-topbar .tile-tabs");
      for (const name of [/^Chat/, /^Befehle/]) await expect(rail.getByRole("button", { name })).toBeVisible();
      await expect(rail.locator('[aria-haspopup="menu"]')).toBeVisible();
    },
  },
  { id: "P11", name: "Strg-Klick öffnet eine weitere Kachel", forms: PC, from: "session", reach: async (c) => { await c.tap(c.page.getByRole("button", { name: "Zwei nebeneinander" })); await c.page.locator(".split-list .session-card").filter({ hasText: "Füllsession 3" }).locator(".session-open").click({ modifiers: ["Control"] }); await expect(c.page.locator(".tile")).toHaveCount(2); } },
];

const GROUPS: { title: string; entries: Entry[] }[] = [
  { title: "Global", entries: GLOBAL },
  { title: "Session", entries: SESSION },
  { title: "PC-Arbeitsfläche", entries: DESKTOP },
];

const DOC = resolve(repoRoot, "docs/funktionsinventar.md");

/** Zeilen der Inventar-Tabellen: `| G01 | … | inventar |` bzw. `| X01 | … | spec:name.spec.ts |`. */
function docRows(): { id: string; proof: string }[] {
  return readFileSync(DOC, "utf8")
    .split("\n")
    .map((line) => /^\|\s*([A-Z]\d{2})\s*\|.*\|\s*([^|]+?)\s*\|\s*$/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ id: m[1]!, proof: m[2]! }));
}

test.describe("Funktionsinventar (EPIC-P43 T43.0, AC-P43-1)", () => {
  test("Dokument und Spec führen dieselben Einträge; fremde Nachweise existieren @desktop", () => {
    const rows = docRows();
    const here = GROUPS.flatMap((g) => g.entries.map((e) => e.id)).sort();
    expect(new Set(here).size, "doppelte ID im Spec").toBe(here.length);
    expect(rows.filter((r) => r.proof === "inventar").map((r) => r.id).sort()).toEqual(here);
    for (const row of rows.filter((r) => r.proof !== "inventar")) {
      const file = /^spec:([\w.-]+\.spec\.ts)$/.exec(row.proof)?.[1];
      expect(file, `${row.id}: Nachweis „${row.proof}“ ist weder „inventar“ noch „spec:<datei>“`).toBeTruthy();
      expect(existsSync(resolve(repoRoot, "e2e/specs", file!)), `${row.id}: ${file} fehlt`).toBe(true);
    }
  });

  for (const group of GROUPS) {
    test(`${group.title}: jeder Eintrag ist über seinen Weg erreichbar @tablet @desktop`, async ({ app, hub }, testInfo) => {
      // Die PC-Arbeitsfläche gibt es erst ab 1280 px: Handy- und Tablet-Projekt prüfen sie mit erzwungener
      // Breite (wie layout-desktop.spec.ts), statt den Bereich dort sichtbar zu überspringen.
      const pcOnly = group.entries.every((e) => e.forms === PC);
      if (pcOnly) {
        await app.setViewportSize({ width: 1440, height: 900 });
        await app.reload();
      }
      const form: Form = pcOnly || testInfo.project.name === "desktop" ? "desktop" : testInfo.project.name === "tablet" ? "tablet" : "mobile";
      const entries = group.entries.filter((e) => !e.forms || e.forms.includes(form));
      test.setTimeout(30_000 + entries.length * 12_000);

      await app.addInitScript(() => {
        if (window.top !== window || window.name !== "inventar-reset") return;
        window.name = "";
        const token = localStorage.getItem("ancientvoid.token");
        localStorage.clear();
        sessionStorage.clear();
        if (token) localStorage.setItem("ancientvoid.token", token);
      });
      const sessionId = await hub.createSession({ adapter: "claude", prompt: "Inventar-Aufgabe" });
      for (const n of [1, 2, 3, 4]) await hub.createSession({ adapter: "opencode", prompt: `Füllsession ${n}` });
      await hub.until(async () => (await hub.sessions()).every((s) => s.status === "idle"), "alle Sessions bereit");
      const wide = await app.evaluate(() => matchMedia("(min-width: 700px) and (min-height: 521px)").matches);

      const failures: string[] = [];
      for (const entry of entries) {
        await test.step(`${entry.id} ${entry.name}`, async () => {
          let taps = 0;
          const c: Ctx = {
            page: app,
            hub,
            form,
            wide,
            sessionId,
            s: wide ? app.locator('.tile[data-tile="1"]') : app.locator(".session-live"),
            tap: async (target) => {
              taps += 1;
              await target.click({ timeout: 10_000 });
            },
          };
          const hash = entry.from === "start" ? "#/" : entry.from === "session" ? `#/sessions/${sessionId}` : entry.from;
          // Jeder Eintrag beginnt mit frischem Gerätezustand (Filter, Layout, offene Seitenleisten). Geleert wird
          // erst im neuen Dokument (Init-Skript oben): die alte Seite kann sonst noch nachspeichern, etwa die
          // Dateibaum-Quelle des vorigen Eintrags, und der Drawer stünde wieder offen.
          await app.goto(`${hub.origin}/${hash}`);
          await app.evaluate(() => {
            window.name = "inventar-reset";
          });
          await app.reload();
          if (entry.from === "session") await expect(c.s.locator(".session-topbar")).toBeVisible();
          else if (entry.from === "start") await expect(app.locator(".dashboard")).toBeVisible();
          // Sammeln statt beim ersten Abbruch enden: der Lauf nennt jede fehlende Funktion.
          try {
            await entry.reach(c);
            if (taps > (entry.max ?? 3)) failures.push(`${entry.id} ${entry.name}: ${taps} Interaktionen, erlaubt ${entry.max ?? 3}`);
          } catch (err) {
            failures.push(`${entry.id} ${entry.name}: ${(err instanceof Error ? err.message : String(err)).split("\n").slice(0, 12).join(" ")}`);
          }
        });
      }
      expect(failures, "nicht erreichbare Funktionen").toEqual([]);
    });
  }
});
