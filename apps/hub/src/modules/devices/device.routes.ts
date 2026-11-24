import { readFileSync } from "node:fs";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AttachmentId, DeviceActionInput, DeviceAvdCreateInput, DeviceTestCase } from "@ancientvoid/contracts";
import { DeviceError } from "@ancientvoid/core";
import type { RouteContext } from "../../route-context.ts";

/**
 * EPIC-P42 (ADR-0067): Android-Testgeräte. Alles Schreibende (Start/Stop/Lease/Eingabe/Installation/Tests) ist
 * Menschen-Eingabe — Agent-Tokens (Gateway-Entscheidung `approve`) bekommen 403, wie beim Browser-Arbeitsplatz.
 * Frames/Logs/Bäume sind Byte-Antworten mit Grenzen, nie Events (K5). Der Dienst ist lokal (nicht FLEET_ROUTABLE).
 */
const HTTP: Record<string, number> = { unavailable: 503, not_found: 404, quota: 429, busy: 409, conflict: 409, blocked: 403, failed: 502 };

const SERIAL = /^[A-Za-z0-9._:-]{1,120}$/;

export function registerDeviceRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { deps, callerLabel } = ctx;
  const devices = deps.devices;
  if (!devices) {
    app.get("/api/devices", async (_req, reply) => reply.code(501).send({ error: "Die Android-Testgeräte sind auf diesem Hub nicht eingerichtet." }));
    return;
  }

  const humanOnly = (req: FastifyRequest, reply: FastifyReply): boolean => {
    if (req.policy?.decision === "approve") {
      void reply.code(403).send({ error: "Die Android-Testgeräte sind eine menschliche Bedienung." });
      return false;
    }
    return true;
  };
  const fail = (reply: FastifyReply, err: unknown) => {
    if (err instanceof DeviceError) return reply.code(HTTP[err.code] ?? 500).send({ error: err.message, code: err.code });
    throw err;
  };
  const serialOf = (req: FastifyRequest, reply: FastifyReply): string | null => {
    const { serial } = req.params as { serial: string };
    if (!SERIAL.test(serial)) {
      void reply.code(400).send({ error: "ungültige Serial" });
      return null;
    }
    return serial;
  };
  const sessionOrNull = (req: FastifyRequest): string | null => {
    const id = (req.body as { sessionId?: unknown } | null)?.sessionId;
    return typeof id === "string" && id.length > 0 && id.length <= 128 && id !== "null" ? id : null;
  };

  app.get("/api/devices", async () => devices.status());

  // ---- In-App-Setup (2026-11-24): kompletter Simulator-Setup-Ablauf aus der PWA -------------------------------

  app.get("/api/devices/setup", async () => devices.setup.status());

  app.post("/api/devices/setup", async (req, reply) => {
    if (!humanOnly(req, reply)) return;
    const sdkRoot = (req.body as { sdkRoot?: unknown } | null)?.sdkRoot;
    if (typeof sdkRoot !== "string" || sdkRoot.trim().length < 1 || sdkRoot.length > 4096) return reply.code(400).send({ error: "sdkRoot (absoluter Zielordner) erforderlich" });
    const started = await devices.setup.start(sdkRoot.trim());
    if (!started.started) {
      const busy = started.status.state === "running";
      return reply.code(busy ? 409 : 400).send({ error: busy ? "Setup läuft bereits." : started.status.reason ?? "Setup nicht gestartet.", code: busy ? "busy" : undefined });
    }
    return reply.code(202).send(started.status);
  });

  app.get("/api/devices/images", async () => devices.listImages());

  app.post("/api/devices/avds", async (req, reply) => {
    if (!humanOnly(req, reply)) return;
    const parsed = DeviceAvdCreateInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: `Ungültiger AVD-Auftrag: ${parsed.error.issues[0]?.path.join(".") || "Wurzel"} — ${parsed.error.issues[0]?.message ?? "?"}` });
    try {
      return reply.code(201).send(await devices.createAvd(parsed.data));
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post("/api/devices/start", async (req, reply) => {
    if (!humanOnly(req, reply)) return;
    const avd = (req.body as { avd?: unknown } | null)?.avd;
    if (typeof avd !== "string" || avd.length < 1 || avd.length > 64) return reply.code(400).send({ error: "avd (1–64 Zeichen) erforderlich" });
    try {
      return reply.code(202).send(await devices.startEmulator(avd, sessionOrNull(req)));
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post("/api/devices/stop", async (req, reply) => {
    if (!humanOnly(req, reply)) return;
    const serial = (req.body as { serial?: unknown } | null)?.serial;
    if (typeof serial !== "string" || !SERIAL.test(serial)) return reply.code(400).send({ error: "serial erforderlich" });
    try {
      return await devices.stopEmulator(serial);
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post("/api/devices/lease", async (req, reply) => {
    if (!humanOnly(req, reply)) return;
    const serial = (req.body as { serial?: unknown } | null)?.serial;
    const owner = (req.body as { owner?: unknown } | null)?.owner;
    if (typeof serial !== "string" || !SERIAL.test(serial)) return reply.code(400).send({ error: "serial erforderlich" });
    if (owner !== undefined && (typeof owner !== "string" || owner.length > 120)) return reply.code(400).send({ error: "owner muss ein String ≤ 120 sein" });
    try {
      return await devices.acquireLease(serial, sessionOrNull(req), owner ?? callerLabel(req) ?? "pwa");
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post("/api/devices/release", async (req, reply) => {
    if (!humanOnly(req, reply)) return;
    const body = req.body as { serial?: unknown; generation?: unknown } | null;
    if (typeof body?.serial !== "string" || !SERIAL.test(body.serial) || typeof body.generation !== "number") return reply.code(400).send({ error: "serial und generation erforderlich" });
    try {
      return devices.releaseLease(body.serial, body.generation);
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post("/api/devices/action", async (req, reply) => {
    if (!humanOnly(req, reply)) return;
    const parsed = DeviceActionInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid action input", issues: parsed.error.issues });
    try {
      return await devices.act(parsed.data);
    } catch (err) {
      return fail(reply, err);
    }
  });

  /** Standbild — begrenzt in Rate und Größe, nie als Event. 204, wenn das Gerät kein Bild liefert. */
  app.get("/api/devices/:serial/frame", async (req, reply) => {
    const serial = serialOf(req, reply);
    if (!serial) return;
    const frame = await devices.frame(serial);
    if (!frame) return reply.code(204).send();
    return reply
      .header("content-type", "image/png")
      .header("cache-control", "no-store")
      .header("x-frame-seq", String(frame.seq))
      .header("x-geometry", String(frame.geometryVersion))
      .header("x-frame-width", String(frame.width))
      .header("x-frame-height", String(frame.height))
      .send(frame.data);
  });

  app.get("/api/devices/:serial/logs", async (req, reply) => {
    const serial = serialOf(req, reply);
    if (!serial) return;
    const q = Number((req.query as { bytes?: string }).bytes ?? "");
    try {
      return await devices.logs(serial, Number.isFinite(q) && q > 0 ? q : undefined);
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.get("/api/devices/:serial/tree", async (req, reply) => {
    const serial = serialOf(req, reply);
    if (!serial) return;
    try {
      const tree = await devices.tree(serial);
      return reply.header("content-type", "application/xml").header("cache-control", "no-store").send(tree.xml);
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post("/api/devices/install", async (req, reply) => {
    if (!humanOnly(req, reply)) return;
    const body = req.body as { serial?: unknown; generation?: unknown; attachmentId?: unknown } | null;
    if (typeof body?.serial !== "string" || !SERIAL.test(body.serial) || typeof body.generation !== "number") return reply.code(400).send({ error: "serial und generation erforderlich" });
    const id = AttachmentId.safeParse(body.attachmentId);
    if (!id.success) return reply.code(400).send({ error: "attachmentId (sha256) erforderlich" });
    if (!deps.attachments) return reply.code(501).send({ error: "Attachment-Store nicht eingerichtet." });
    // APK nur aus referenziertem Session-Artefakt: Inhalt ist über die ID (sha256) adressiert und wird vor
    // der Installation erneut gehasht — fremde URL-Downloads gibt es nicht (EPIC-P42 §3.3).
    const resolved = await deps.attachments.resolve([id.data]);
    const apk = resolved.find((a) => a.name.toLowerCase().endsWith(".apk") || a.mimeType === "application/vnd.android.package-archive");
    if (!apk) return reply.code(400).send({ error: "Artefakt ist kein APK (.apk bzw. application/vnd.android.package-archive)." });
    try {
      return await devices.installApk(body.serial, body.generation, apk.path, apk.id);
    } catch (err) {
      return fail(reply, err);
    }
  });

  // ---- Testläufe -----------------------------------------------------------------------------------------------
  app.get("/api/devices/tests", async (req) => {
    const serial = (req.query as { serial?: string }).serial ?? "";
    return { runs: devices.listTests(SERIAL.test(serial) ? serial : "") };
  });

  app.post("/api/devices/tests", async (req, reply) => {
    if (!humanOnly(req, reply)) return;
    const parsed = DeviceTestCase.safeParse((req.body as { test?: unknown } | null)?.test);
    if (!parsed.success) return reply.code(400).send({ error: "invalid test case", issues: parsed.error.issues });
    try {
      return reply.code(202).send(await devices.runTest(parsed.data, sessionOrNull(req)));
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post("/api/devices/tests/:runId/abort", async (req, reply) => {
    if (!humanOnly(req, reply)) return;
    const { serial } = req.body as { serial?: unknown };
    const { runId } = req.params as { runId: string };
    if (typeof serial !== "string" || !SERIAL.test(serial)) return reply.code(400).send({ error: "serial erforderlich" });
    return devices.abortTest(serial, runId) ? { ok: true } : reply.code(404).send({ error: "Kein laufender Test mit dieser ID." });
  });

  app.get("/api/devices/tests/:runId/artifact", async (req, reply) => {
    const { runId } = req.params as { runId: string };
    const serial = (req.query as { serial?: string }).serial ?? "";
    const file = devices.artifactPath(SERIAL.test(serial) ? serial : "", runId);
    if (!file) return reply.code(404).send({ error: "Kein Artefakt (Quota oder Lauf ohne Screenshot)." });
    return reply.header("content-type", "image/png").header("cache-control", "no-store").send(readFileSync(file));
  });
}
