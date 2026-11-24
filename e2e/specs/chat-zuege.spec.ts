import { test, expect, sessionTab } from "../support/fixtures.ts";

/**
 * EPIC-P43 T43.4: der Chat in Zügen. Die Arbeit eines Zugs (Werkzeugschritte) faltet sich zu einer Zeile,
 * Antippen klappt sie auf, ein Schritt zeigt Ein- und Ausgabe. Dazu die Statuszeile (nur Gemessenes),
 * die vier Reiter und das einzeilige Antwortfeld. Die Zug-Regeln je Adapter prüft turns.test.ts.
 */
test.describe("Chat in Zügen (EPIC-P43 T43.4)", () => {
  test("die Arbeit eines fertigen Zugs ist gefaltet, Schritte klappen auf und zeigen die Ausgabe @tablet @desktop", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Lies die README" });
    await hub.until(async () => (await hub.sessions()).every((s) => s.status === "idle"), "Zug fertig");
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await sessionTab(app, "Chat");

    const work = app.locator(".turn-work");
    await expect(work).toHaveCount(1);
    await expect(work).not.toHaveClass(/open/);
    await expect(work.locator(".turn-summary")).toContainText("1 Schritt · 1 gelesen");
    // Die Antwort steht offen unter der Arbeit.
    await expect(app.locator(".tail-scroll").getByText(/Antwort auf: Lies die README/)).toBeVisible();

    await work.locator(".turn-summary").click();
    const step = work.locator(".turn-step");
    await expect(step).toHaveCount(1);
    await expect(step.locator(".turn-step-verb")).toHaveText("Liest");
    await expect(step.locator(".turn-step-target")).toHaveText("README.md");
    await step.locator(".turn-step-head").click();
    await expect(step.locator(".turn-step-io")).toContainText("Ausgabe");
    await expect(step.locator(".turn-step-io")).toContainText("# Alpha");

    // Auf/zu ist Gerätezustand und übersteht das Neuladen.
    await app.reload();
    await sessionTab(app, "Chat");
    await expect(app.locator(".turn-work")).toHaveClass(/open/);
  });

  test("der Chat verankert den Tag — Uhrzeit allein reicht nicht @mobile", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Datum im Chat" });
    await hub.until(async () => (await hub.sessions()).every((s) => s.status === "idle"), "Zug fertig");
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await sessionTab(app, "Chat");
    // Ein Tages-Anker fuer einen tagesfrischen Verlauf — nicht an jeder Zeile.
    const tag = app.locator('[data-testid="day-sep"]');
    await expect(tag).toHaveCount(1);
    await expect(tag).toHaveText("Heute");
    // Die Uhrzeit bleibt daneben stehen: der Tag ergaenzt sie, er ersetzt sie nicht.
    await expect(app.locator(".tail-scroll").first()).toContainText(/\d{2}:\d{2}:\d{2}/);
    // Und der Anker ist lesbar, nicht nur farbig: eigene Zeile mit Text.
    await expect(tag.locator("span")).toBeVisible();
  });

  test("Statuszeile nur mit Gemessenem; das Unbekannte steht im Bericht @desktop", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Statuszeile" });
    await hub.until(async () => (await hub.sessions()).every((s) => s.status === "idle"), "Zug fertig");
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    const live = app.locator(".session-live, .tile").first();
    await expect(live.locator(".status-line .run-tokens")).toContainText("Tokens");
    // Die Attrappe meldet weder Kontextfenster noch Kontingent: in der Zeile schweigt beides.
    await expect(live.locator(".status-line")).not.toContainText("unbekannt");
    await expect(live.locator(".status-line .run-quota")).toHaveCount(0);
    await sessionTab(live, "Bericht");
    await expect(live.locator(".kv-list").first()).toContainText("Kontingent");
  });

  test("vier Reiter: Änderungen zeigt Diff und Bericht, der Rest liegt unter „Mehr“ @tablet @desktop", async ({ app, hub }) => {
    // Mit einer geänderten Datei — ohne rückt „Änderungen“ unter „Mehr“ (Kleinkram-Regel 2, kleinkram.spec.ts).
    const id = await hub.createSession({ adapter: "opencode", prompt: "Reiter: Lege eine DATEI an" });
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "Zug fertig");
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    const bar = app.locator(".subtabs-wrap").first();
    await expect(bar.getByRole("button")).toHaveCount(4);
    await sessionTab(app, "Änderungen");
    await expect(app.locator(".changes-report .kv-list").first()).toContainText("Dauer");

    await bar.locator('[aria-haspopup="menu"]').click();
    const menu = bar.getByRole("menu", { name: "Weitere Ansichten" });
    await expect(menu.getByRole("menuitem")).toHaveText(["Verlauf", "Bericht", "Datei", "Graph", "Git", "GitLab", "Suche", "Browser", "Geräte"]);
    await menu.getByRole("menuitem", { name: "Graph" }).click();
    await expect(menu).toHaveCount(0);
    await expect(bar.locator('[aria-haspopup="menu"]')).toHaveText("Graph");
    await expect(app.locator(".graph-pane")).toBeVisible();
  });

  test("das Antwortfeld ist einzeilig, bis jemand hineintippt", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Kompakt" });
    await hub.until(async () => (await hub.sessions()).every((s) => s.status === "idle"), "Zug fertig");
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await sessionTab(app, "Chat");
    const composer = app.locator(".composer").first();
    const show = app.getByRole("button", { name: "Steuerung einblenden" });
    if (await show.isVisible()) await show.click();
    await expect(composer).toHaveClass(/compact/);
    await expect(composer.getByRole("button", { name: "Verbessern" })).toBeHidden();

    await composer.getByPlaceholder("Antworten…").click();
    await expect(composer).not.toHaveClass(/compact/);
    await expect(composer.getByRole("button", { name: "Verbessern" })).toBeVisible();
    // Mit Text bleibt es offen, auch ohne Fokus.
    await composer.getByPlaceholder("Antworten…").fill("Entwurf");
    await app.locator(".session-title, .tail-scroll").first().click();
    await expect(composer).not.toHaveClass(/compact/);
  });
});
