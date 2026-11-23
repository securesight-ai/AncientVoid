import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { test, expect } from "../support/fixtures.ts";
import type { TestHub } from "../support/hub.ts";

/**
 * EPIC-P26 T26.10 (AC-P26-1, -2, -4, -5, -6, -7): Factory-Lauf gegen die `factory`-Attrappe
 * (e2e/support/bin/factory) — Onboarding mit Checkliste/Fehlergrund, Fortschritt im Panel,
 * Störung fail loud, Steuerung mit Bestätigung, Treiber-Ende, Hub-Crash mitten im Lauf.
 * Die echte Factory prüft nur die manuelle Abnahme (AC-P26-10, not_run).
 */

function factoryProject(hub: TestHub, name: string, progress: Record<string, unknown> = { done: 1, total: 4, now: { phase: "bauen", story: "S-1", task: "T-2" } }): string {
  const project = join(hub.projectsDir, name);
  mkdirSync(join(project, ".factory", "intake"), { recursive: true });
  writeFileSync(join(project, ".factory", "config.json"), JSON.stringify({ schema_version: "1", modus: "b", provider: "anthropic" }));
  writeFileSync(join(project, ".factory", "intake", "state.json"), JSON.stringify({ schema_version: "1", status: "ready", execution_ready: true, next_action: "Lauf starten" }));
  writeFileSync(join(project, ".factory", "stand-in.json"), JSON.stringify(progress));
  execSync("git init -q", { cwd: project });
  return project;
}

async function startRun(hub: TestHub, project: string): Promise<{ driver: string; observer: string }> {
  const res = await hub.api<{ driver: { id: string }; observer: { id: string } }>("/api/factory/start", { method: "POST", body: { project, goal: "Lauf" } });
  expect(res.status).toBe(201);
  return { driver: res.body.driver.id, observer: res.body.observer.id };
}

const setProgress = (project: string, value: Record<string, unknown>) => writeFileSync(join(project, ".factory", "stand-in.json"), JSON.stringify(value));

test.describe("Factory-Onboarding (AC-P26-1)", () => {
  async function openForm(app: Page, project: string) {
    await app.getByRole("button", { name: "Neue Session" }).click();
    await app.getByRole("combobox", { name: "Projekt", exact: true }).selectOption(project);
    await app.getByLabel("Loop", { exact: true }).selectOption("securesight-factory");
    await app.getByLabel("Anbindung").selectOption("+neu");
    await expect(app.locator(".loop-onboard")).toBeVisible();
  }
  const bareProject = (hub: TestHub, name: string): string => {
    const project = join(hub.projectsDir, name);
    mkdirSync(project, { recursive: true });
    execSync("git init -q", { cwd: project });
    return project;
  };

  test("ein scheiterndes factory init zeigt den Grund und startet nichts", async ({ app, hub }) => {
    const project = bareProject(hub, "onb-fail");
    writeFileSync(join(project, ".stand-in-fail-init"), "");
    await openForm(app, project);
    await app.getByRole("button", { name: "Starten", exact: true }).click();
    await expect(app.locator(".error, [role=alert]").filter({ hasText: "trust: ✘" })).toBeVisible();
    expect((await hub.api<unknown[]>("/api/sessions")).body).toHaveLength(0);
  });

  test("nicht bereit: Checkliste sichtbar, kein Lauf; danach startet „bestehend“ den Lauf", async ({ app, hub }) => {
    const project = bareProject(hub, "onb-not-ready");
    writeFileSync(join(project, ".stand-in-not-ready"), "");
    await openForm(app, project);
    await app.getByRole("button", { name: "Starten", exact: true }).click();
    await expect(app.getByRole("status").filter({ hasText: "noch nicht bereit" })).toContainText("trust: ✘");
    expect((await hub.api<unknown[]>("/api/sessions")).body).toHaveLength(0);
    expect(existsSync(join(project, ".claude", "skills", "factory", "SKILL.md"))).toBe(true);
    // Die Auswahl des Formulars (Vorgabe „a“) steht in der angelegten Konfiguration — vom Hub nur durchgereicht.
    expect(JSON.parse(readFileSync(join(project, ".factory", "config.json"), "utf8"))).toMatchObject({ modus: "a", provider: "anthropic" });
    // Nach der Klärung: dieselbe Auswahl ist jetzt „bestehend“, ein Klick startet den Lauf.
    await app.getByRole("button", { name: "Starten", exact: true }).click();
    await expect(app).toHaveURL(/#\/(hosts\/[^/]+\/)?sessions\//);
    expect((await hub.api<unknown[]>("/api/sessions")).body).toHaveLength(2);
  });

  test("bereit: Einrichtung und Lauf in einem Zug", async ({ app, hub }) => {
    const project = bareProject(hub, "onb-ready");
    await openForm(app, project);
    await app.getByRole("button", { name: "Starten", exact: true }).click();
    await expect(app).toHaveURL(/#\/(hosts\/[^/]+\/)?sessions\//);
    expect((await hub.api<unknown[]>("/api/sessions")).body).toHaveLength(2);
  });
});

test.describe("Factory-Lauf im Panel (AC-P26-2, -4, -6)", () => {
  test("Fortschritt erscheint ≤ 15 s, Störung ist laut, Erholung nimmt sie zurück", async ({ app, hub }) => {
    const project = factoryProject(hub, "run-progress");
    const { observer } = await startRun(hub, project);
    await app.goto(`${hub.origin}/#/sessions/${observer}`);
    const panel = app.locator(".loop-panel");
    await expect(panel).toContainText("1 von 4 Aufgaben", { timeout: 15_000 });
    await expect(panel.locator(".loop-factory")).toContainText("ausführungsbereit");
    await expect(panel.locator(".loop-factory")).toContainText("Treiber");

    setProgress(project, { done: 2, total: 4, now: { phase: "testen", story: "S-1", task: "T-3" } });
    await expect(panel).toContainText("2 von 4 Aufgaben", { timeout: 15_000 });

    // K9: kaputtes JSON → Störung mit Grund, andere Sessions laufen weiter
    setProgress(project, { garbage: true });
    await expect(panel.locator(".loop-alert.bad")).toContainText("progress", { timeout: 15_000 });
    setProgress(project, { done: 3, total: 4 });
    await expect(panel.locator(".loop-alert.bad")).toHaveCount(0, { timeout: 15_000 });
    await expect(panel).toContainText("3 von 4 Aufgaben");

    // unbekannte schema_version ist ebenfalls laut
    setProgress(project, { schema_version: "9", done: 3, total: 4 });
    await expect(panel.locator(".loop-alert.bad")).toContainText("Schema 9", { timeout: 15_000 });
  });

  test("Treiber beendet ist sichtbar und kein „fertig“", async ({ app, hub }) => {
    const project = factoryProject(hub, "run-driver-end");
    const { driver, observer } = await startRun(hub, project);
    await app.goto(`${hub.origin}/#/sessions/${observer}`);
    await hub.api(`/api/sessions/${driver}/steer`, { method: "POST", body: { kind: "stop" } });
    await expect(app.locator(".loop-factory")).toContainText("Treiber beendet", { timeout: 15_000 });
    await expect(app.locator(".loop-factory .loop-alert")).toContainText("kein „fertig“");
  });

  test("Hub-Crash mitten im Lauf: gleiche Sessions, Verknüpfung genau einmal, Panel kommt zurück (K7)", async ({ app, hub }) => {
    const project = factoryProject(hub, "run-k7");
    const { driver, observer } = await startRun(hub, project);
    await app.goto(`${hub.origin}/#/sessions/${observer}`);
    await expect(app.locator(".loop-panel")).toContainText("1 von 4 Aufgaben", { timeout: 15_000 });
    const before = (await hub.api<{ id: string }[]>("/api/sessions")).body.map((s) => s.id).sort();

    const ms = await hub.restart("SIGKILL");
    expect(ms).toBeLessThan(10_000);
    const after = (await hub.api<{ id: string }[]>("/api/sessions")).body.map((s) => s.id).sort();
    expect(after).toEqual(before);
    for (const id of [driver, observer]) {
      const events = (await hub.events(id)).filter((e) => e.payload.kind === "factory.linkage");
      expect(events, `Verknüpfung auf ${id}`).toHaveLength(1);
    }
    await app.goto(`${hub.origin}/#/sessions/${observer}`);
    await expect(app.locator(".loop-factory")).toContainText("Treiber", { timeout: 15_000 });
    setProgress(project, { done: 4, total: 4 });
    await expect(app.locator(".loop-panel")).toContainText("4 von 4 Aufgaben", { timeout: 15_000 });
  });
});

test.describe("Factory-Steuerung (AC-P26-5)", () => {
  test("Betriebsart a verlangt Bestätigung; Abbrechen ändert nichts, Bestätigen rekonfiguriert; Beenden stoppt beide", async ({ app, hub }) => {
    const project = factoryProject(hub, "run-ctl");
    const { driver, observer } = await startRun(hub, project);
    await app.goto(`${hub.origin}/#/sessions/${observer}`);
    const factory = app.locator(".loop-factory");
    await expect(factory).toBeVisible({ timeout: 15_000 });
    await factory.getByLabel("Betriebsart der Factory").selectOption("a");

    await factory.getByRole("button", { name: "Betriebsart setzen" }).click();
    // Rückfrage im Base-Modal (kein Browser-Dialog): Abbrechen ändert nichts.
    await expect(app.getByTestId("modal")).toContainText("merged automatisch");
    await app.getByTestId("modal").getByRole("button", { name: "Abbrechen" }).click();
    expect(JSON.parse(readFileSync(join(project, ".factory", "config.json"), "utf8"))).toMatchObject({ modus: "b" });

    await factory.getByRole("button", { name: "Betriebsart setzen" }).click();
    await app.getByTestId("modal").getByRole("button", { name: "OK" }).click();
    await expect.poll(() => JSON.parse(readFileSync(join(project, ".factory", "config.json"), "utf8")).modus, { timeout: 10_000 }).toBe("a");
    const audit = (await hub.events(observer)).filter((e) => e.payload.kind === "factory.command").map((e) => (e.payload as { factory: { command: string; outcome: string } }).factory);
    expect(audit).toEqual([expect.objectContaining({ command: "set_mode", outcome: "ok" })]);

    await factory.getByRole("button", { name: "Lauf beenden" }).click();
    await app.getByTestId("modal").getByRole("button", { name: "OK" }).click();
    await hub.until(async () => {
      const list = (await hub.api<{ id: string; status: string }[]>("/api/sessions")).body;
      return [driver, observer].every((id) => list.find((s) => s.id === id)?.status === "stopped");
    }, "beide Sessions gestoppt");
  });
});
