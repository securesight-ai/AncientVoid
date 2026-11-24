import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, sessionTab, hostedRunner } from "../support/fixtures.ts";
import { manifestProject } from "../support/workspace-project.ts";

/**
 * EPIC-P29 T29.7: die Workspace-Runtime als echter Ablauf — Start → Freigabe
 * → Fehler → Retry → bereit → Preview → Neustart (K7) → Archivieren; dazu
 * manifestloser Start und P26-Beobachter als Regression, Offline-Zeitstempel
 * (K10) und der Restore-Messlauf (AC-P29-4/6).
 */

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

const PREPARE_JS = `const fs = require('fs');
// Erster Lauf: Marke schreiben und laut scheitern (menschlicher Retry nötig),
// zweiter Lauf: Marke vorhanden -> Erfolg.
if (fs.existsSync('marke')) { console.log('zweiter Lauf'); process.exit(0); }
fs.writeFileSync('marke', 'x');
process.exit(1);
`;

const SVC_JS = `require('http').createServer((q, r) => {
  // Preview wie ein echter Dev-Server: HTML (Chromiums eingebaute JSON-
  // Anzeige wirft in sandboxed iframes Konsolenfehler, HTML nicht).
  r.setHeader('content-type', 'text/html; charset=utf-8');
  r.end('<pre>sid=' + process.env.ANCIENTVOID_WORKSPACE_SESSION_ID + ' url=' + q.url + '</pre>');
}).listen(Number(process.env.ANCIENTVOID_WORKSPACE_PORT), '127.0.0.1');
`;

/** Projektdateien des vollen Manifests; `.env` bleibt ungetrackt (Include-Fall). */
const FULL_FILES = { ".gitignore": ".env\n", ".env": "KEY=e2e-wert\n", "prepare.js": PREPARE_JS, "svc.js": SVC_JS } as const;

const FULL_MANIFEST = {
  schemaVersion: 1,
  include: [".env"],
  setup: [{ id: "vorbereiten", argv: ["node", "prepare.js"], timeoutMs: 20_000 }],
  services: [{ id: "web", argv: ["node", "svc.js"], readiness: { path: "/", timeoutMs: 15_000 } }],
};

interface WorkspaceEvent {
  seq: number;
  type: string;
  payload: { kind?: string; [key: string]: unknown };
}

const workspaceEvents = (events: { seq: number; type: string; payload: Record<string, unknown> }[]): WorkspaceEvent[] =>
  events.filter((e) => typeof (e.payload as { kind?: unknown }).kind === "string" && String((e.payload as { kind?: unknown }).kind).startsWith("workspace.")) as WorkspaceEvent[];

test.describe("EPIC-P29: Workspace-Runtime (T29.7)", () => {
  test("Start → Freigabe → Fehler → Retry → bereit → Preview → Neustart → Archivieren", async ({ app, hub }) => {
    test.setTimeout(180_000);
    const project = manifestProject(hub, "ws-projekt", FULL_MANIFEST, FULL_FILES);
    const id = await hub.createSession({ adapter: "opencode", prompt: "Umgebung hochziehen", project });

    // Freigabe über die echte Approval-Queue (Mensch via API, ADR-0021/0019).
    let approvalId = "";
    await hub.until(async () => {
      const pending = await hub.api<{ id: string; sessionId: string; action: string }[]>("/api/approvals?status=pending");
      approvalId = pending.body.find((a) => a.sessionId === id && a.action === "workspace.setup")?.id ?? "";
      return approvalId !== "";
    }, "workspace.setup-Freigabe liegt vor");
    expect((await hub.api(`/api/approvals/${approvalId}/decide`, { body: { decision: "approve" } })).status).toBe(200);

    // Erster Setup-Lauf scheitert bewusst (Exit 1) — Phase failed, mit Schritt.
    await hub.until(async () => (await hub.api<{ phase: string }>(`/api/sessions/${id}/workspace`)).body.phase === "failed", "Setup scheitert");
    const failed = (await hub.api<{ phase: string; failure?: { step: string; kind: string; exitCode?: number } }>(`/api/sessions/${id}/workspace`)).body;
    expect(failed.failure).toMatchObject({ step: "vorbereiten", kind: "exit", exitCode: 1 });

    // UI: Umgebung zeigt den Fehler, der Mensch retryt (AC-P29-3).
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await sessionTab(app, "Umgebung");
    await expect(app.locator(".workspace-runtime .ws-phase-failed")).toBeVisible();
    await expect(app.locator(".ws-failure")).toContainText("vorbereiten");
    await app.getByRole("button", { name: /Setup wiederholen/ }).click();
    await expect(app.locator(".workspace-runtime .ws-phase-ready")).toBeVisible({ timeout: 30_000 });
    await expect(app.locator(".ws-service", { hasText: "web" }).locator(".pill", { hasText: "bereit" })).toBeVisible({ timeout: 20_000 });

    // Include lag vor dem Setup im Worktree (AC-P29-2-Vorbedingung, T29.3-Flow).
    expect(existsSync(join(hub.dataDir, "worktrees", id, ".env"))).toBe(true);
    expect(existsSync(join(hub.dataDir, "worktrees", id, "marke"))).toBe(true);

    // Preview: Ticket holen, Proxy liefert genau DIESE Workspace-ID (AC-P29-1).
    const ticket = (await hub.api<{ ticket: string }>(`/api/sessions/${id}/workspace/services/web/preview-ticket`, { body: {} })).body;
    const preview = await fetch(`${hub.origin}/api/sessions/${id}/workspace/services/web/proxy/?ticket=${encodeURIComponent(ticket.ticket)}`);
    expect(preview.status).toBe(200);
    const previewBody = await preview.text();
    expect(previewBody.startsWith("<pre>sid=")).toBe(true);
    expect(previewBody).toContain(`sid=${id}`);
    // … und in der UI als sandboxed iframe eingebettet.
    await app.getByRole("button", { name: /Preview öffnen/ }).click();
    const frame = app.locator(".ws-preview iframe");
    await expect(frame).toBeVisible();
    await expect(frame).toHaveAttribute("src", /\/proxy\/\?ticket=/);

    // K5: kein workspace.*-Event über 4 KB (AC-P29-4).
    for (const event of workspaceEvents(await hub.events(id))) {
      expect(JSON.stringify(event.payload).length, `Event #${event.seq}`).toBeLessThan(4096);
    }

    // Neustart (K7): Projection sofort, kein zusätzliches Setup durch den
    // Restart (der Retry vorher WAR ein zweiter, gewollter Lauf), adoptierter Dienst.
    const preparingsBeforeRestart = workspaceEvents(await hub.events(id)).filter((e) => e.payload.kind === "workspace.preparing").length;
    expect(preparingsBeforeRestart).toBe(2); // Initial-Lauf (scheiterte) + menschlicher Retry
    const restartStart = Date.now();
    await hub.restart();
    await hub.until(async () => (await hub.api<{ phase: string }>(`/api/sessions/${id}/workspace`)).body.phase === "ready", "Projection nach Neustart");
    const restoredMs = Date.now() - restartStart;
    await hub.until(async () => {
      const status = (await hub.api<{ services: { state: string }[] }>(`/api/sessions/${id}/workspace`)).body;
      return status.services.every((s) => s.state === "ready");
    }, "adoptierter Dienst wieder ready");
    const preparings = workspaceEvents(await hub.events(id)).filter((e) => e.payload.kind === "workspace.preparing");
    expect(preparings, "kein zusätzliches Setup durch den Neustart").toHaveLength(preparingsBeforeRestart);
    const afterRestart = await fetch(`${hub.origin}/api/sessions/${id}/workspace/services/web/proxy/`, { headers: { authorization: `Bearer ${hub.token}` } });
    expect((await afterRestart.text())).toContain(`sid=${id}`);

    // Archivieren mit ungesicherter Arbeit: Dienste stoppen, der dirty
    // Worktree bleibt auffindbar (AC-P29-5, P14 bleibt Löschbarriere).
    // Committen würde ihn NICHT freigeben — Commits sind Arbeit (ADR-0016
    // apply); der „sauber weg"-Fall steht im Restore-Messlauf unten und in
    // den Core-Tests (archive-workspace.test.ts).
    expect((await hub.api(`/api/sessions/${id}/archive`, { body: { archived: true } })).status).toBe(200);
    await hub.until(async () => {
      const status = (await hub.api<{ services: { state: string }[] }>(`/api/sessions/${id}/workspace`)).body;
      return status.services.every((s) => s.state === "stopped");
    }, "Dienste nach Archiv gestoppt");
    expect(existsSync(join(hub.dataDir, "worktrees", id))).toBe(true); // marke/.env = Arbeit
    expect(workspaceEvents(await hub.events(id)).map((e) => e.payload.kind)).not.toContain("workspace.archived");
    expect((await hub.events(id)).some((e) => (e.payload as { kind?: string }).kind === "session.worktree_kept")).toBe(true);

    // Restore-Zeit notieren (Messlauf-Beleg, siehe docs/messlauf/).
    mkdirSync("test-results", { recursive: true });
    writeFileSync("test-results/messlauf-p29-restore.json", JSON.stringify({ sessionId: id, restoredMs, ts: new Date().toISOString() }, null, 2));
    expect(restoredMs, "K7: Projectionen nach Hard-Kill < 3 s wieder da").toBeLessThan(3_000);
  });

  test("manifestloser Start: alter Ablauf, kein Workspace-Status, keine Events (Migrationsregel)", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "ohne Manifest", project: hub.alpha });
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "idle");
    expect((await hub.api(`/api/sessions/${id}/workspace`)).status).toBe(404);
    const events = workspaceEvents(await hub.events(id));
    expect(events.filter((e) => !e.payload.kind?.startsWith("workspace.main_sync_"))).toHaveLength(0);
    // Die Session bleibt normal steuerbar — kein Warten, keine Sperre.
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.getByPlaceholder("Antworten…")).toBeVisible();
    // Kleinkram-Regel 2 (Umgebungs-Fix 2026-11-24): Nachweislich kein Workspace
    // (Anfang geladen, kein workspace.*-Event) → kein „Umgebung“ unter „Mehr“.
    const bar = app.locator(".subtabs-wrap").first();
    await bar.locator('[aria-haspopup="menu"]').click();
    const menu = app.getByRole("menu", { name: "Weitere Ansichten" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Umgebung", exact: true })).toHaveCount(0);
  });

  test("P26-Regression: Loop-Session im Manifest-Projekt bekommt keinen Workspace", async ({ hub }) => {
    // Der Loop arbeitet im Projekt selbst (kein Worktree) — ein zweites
    // Setup darf dadurch nie ausgelöst werden (ADR-0051 §8). Der fake-loop
    // kennt nur Line „alpha“, deshalb liegt das Manifest hier direkt in alpha.
    const alphaManifest = join(hub.alpha, "ancientvoid.workspace.json");
    writeFileSync(alphaManifest, JSON.stringify(FULL_MANIFEST));
    git(hub.alpha, "-c", "user.email=e2e@ancientvoid.local", "-c", "user.name=e2e", "add", "-A");
    git(hub.alpha, "-c", "user.email=e2e@ancientvoid.local", "-c", "user.name=e2e", "commit", "-q", "-m", "manifest");
    const res = await hub.api<{ id: string }>("/api/sessions", {
      body: { loop: { id: "fake-loop", options: { line: "alpha" } }, prompt: "beobachten", project: hub.alpha },
    });
    expect(res.status).toBe(201);
    const id = res.body.id;
    const [record] = await hub.sessions();
    expect(record?.adapter).toBe("loop:fake-loop");
    await hub.until(async () => (await hub.events(id)).length > 0, "Loop-Events");
    expect(workspaceEvents(await hub.events(id))).toHaveLength(0);
    const detail = (await hub.api<{ worktreeSha: string | null }>(`/api/sessions/${id}`)).body;
    expect(detail.worktreeSha).toBeNull();
    const pending = await hub.api<{ sessionId: string; action: string }[]>("/api/approvals?status=pending");
    expect(pending.body.filter((a) => a.sessionId === id)).toHaveLength(0);
  });

  test("Offline (K10): Umgebung zeigt den letzten Stand mit seiner Zeit", async ({ app, hub }) => {
    const project = manifestProject(hub, "ws-offline", FULL_MANIFEST, FULL_FILES);
    const id = await hub.createSession({ adapter: "opencode", prompt: "offline-fall", project });
    let approvalId = "";
    await hub.until(async () => {
      const pending = await hub.api<{ id: string; sessionId: string; action: string }[]>("/api/approvals?status=pending");
      approvalId = pending.body.find((a) => a.sessionId === id && a.action === "workspace.setup")?.id ?? "";
      return approvalId !== "";
    }, "Freigabe liegt vor");
    await hub.api(`/api/approvals/${approvalId}/decide`, { body: { decision: "approve" } });
    await hub.until(async () => (await hub.api<{ phase: string }>(`/api/sessions/${id}/workspace`)).body.phase === "failed", "failed (erster Lauf)");

    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await sessionTab(app, "Umgebung");
    await expect(app.locator(".workspace-runtime .ws-phase-failed")).toBeVisible();

    // Offline während der Ansicht: aktualisieren scheitert, der letzte Stand
    // bleibt mit seiner Uhrzeit sichtbar — nie ein vorgetäuschtes "jetzt" (K10).
    await app.context().setOffline(true);
    try {
      await app.getByRole("button", { name: "Aktualisieren" }).click();
      const stand = app.locator(".workspace-head .stand.offline");
      await expect(stand).toBeVisible();
      const shown = (await stand.textContent()) ?? "";
      expect(shown).toContain("offline");
      expect(/\d{2}:\d{2}:\d{2}/.test(shown), `Zeit im Stand: "${shown}"`).toBe(true);
      // Der alte Stand bleibt lesbar, nicht leer:
      await expect(app.locator(".workspace-runtime .ws-phase-failed")).toBeVisible();
    } finally {
      await app.context().setOffline(false);
    }
  });

  test("Restore-Messlauf (K7): 10 Workspace-Sessions, 3 Neustarts, Projectionen unter 3 s", async ({ hub }) => {
    test.skip(hostedRunner, "BUG-0163: Restore-Messlatte misst lokale Hardware");
    test.setTimeout(240_000);
    const project = manifestProject(hub, "ws-messung", { schemaVersion: 1 });
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) ids.push(await hub.createSession({ adapter: "opencode", prompt: `Messlauf ${i}`, project }));
    for (const sessionId of ids) {
      let approvalId = "";
      await hub.until(async () => {
        const pending = await hub.api<{ id: string; sessionId: string; action: string }[]>("/api/approvals?status=pending");
        approvalId = pending.body.find((a) => a.sessionId === sessionId && a.action === "workspace.setup")?.id ?? "";
        return approvalId !== "";
      }, `Freigabe ${sessionId}`);
      expect((await hub.api(`/api/approvals/${approvalId}/decide`, { body: { decision: "approve" } })).status).toBe(200);
    }
    await hub.until(async () => {
      for (const sessionId of ids) {
        const status = (await hub.api<{ phase: string }>(`/api/sessions/${sessionId}/workspace`)).body;
        if (status.phase !== "ready") return false;
      }
      return true;
    }, "alle 10 bereit", 60_000);

    const runs: { restartMs: number; slowestSessionMs: number }[] = [];
    for (let round = 0; round < 3; round++) {
      const t0 = Date.now();
      await hub.restart();
      let slowest = 0;
      for (const sessionId of ids) {
        const s0 = Date.now();
        await hub.until(async () => (await hub.api<{ phase: string }>(`/api/sessions/${sessionId}/workspace`)).body.phase === "ready", `Projection ${sessionId}`, 15_000);
        slowest = Math.max(slowest, Date.now() - s0);
      }
      runs.push({ restartMs: Date.now() - t0, slowestSessionMs: slowest });
      // Kein Session-Setup läuft erneut (P26/AC-P29-4).
      for (const sessionId of ids) {
        const preparings = workspaceEvents(await hub.events(sessionId)).filter((e) => e.payload.kind === "workspace.preparing");
        expect(preparings, `${sessionId} Runde ${round}`).toHaveLength(1);
      }
    }
    const medians = runs.map((r) => r.restartMs).sort((a, b) => a - b)[Math.floor(runs.length / 2)]!;
    mkdirSync("test-results", { recursive: true });
    writeFileSync("test-results/messlauf-p29-restore-10.json", JSON.stringify({ sessions: ids.length, runs, medianRestartMs: medians, ts: new Date().toISOString() }, null, 2));
    expect(medians, "K7: Restore mit 10 Workspaces im Median < 3 s").toBeLessThan(3_000);

    // AC-P29-5: diese Workspaces sind sauber (kein Setup-Schritt, kein
    // Include) — Archivieren entfernt sie wirklich und feuert workspace.archived.
    for (const sessionId of ids) {
      expect((await hub.api(`/api/sessions/${sessionId}/archive`, { body: { archived: true } })).status).toBe(200);
    }
    await hub.until(async () => ids.every((sessionId) => !existsSync(join(hub.dataDir, "worktrees", sessionId))), "saubere Worktrees entfernt", 30_000);
    for (const sessionId of ids.slice(0, 3)) {
      expect(workspaceEvents(await hub.events(sessionId)).map((e) => e.payload.kind)).toContain("workspace.archived");
    }
  });
});
