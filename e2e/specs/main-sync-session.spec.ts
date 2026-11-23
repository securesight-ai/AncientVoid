import { test, expect, enableAutoTiling } from "../support/fixtures.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import type { TestHub } from "../support/hub.ts";
import { join, dirname } from "node:path";

const execFileAsync = promisify(execFile);

/** EPIC-P67 T67.8 / ADR-0088: Session-Indikator „N hinter main“ + Menü
 * (Prüfen/Aktualieren/Konflikte) — gegen ein echtes lokales Remote. */

/** Bare-„origin“ für ein TestHub-Projekt aufsetzen (Muster Forge-Integrationstest). */
async function withOrigin(project: string, name: string): Promise<{ advance: (msg: string) => Promise<void> }> {
  const origin = join(dirname(project), `${name}-origin.git`);
  await execFileAsync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  await execFileAsync("git", ["-C", project, "remote", "add", "origin", origin]);
  await execFileAsync("git", ["-C", project, "push", "-q", "-u", "origin", "main"]);
  const advance = async (msg: string) => {
    const other = join(dirname(project), `${name}-other`);
    await execFileAsync("git", ["clone", "-q", origin, other]);
    await execFileAsync("git", ["-C", other, "config", "user.email", "e2e@ancientvoid.local"]);
    await execFileAsync("git", ["-C", other, "config", "user.name", "ancientvoid e2e"]);
    await execFileAsync("git", ["-C", other, "commit", "-q", "--allow-empty", "-m", msg]);
    await execFileAsync("git", ["-C", other, "push", "-q", "origin", "main"]);
    await execFileAsync("rm", ["-rf", other]);
  };
  return { advance };
}

test.describe("Session: Main-Sync-Indikator und Menü (EPIC-P67 T67.8)", () => {
  test("Hinweis erscheint bei Rückstand; Prüfen nennt Stand; Einmischen holt auf und der Hinweis verschwindet", async ({ app, hub }) => {
    const { advance } = await withOrigin(hub.alpha, "mainsync");
    const id = await hub.createSession({ adapter: "dummy", project: hub.alpha, prompt: "arbeite", workspaceMode: "worktree" });
    // Gating AC-P67-6: Einmischen erst auf wartender Session — erst idle abwarten
    await hub.until(async () => ((await hub.api<{ status: string }[]>(`/api/sessions`)).body.find((s) => (s as { id?: string }).id === id)?.status ?? "") === "idle", "session idle");

    // origin vorrücken — der Session-Worktree läuft jetzt hinterher
    await advance("neuer-stand");

    await app.goto(`${hub.origin}/#/sessions/${id}`);
    const badge = app.getByTestId("mainsync-behind");
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText(/1 hinter main/);

    // Menü (⋯) trägt die Aktionen — 44-px-Ziel, P63-Baustein-Regel
    await app.locator(".session-menu summary").click();
    const menu = app.getByTestId("mainsync-menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByText(/zuletzt abgeglichen: nie/)).toBeVisible();

    // Prüfen: Probelauf sauber, Stand im Klartext
    await menu.getByRole("button", { name: "Main prüfen" }).click();
    await expect(app.getByTestId("mainsync-result")).toHaveText(/1 hinter origin\/main · Probelauf sauber/);

    // Einmischen: Fast-Forward, Hinweis verschwindet, Abgleich-Stand gesetzt
    await menu.getByRole("button", { name: "Main einmischen" }).click();
    await expect(app.getByTestId("mainsync-result")).toHaveText(/eingemischt/);
    await expect(badge).toHaveCount(0);
    await expect(menu.getByText(/zuletzt abgeglichen:/)).not.toHaveText(/nie/);
  });

  test("ADR-0102: Badge-Klick mischt main ein — Konflikt gunsten der Session gelöst, im Modal sichtbar", async ({ app, hub }) => {
    const { advance } = await withOrigin(hub.alpha, "mainsyncbadge");
    const id = await hub.createSession({ adapter: "dummy", project: hub.alpha, prompt: "arbeite", workspaceMode: "worktree" });
    await idleSession(hub, id);
    // Session-Seite der gemeinsamen Datei committen — der spätere Vorlauf von
    // origin/main auf dieselbe Datei ergibt einen echten Konflikt.
    const wt = join(hub.dataDir, "worktrees", id);
    await execFileAsync("git", ["-C", wt, "config", "user.email", "e2e@ancientvoid.local"]);
    await execFileAsync("git", ["-C", wt, "config", "user.name", "ancientvoid e2e"]);
    await writeFile(join(wt, "gemeinsam.txt"), "session\n");
    await execFileAsync("git", ["-C", wt, "add", "-A"]);
    await execFileAsync("git", ["-C", wt, "commit", "-q", "-m", "session-seite"]);
    await advance("origin-seite");
    // origin hat die Datei anders geändert — Konflikt beim Einmischen.
    const other = join(dirname(hub.alpha), "mainsyncbadge-konflikt");
    const origin = join(dirname(hub.alpha), "mainsyncbadge-origin.git");
    await execFileAsync("git", ["clone", "-q", origin, other]);
    await writeFile(join(other, "gemeinsam.txt"), "origin\n");
    await execFileAsync("git", ["-C", other, "add", "-A"]);
    await execFileAsync("git", ["-C", other, "commit", "-q", "-m", "origin-seite-datei"]);
    await execFileAsync("git", ["-C", other, "push", "-q", "origin", "main"]);
    await execFileAsync("rm", ["-rf", other]);

    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByTestId("mainsync-behind").click();
    const modal = app.getByTestId("mainsync-modal");
    await expect(modal).toBeVisible();
    await expect(app.getByTestId("mainsync-steps")).toBeVisible();
    // Erfolg: eingemischt, Konflikt automatisch gunsten der Session gelöst und benannt.
    await expect(app.getByTestId("mainsync-modal-result")).toContainText(/eingemischt/);
    await expect(app.getByTestId("mainsync-modal-result")).toContainText(/Automatisch gunsten der Session gelöst: gemeinsam\.txt/);
    await modal.getByRole("button", { name: "Schließen" }).click();
    await expect(app.getByTestId("mainsync-modal")).toHaveCount(0);
    // Der Rückstand ist weg — die Session gewinnt den Konflikt-Hunk.
    await expect(app.getByTestId("mainsync-behind")).toHaveCount(0);
    const { stdout: inhalt } = await execFileAsync("git", ["-C", wt, "show", "HEAD:gemeinsam.txt"]);
    expect(inhalt).toBe("session\n");
  });

  test("Layout-Beweis mobil (390 px): Hinweis überdeckt weder Titel noch Status, alles im Kopf-Rand", async ({ app, hub }) => {
    const { advance } = await withOrigin(hub.beta, "mainsyncbeta");
    const id = await hub.createSession({ adapter: "dummy", project: hub.beta, prompt: "arbeite", workspaceMode: "worktree" });
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "assistant"), "first answer");
    await advance("noch-neuer");
    await app.setViewportSize({ width: 390, height: 800 });
    await app.goto(`${hub.origin}/#/sessions/${id}`);

    const badge = app.getByTestId("mainsync-behind");
    await expect(badge).toBeVisible();
    const geo = await badge.evaluate((el) => {
      const b = el.getBoundingClientRect();
      const head = el.closest(".session-top")?.getBoundingClientRect() ?? document.body.getBoundingClientRect();
      const meta = el.closest(".session-top-meta")?.getBoundingClientRect();
      // Überdeckung: liegt unter der Badge-Mitte ein anderes Element als die Badge selbst?
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, headRight: head.right, metaBottom: meta?.bottom ?? -1, hitIsSelfOrChild: !!hit && (hit === el || el.contains(hit)) };
    });
    expect(geo.right).toBeLessThanOrEqual(geo.headRight + 1);
    expect(geo.bottom).toBeLessThanOrEqual(geo.metaBottom + 1);
    expect(geo.hitIsSelfOrChild).toBe(true);
  });

  /** BUG-0219: Die Abfrage gehört zur Auswahl — Session-Wechsel, Kachelfokus
   * und Rückkehr zur offenen Ansicht stellen sie jeweils neu. */
  const idleSession = (hub: TestHub, id: string) => hub.until(async () => ((await hub.api<{ status: string }[]>(`/api/sessions`)).body.find((s) => (s as { id?: string }).id === id)?.status ?? "") === "idle", `session ${id} idle`);

  test("BUG-0219: Projektwechsel über die Übersicht zeigt den Stand der gewählten Session", async ({ app, hub }) => {
    const a = await withOrigin(hub.alpha, "wela");
    const b = await withOrigin(hub.beta, "welb");
    const idA = await hub.createSession({ adapter: "dummy", project: hub.alpha, prompt: "arbeite", workspaceMode: "worktree" });
    const idB = await hub.createSession({ adapter: "dummy", project: hub.beta, prompt: "arbeite", workspaceMode: "worktree" });
    await idleSession(hub, idA);
    await idleSession(hub, idB);
    await a.advance("a-1");
    await b.advance("b-1");
    await b.advance("b-2");

    await app.goto(`${hub.origin}/#/sessions/${idB}`);
    await expect(app.getByTestId("mainsync-behind")).toHaveText(/2 hinter main/);
    await app.getByRole("button", { name: "Zur Übersicht" }).click();
    await expect(app.getByRole("heading", { name: "AncientVoid", exact: true })).toBeVisible();
    await app.locator(".session-card", { hasText: "alpha" }).first().locator(".session-open").click();
    await expect(app.getByTestId("mainsync-behind")).toHaveText(/1 hinter main/);
  });

  test("BUG-0219: Kachelfokus fragt neu — ausgewähltes Projekt zeigt seinen aktuellen Stand @desktop", async ({ app, hub, isMobile }) => {
    test.skip(isMobile, "Kachelfokus braucht das Desktop-Projekt (breites Layout)");
    const a = await withOrigin(hub.alpha, "foka");
    const b = await withOrigin(hub.beta, "fokb");
    const idA = await hub.createSession({ adapter: "dummy", project: hub.alpha, prompt: "arbeite", workspaceMode: "worktree" });
    const idB = await hub.createSession({ adapter: "dummy", project: hub.beta, prompt: "arbeite", workspaceMode: "worktree" });
    await idleSession(hub, idA);
    await idleSession(hub, idB);
    await a.advance("a-1");
    await b.advance("b-1");
    await b.advance("b-2");
    await b.advance("b-3");

    await app.goto(`${hub.origin}/#/sessions/${idB}`);
    const betaBadge = app.locator('[data-tile="1"]').getByTestId("mainsync-behind");
    await expect(betaBadge).toHaveText(/3 hinter main/);
    await enableAutoTiling(app);
    // Anderes Projekt auswählen: alpha in einer zweiten Kachel (Strg-Klick)
    await app.locator(".session-card", { hasText: "alpha" }).first().locator(".session-open").click({ modifiers: ["Control"] });
    await expect(app.locator('[data-tile="2"]').getByTestId("mainsync-behind")).toHaveText(/1 hinter main/);
    // Beta-Remote rückt weiter vor — Kachel 1 weiß es nur, wenn die Auswahl neu fragt
    await b.advance("b-4");
    await app.locator('[data-tile="1"]').click({ position: { x: 8, y: 8 } });
    await expect(betaBadge).toHaveText(/4 hinter main/);
  });

  test("BUG-0219: Rückkehr zur offenen Session-Ansicht fragt neu (Sichtbarkeit)", async ({ app, hub }) => {
    const b = await withOrigin(hub.beta, "visb");
    const idB = await hub.createSession({ adapter: "dummy", project: hub.beta, prompt: "arbeite", workspaceMode: "worktree" });
    await idleSession(hub, idB);
    await b.advance("b-1");
    await b.advance("b-2");

    await app.goto(`${hub.origin}/#/sessions/${idB}`);
    const badge = app.getByTestId("mainsync-behind");
    await expect(badge).toHaveText(/2 hinter main/);
    await b.advance("b-3");
    // Echter Sichtbarkeitswechsel: Playwright-Seiten bleiben beim Seitenwechsel
    // „visible“, deshalb das Ereignis auf der echten Seite versenden.
    await app.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(badge).toHaveText(/3 hinter main/);
  });
});
