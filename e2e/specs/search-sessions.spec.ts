import { test, expect, sessionTab } from "../support/fixtures.ts";

/**
 * Suche (Nachschärfe 2026-11-22): die Suche durchsucht die **Sessiontexte** —
 * Fragen und Antworten — und nicht nur Markdown. Gezeigt wird der ganze Ablauf
 * über die Oberfläche: Suchen, Fundstelle in der eigenen Sitzung anspringen,
 * Bereich der Suche umschalten.
 *
 * Die Doku-Stufe bleibt hier außen vor: sie hängt davon ab, ob auf dem Runner
 * `qmd` installiert und der Projekt-Index aufgebaut ist. Was die Suche ohne
 * qmd findet, prüft apps/hub/test/modules/search/docs-local.test.ts.
 */
test.describe("Suche über Sessiontexte", () => {
  test("Fundstellen aus Frage und Antwort, markiertes Fundwort, Sprung zur Nachricht @tablet @desktop", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Bestell den Kurbelwellenträger nach Maß" });
    await hub.until(async () => (await hub.sessions()).every((s) => s.status === "idle"), "Zug fertig");

    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await sessionTab(app, "Suche");
    await app.locator(".search-input").fill("Kurbelwellenträger");

    // Frage und Antwort derselben Sitzung — die Attrappe antwortet mit dem
    // Wortlaut der Frage, also trifft derselbe Begriff beide Rollen.
    await expect(app.locator(".hit-card")).toHaveCount(2);
    await expect(app.locator(".hit-group")).toHaveCount(1);
    await expect(app.locator(".hit-role--user")).toHaveCount(1);
    await expect(app.locator(".hit-role--assistant")).toHaveCount(1);
    // Das Fundwort ist markiert, nicht nur irgendwo im Text.
    await expect(app.locator(".hit-snippet mark")).toHaveCount(2);
    await expect(app.locator(".search-block-head").first()).toContainText("2 Fundstellen");

    // Die Fundkarten enden nicht unter der schwebenden Dock-Leiste: die
    // Suchseite hält unten Platz frei (sonst läuft die letzte Karte weg).
    const pad = await app.locator(".search-pane").evaluate((el) => getComputedStyle(el).paddingBottom);
    expect(parseFloat(pad)).toBeGreaterThanOrEqual(40);

    // Der Indexzustand ist sichtbar: jemand, der nichts findet, soll sehen,
    // dass gesucht wurde.
    await expect(app.locator(".search-index")).toContainText("Sitzungen im Index");

    // Fundstelle in der eigenen Sitzung: der Chat wird aktiv und die Nachricht
    // mit dem Begriff ist zu sehen.
    await app.locator(".hit-jump").first().click();
    await expect(app.locator(".search-pane")).toHaveCount(0);
    await expect(app.locator(".tail-scroll").getByText(/Kurbelwellenträger/).first()).toBeVisible();
  });

  test("Suche findet hub-weit; „nur dieses Projekt“ grenzt die Sitzungen ein @tablet @desktop", async ({ app, hub }) => {
    const inAlpha = await hub.createSession({ adapter: "opencode", project: hub.alpha, prompt: "Wofür braucht man eine Kuppelscheibe?" });
    await hub.createSession({ adapter: "opencode", project: hub.beta, prompt: "Die Kuppelscheibe im Beta-Projekt ist gemeint" });
    await hub.until(async () => (await hub.sessions()).every((s) => s.status === "idle"), "beide Züge fertig");

    await app.goto(`${hub.origin}/#/sessions/${inAlpha}`);
    await sessionTab(app, "Suche");
    await app.locator(".search-input").fill("Kuppelscheibe");

    // Zwei Sitzungen, zwei Projekte — die Suche kennt beide, weil der Fundus
    // der Hub ist und nicht das eine Projekt.
    await expect(app.locator(".hit-group")).toHaveCount(2);

    await app.locator(".search-here", { hasText: "nur dieses Projekt" }).locator("input").check();
    await expect(app.locator(".hit-group")).toHaveCount(1);
    await expect(app.locator(".hit-group-title")).toHaveCount(1);

    // Umschalten auf „nur Doku“ nimmt die Sitzungsseite komplett raus.
    await app.getByRole("button", { name: "Doku", exact: true }).click();
    await expect(app.locator(".hit-group")).toHaveCount(0);
    await expect(app.locator(".search-roles")).toHaveCount(0);
  });

  test("Doku über alle Projekte findet das Handbuch des anderen Projekts @tablet @desktop", async ({ app, hub }) => {
    // Der Fall aus dem Alltag: man sucht den Namen eines Tools oder Worts aus
    // einem anderen Repo, sitzt aber in einer Sitzung dieses Projekts. Die
    // Doku-Seite ist sonst an das Projekt der Sitzung gebunden.
    const id = await hub.createSession({ adapter: "opencode", project: hub.beta, prompt: "Wie läuft der Handoff zwischen PC und Handy?" });
    await hub.until(async () => (await hub.sessions()).every((s) => s.status === "idle"), "Zug fertig");

    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await sessionTab(app, "Suche");
    await app.locator(".search-input").fill("Handbuch");

    // Beta hat kein „Handbuch“ in seinem Markdown — die Doku-Seile bleibt leer.
    await expect(app.locator(".search-block-head").nth(1)).toContainText("0 Fundstellen");

    await app.locator(".search-here", { hasText: "Doku in allen Projekten" }).locator("input").check();
    await expect(app.locator(".search-block-head").nth(1)).toContainText("Fundstelle");
    // Die Fundstelle nennt ihr Projekt, sonst steht da nur ein Dateiname.
    await expect(app.locator(".search-result-card").first()).toContainText("alpha");
    await expect(app.locator(".search-status").filter({ hasText: "Projekte durchsucht" })).toBeVisible();

    // Die Fundorte oben sind auf dem Handy die einzige Doku-Antwort, die man ohne
    // Scrollen durch hundert Sitzungskarten sieht.
    await expect(app.locator(".search-where-chip").first()).toContainText("alpha/README.md");

    // Öffnen heißt: die Datei aus dem Projekt der Fundstelle, nicht aus dem der
    // laufenden Sitzung — sonst steht da ein Fehler, wo ein Handbuch liegt.
    await app.locator(".search-result-card").first().click();
    await expect(app.locator(".file-viewer-body")).toContainText("Das Handbuch beschreibt den Handoff");
  });
});
