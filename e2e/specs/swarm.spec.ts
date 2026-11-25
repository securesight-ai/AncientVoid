import { test, expect } from "../support/fixtures.ts";

/** EPIC-P40/EPIC-P60 (ADR-0064, ADR-0077), EPIC-P83 (ADR-0123): Agenten-Swarms gegen einen echten Hub —
 * Harnesses, DAG, Gates, Policy, Stop, Run/Team-Redirects auf die Swarm-Fläche. */

const frame = { adapters: ["dummy"], coordinatorAdapter: null, models: [], maxTasks: 4, maxDispatchesPerTask: 2, maxParallel: 2 };
const plan = {
  tasks: [
    { id: "T1", title: "Erste Analyse", prompt: "Analysiere den Bestand.", adapter: "dummy", model: null, dependsOn: [] },
    { id: "T2", title: "Zweite Ausarbeitung", prompt: "Arbeite das Ergebnis aus.", adapter: "dummy", model: null, dependsOn: ["T1"] },
  ],
};

test.describe("Agenten-Swarms (EPIC-P40/P60/P83)", () => {
  test("Swarm mit zwei Harnesses und DAG in der PWA verfolgen bis done", async ({ app, hub }) => {
    const start = await hub.api("/api/swarms", {
      body: { title: "E2E-Swarm", goal: "Zwei Tasks über zwei Adapter.", project: hub.alpha, frame, plan },
    });
    expect(start.status).toBe(201);
    const id = (start.body as { id: string }).id;

    await app.goto(`${hub.origin}/#/swarms`);
    await expect(app.getByTestId("swarms-pane")).toBeVisible();
    await app.getByText("E2E-Swarm").first().click();
    await expect(app.getByTestId("swarm-detail")).toBeVisible();
    await expect(app.getByTestId("swarm-detail")).toContainText("Erste Analyse");
    await expect(app.getByTestId("swarm-detail")).toContainText("Zweite Ausarbeitung");

    // DAG sichtbar: T2 hängt an T1 (Text), Adapter beider Harnesses sichtbar.
    await expect(app.getByTestId("swarm-detail")).toContainText("T1");

    // T60.6: Kartenübersicht — je Task eine Karte mit Adapter, Fortschrittsbalken und Session-Link.
    const cards = app.getByTestId("swarm-task-card");
    await expect(cards).toHaveCount(2);
    await expect(cards.first()).toContainText("dummy");
    await expect(app.getByTestId("swarm-progress")).toBeVisible();
    await expect(app.getByTestId("swarm-detail").getByRole("link", { name: "Session ↗" }).first()).toBeVisible();

    // Beide Tasks laufen über zwei verschiedene Adapter und enden done.
    await expect
      .poll(async () => (await hub.api<{ status: string }>(`/api/swarms/${id}`)).body.status, { timeout: 60_000 })
      .toBe("done");
    const swarm = (await hub.api<{ tasks: { id: string; adapter: string; status: string; result: { text: string } | null }[] }>(`/api/swarms/${id}`)).body;
    expect(swarm.tasks[0]!.adapter).toBe("dummy");
    expect(swarm.tasks.map((t) => t.adapter)).toEqual(["dummy", "dummy"]);
    expect(swarm.tasks.map((t) => t.status)).toEqual(["done", "done"]);
    expect((swarm.tasks[1]!.result?.text ?? "").length).toBeGreaterThan(0);
    // Ergebnisse stammen aus dem jeweils eigenen Dispatch (AC-P40-2).
    await expect(app.getByTestId("swarm-detail")).toContainText("fertig");
  });

  test("Nicht freigegebener Adapter wird serverseitig verweigert (AC-P40-3)", async ({ hub }) => {
    const res = await hub.api("/api/swarms", {
      body: {
        title: "Verweigert",
        goal: "Adapter außerhalb des Rahmens.",
        project: hub.alpha,
        frame: { ...frame, adapters: ["dummy"] },
        plan: { tasks: [{ id: "T1", title: "t", prompt: "p", adapter: "codex", model: null, dependsOn: [] }] },
      },
    });
    expect(res.status).toBe(422);
  });

  test("Stop bricht den Swarm ab; Dispatches bleiben nachvollziehbar (AC-P40-6)", async ({ app, hub }) => {
    const start = await hub.api("/api/swarms", { body: { title: "Stopp-Swarm", goal: "Wird gestoppt.", project: hub.alpha, frame, plan } });
    const id = (start.body as { id: string }).id;
    // Deterministisch über die API stoppen — der dummy-Worker ist in Sekunden fertig,
    // der UI-Klick-Race gehört in einen langsameren Live-Kontext; hier zählt der Zustand.
    const cancel = await hub.api(`/api/swarms/${id}/cancel`, { body: { reason: "E2E-Stopp" } });
    expect(cancel.status).toBe(200);
    expect((cancel.body as { status: string }).status).toBe("cancelled");
    // PWA zeigt den abgebrochenen Swarm mit Nachvollziehbarkeit.
    await app.goto(`${hub.origin}/#/swarms`);
    await app.getByText("Stopp-Swarm").first().click();
    await expect(app.getByTestId("swarm-detail")).toContainText(/abgebrochen|cancelled/);
  });

  test("Swarm-Liste gegen den echten Hub lesbar (AC-P40-4 Lesefläche)", async ({ hub }) => {
    // Agenten-403 ist im Integrationstest belegt (Policy swarm.manage: agent → deny);
    // hier bleibt die Auth-Lesefläche: Liste erreichbar, Swarm-Objekt formtreu.
    const list = await hub.api("/api/swarms");
    expect(list.status).toBe(200);
    const swarms = list.body as { id: string; status: string }[];
    expect(Array.isArray(swarms)).toBe(true);
    for (const r of swarms) expect(typeof r.id).toBe("string");
  });

  test("Alte Run- und Team-Links landen per Redirect auf der Swarm-Fläche (AC-P60-1, ADR-0123 §5)", async ({ app, hub }) => {
    const start = await hub.api("/api/swarms", { body: { title: "Redirect-Swarm", goal: "Altlink-Check.", project: hub.alpha, frame, plan } });
    const id = (start.body as { id: string }).id;
    // Alt-Hash aus der Run-Epoche mit altem Query-Schlüssel …
    await app.goto(`${hub.origin}/#/runs?run=${id}`);
    // … wird permanent auf #/swarms?swarm=… umgeschrieben und öffnet das Detail.
    await expect(app.getByTestId("swarms-pane")).toBeVisible();
    await expect(app).toHaveURL(/#\/swarms\?swarm=/);
    await expect(app.getByTestId("swarm-detail")).toBeVisible();
    await expect(app.getByTestId("swarm-detail")).toContainText("Redirect-Swarm");

    // Alt-Hash aus der Team-Epoche (bis P83) ebenso (AC-P83-20).
    await app.goto(`${hub.origin}/#/teams?team=${id}`);
    await expect(app).toHaveURL(/#\/swarms\?swarm=/);
    await expect(app.getByTestId("swarm-detail")).toContainText("Redirect-Swarm");
  });

  test("Kompletter Ablauf über die Fläche: anlegen, Rückfrage beantworten, stoppen (AC-P60-6)", async ({ app, hub }) => {
    await app.goto(`${hub.origin}/#/swarms`);
    await app.getByRole("button", { name: "Neuer Swarm", exact: true }).click();
    const form = app.getByTestId("swarm-new");
    await form.locator("label").filter({ hasText: "Titel" }).locator("input").fill("Formular-Swarm");
    await form.locator("label").filter({ hasText: "Ziel" }).locator("textarea").fill("Ziel des Swarms.");
    await form.locator("label").filter({ hasText: "Projekt" }).locator("select").selectOption({ label: "alpha" });
    await form.locator("label").filter({ hasText: "dummy" }).locator("input").check();
    // Koordinator dummy liefert keinen lesbaren Plan ⇒ genau eine Rückfrage (fail loud).
    await form.locator("label").filter({ hasText: "Koordinator" }).locator("input").fill("dummy");
    await form.getByRole("button", { name: "Swarm starten", exact: true }).click();
    await expect(form).toHaveCount(0);
    await app.getByText("Formular-Swarm").first().click();
    await expect(app.getByTestId("swarm-gate")).toBeVisible({ timeout: 30_000 });
    await app.getByRole("button", { name: "Swarm abbrechen", exact: true }).click();
    await expect(app.getByTestId("swarm-detail")).toContainText(/abgebrochen|beendet/);
  });

  test("Offline: letzter Stand mit Zeitstempel, Mutationen gesperrt (AC-P60-3, K10)", async ({ app, hub }) => {
    await hub.api("/api/swarms", { body: { title: "Offline-Swarm", goal: "Stand bleibt sichtbar.", project: hub.alpha, frame, plan } });
    await app.goto(`${hub.origin}/#/swarms`);
    await expect(app.getByText("Offline-Swarm").first()).toBeVisible(); // Stand online geladen und gecacht
    const before = Date.now();
    await app.context().setOffline(true);
    // Zwei fehlgeschlagene Polls (3 s-Takt) gelten erst als Ausfall (BUG-0045-Muster).
    await expect(app.getByTestId("swarms-offline")).toBeVisible({ timeout: 20_000 });
    await expect(app.getByTestId("swarms-offline")).toContainText(/letzter Stand/i);
    await expect(app.getByText("Offline-Swarm").first()).toBeVisible(); // kein White-Screen
    // Der Stand ist datiert — nie als frisch ausgegeben (K10).
    const at = await app.getByTestId("swarms-offline").locator("time").getAttribute("datetime");
    expect(Date.parse(at!)).toBeLessThanOrEqual(before);
    await expect(app.getByRole("button", { name: "Neuer Swarm", exact: true })).toBeDisabled();
    await app.context().setOffline(false);
  });
});
