import { test, expect, sessionTab } from "../support/fixtures.ts";

test.describe("Fortschritt und Kontingent im Lauf", () => {
  test("mit Plan: Aufgaben, Prozent und Restzeit, danach verschwindet die Anzeige @desktop", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "PLAN WARTE4" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    const progress = app.locator(".run-progress");
    // First snapshot: percent yes, but no ETA yet — one snapshot has no
    // velocity to measure (BUG-0062), a guess would pretend to know.
    await expect(progress).toContainText("1/4 Aufgaben · 25 %");
    await expect(progress).not.toContainText("noch ca.");
    // Second snapshot 1.5 s later: velocity exists, an ETA appears —
    // tied to the snapshots, not to the running clock.
    await expect(progress).toContainText("2/4 Aufgaben · 50 %");
    await expect(progress).toContainText("noch ca.");
    await expect(app.locator(".run-bar span")).toHaveAttribute("style", /width: 50%/);
    await expect(app.locator(".topbar .status")).toHaveAttribute("data-status", "idle", { timeout: 15_000 });
    await expect(progress).toHaveCount(0);
  });

  test("ohne Plan: nur die Laufzeit, keine erfundene Prozentzahl", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Arbeite WARTE4" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.locator(".run-progress")).toContainText("läuft seit");
    await expect(app.locator(".run-progress")).toContainText("ohne Plan kein Fortschritt messbar");
    await expect(app.locator(".run-bar")).toHaveCount(0);
  });

  test("ohne Plan, mit Zughistorie: die typische Zugdauer als grobe Restzeit", async ({ app, hub }) => {
    // Two short finished turns first — only then does a third running turn
    // have enough history for the honest "Zug hier meist" fallback (one
    // duration is no statistics, same rule as the plan ETA).
    const id = await hub.createSession({ adapter: "opencode", prompt: "Erster WARTE2" });
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "turn 1 idle");
    await hub.api(`/api/sessions/${id}/steer`, { body: { kind: "prompt", text: "Zweiter WARTE2" } });
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "turn 2 idle");
    await hub.api(`/api/sessions/${id}/steer`, { body: { kind: "prompt", text: "Dritter WARTE12" } });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.locator(".run-progress")).toContainText("läuft seit");
    await expect(app.locator(".run-progress")).toContainText(/Zug hier meist .+ \(2 gelaufen\)/);
    await expect(app.locator(".run-progress")).not.toContainText("ohne Plan kein Fortschritt messbar");
    await expect(app.locator(".run-bar")).toHaveCount(0);

    // BUG-0167: Reload mitten im dritten Zug — die Historie der
    // abgeschlossenen Züge muss aus der Event-Historie zurückkommen, sonst
    // fällt die Anzeige auf „Schätzung ab 5 Läufen (bisher 2)“ zurück.
    await app.reload();
    await expect(app.locator(".run-progress")).toContainText(/Zug hier meist .+ \(2 gelaufen\)/);
  });

  test("Lauf-Messwerte: nach 5 Zügen schätzt der Hub die Restzeit, davor ehrlich „ab 5 Läufen“ (T21.3)", async ({ app, hub }) => {
    const idle = async (id: string) => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle";
    const id = await hub.createSession({ adapter: "opencode", prompt: "Messung eins WARTE2" });
    await hub.until(() => idle(id), "turn 1 idle");
    await hub.api(`/api/sessions/${id}/steer`, { body: { kind: "prompt", text: "Messung zwei WARTE2" } });
    await hub.until(() => idle(id), "turn 2 idle");
    await hub.until(async () => (await hub.api<{ turns: unknown[] }>(`/api/sessions/${id}/turns`)).body.turns.length === 2, "2 Züge gemessen");

    await hub.api(`/api/sessions/${id}/steer`, { body: { kind: "prompt", text: "Messung drei WARTE12" } });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.locator(".run-progress")).toContainText("Schätzung ab 5 Läufen (bisher 2)");
    await expect(app.locator(".run-progress")).not.toContainText("≈ noch");

    for (const n of [4, 5, 6]) {
      await hub.until(() => idle(id), `turn ${n - 1} idle`);
      await hub.api(`/api/sessions/${id}/steer`, { body: { kind: "prompt", text: `Messung ${n} WARTE2` } });
    }
    await hub.until(() => idle(id), "turn 6 idle");
    const turns = (await hub.api<{ turns: { outcome: string; durationMs: number }[] }>(`/api/sessions/${id}/turns`)).body.turns;
    expect(turns.length).toBeGreaterThanOrEqual(5);
    expect(turns.every((t) => t.outcome === "ok" && t.durationMs > 0)).toBe(true);
    const est = (await hub.api<{ state: string; n: number; medianMs: number }>(`/api/sessions/${id}/estimate`)).body;
    expect(est).toMatchObject({ state: "ok" });
    expect(est.n).toBeGreaterThanOrEqual(5);

    await hub.api(`/api/sessions/${id}/steer`, { body: { kind: "prompt", text: "Messung sieben WARTE12" } });
    await app.reload();
    await expect(app.locator(".run-progress")).toContainText(/≈ noch .+ · typisch .+ · \d+ Läufe, (diese Session|dieser Harness|dieses Modell)/);
  });

  test("die ganze Session-Ansicht trägt den aktiven Rahmen wie die Übersichtskarte", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Rahmen WARTE6" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    // Same class language as the overview card (st-working) — visible on
    // every tab, not just the small status pill.
    await expect(app.locator(".session-live.st-working")).toHaveCount(1);
    await expect(app.locator(".topbar .status")).toHaveAttribute("data-status", "idle", { timeout: 20_000 });
    await expect(app.locator(".session-live.st-working, .session-live.st-waiting")).toHaveCount(0);
  });

  test("das Kontingent zeigt, was der Provider meldet", async ({ app, hub }) => {
    const ok = await hub.createSession({ adapter: "opencode", prompt: "Kurz" });
    await app.goto(`${hub.origin}/#/sessions/${ok}`);
    // EPIC-P43 T43.4 (Kleinkram-Regel 1): ohne Meldung schweigt die Statuszeile, der Bericht nennt es.
    await expect(app.locator(".status-line .run-tokens")).toBeVisible();
    await expect(app.locator(".run-quota")).toHaveCount(0);
    await sessionTab(app, "Bericht");
    await expect(app.locator(".kv-row").filter({ hasText: "Kontingent" })).toContainText(/unbekannt|keine Meldung/);

    const limited = await hub.createSession({ adapter: "opencode", prompt: "Bitte KONTINGENT" });
    await app.goto(`${hub.origin}/#/sessions/${limited}`);
    await expect(app.locator(".run-quota.err")).toHaveText("5 h: erschöpft · frei ab 2026-09-23 15:00:00");
  });

  test("Kontextfenster als Balken: pi meldet Füllung und Fenstergröße (ADR-0032)", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "pi", prompt: "kurzer Lauf" });
    // pi.usage trägt die gemeldete Füllung, pi.model die Fenstergröße —
    // erst wenn beide da sind, darf der Balken etwas füllen (nicht raten).
    await hub.until(async () => (await hub.events(id)).some((e) => (e.payload as { kind?: string }).kind === "pi.usage"), "usage gemeldet");
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.locator(".ctx-bar")).not.toHaveClass(/unknown/);
    await expect(app.locator(".run-tokens")).toContainText(/Kontext \d+ %/);
    await expect(app.locator(".run-tokens")).toContainText(/[\d.]+ Tokens verarbeitet/);
    // Die Modell-Ansage (pi.model) steht in der Kopfzeile, nicht erst im Verlauf.
    await expect(app.locator(".session-head, .topbar").first()).toContainText("evo/qwen-e2e");
  });
});
