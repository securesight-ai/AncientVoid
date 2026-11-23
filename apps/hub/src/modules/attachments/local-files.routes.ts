import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { MAX_ATTACHMENT_BYTES } from "@ancientvoid/contracts";
import { basename, extname, isAbsolute } from "node:path";

/**
 * Nutzerfund 2026-11-23: Bild-Einfügen klappt am Windows-PC, aber nicht unter
 * Linux/Wayland. Grund: Chromium sieht unter Wayland die Bild-Zwischenablage oft
 * nicht (`clipboardData.files` bleibt leer), während Datei-Manager (Nautilus,
 * Dolphin, Thunar) beim Kopieren eines Bildes einen **Pfad** in die Zwischenablage
 * legen (`text/uri-list`). Der Browser kann die Datei nicht lesen — der Hub auf
 * demselben Rechner schon.
 *
 * Diese Route liefert die Bytes einer Bilddatei auf der Maschine des Hubs, damit
 * die PWA daraus eine ganz normale Datei macht und der bestehende Anhang-Pfad
 * (Hochladen, OCR, Fehleranzeige) unverändert genutzt wird.
 *
 * Grenzen, bewusst eng:
 * - nur absolute Pfade, nur innerhalb der konfigurierten `projectRoots`
 *   (realpfad-bereinigt, Symlinks folgen also nicht nach draußen)
 * - nur echte Bilddateien: Endung **und** Magic Bytes müssen passen
 * - Größe wie beim Upload (MAX_ATTACHMENT_BYTES)
 * - eigene Policy-Operation `files.readLocal`: Mensch auf diesem Hub, sonst niemand
 *   (die Route ist bewusst **nicht** flotten-routbar — ein fremder Hub darf keine
 *   Pfade auf dieser Maschine wählen)
 */
const BILD_ENDUNGEN = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"]);

/** Magic Bytes — die Endung allein ist eine Behauptung, dieser Check ist der Beweis. */
function bildTyp(bytes: Buffer): string | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes.subarray(1, 4).toString("ascii") === "PNG") return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) return "image/gif";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (bytes.length >= 2 && bytes.subarray(0, 2).toString("ascii") === "BM") return "image/bmp";
  return null;
}

export function registerLocalFileRoutes(app: FastifyInstance, deps: { projectRoots: string[] }): void {
  app.post("/api/local-files/bytes", async (req, reply) => {
    const eingabe = z.object({ path: z.string().min(1).max(4096) }).safeParse(req.body);
    if (!eingabe.success) return reply.code(400).send({ error: "pfad fehlt" });
    if (deps.projectRoots.length === 0) {
      return reply.code(501).send({ error: "Dieser Hub hat keine erlaubten Ordner (projectRoots ist leer)." });
    }

    let pfad = eingabe.data.path.trim();
    if (pfad.startsWith("file://")) {
      try {
        pfad = decodeURIComponent(pfad.slice(7));
      } catch {
        return reply.code(400).send({ error: "uri-list-Pfad ist kaputt" });
      }
    }
    if (!isAbsolute(pfad)) return reply.code(400).send({ error: "nur absolute Pfade" });

    const { realpath, stat, readFile } = await import("node:fs/promises");
    let echt: string;
    try {
      echt = await realpath(pfad);
    } catch {
      return reply.code(404).send({ error: "Datei nicht gefunden" });
    }

    let erlaubt = false;
    for (const wurzel of deps.projectRoots) {
      try {
        const echteWurzel = await realpath(wurzel);
        if (echt === echteWurzel || echt.startsWith(`${echteWurzel}/`)) {
          erlaubt = true;
          break;
        }
      } catch {
        // Konfigurierte Wurzel existiert nicht — weiter.
      }
    }
    if (!erlaubt) {
      return reply.code(403).send({ error: `Die Datei liegt außerhalb der erlaubten Ordner (${deps.projectRoots.join(", ")}).` });
    }

    const endung = extname(echt).toLowerCase();
    if (!BILD_ENDUNGEN.has(endung)) return reply.code(415).send({ error: `Nur Bilddateien, nicht ${endung || "ohne Endung"}.` });

    const infos = await stat(echt);
    if (!infos.isFile()) return reply.code(400).send({ error: "kein(e) Datei" });
    if (infos.size === 0) return reply.code(400).send({ error: "Leere Datei." });
    if (infos.size > MAX_ATTACHMENT_BYTES) return reply.code(413).send({ error: `Bild größer als ${Math.floor(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB.` });

    const bytes = await readFile(echt);
    const typ = bildTyp(bytes);
    if (!typ) return reply.code(415).send({ error: "Die Datei ist kein Bild, obwohl die Endung es behauptet." });

    return reply
      .type(typ)
      .header("content-disposition", `inline; filename*=UTF-8''${encodeURIComponent(basename(echt))}`)
      .header("x-content-type-options", "nosniff")
      .send(bytes);
  });
}
