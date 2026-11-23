import { describe, expect, it } from "vitest";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { attachmentKind } from "@ancientvoid/contracts";
import { extractText, officeText } from "../../../src/modules/attachments/extract.ts";
import { AttachmentStore } from "../../../src/modules/attachments/store.ts";
import { HubDatabase } from "../../../src/platform/db.ts";

const fixtures = fileURLToPath(new URL("../../fixtures/attachments/", import.meta.url));
const tessdata = join(homedir(), ".local/share/ancientvoid/tessdata");
const opts = existsSync(join(tessdata, "deu.traineddata")) ? { tessdataDir: tessdata } : {};
const file = (name: string) => join(fixtures, name);
// ADR-0002-Muster: fehlende lokale Werkzeuge = sichtbarer Skip, nie stiller Pass.
const has = (cmd: string) => spawnSync("sh", ["-c", `command -v ${cmd}`]).status === 0;
const hasPdftotext = has("pdftotext");
const hasOcr = has("tesseract") && has("pdftoppm");
const hasMagick = has("magick");

/**
 * T7.10 / AC-P7-8: real files, real local tools (poppler, tesseract,
 * the Office XML). PNG/PDF made with ImageMagick + LibreOffice; the PPTX is a
 * minimal hand-built zip (LibreOffice can't turn text into slides).
 */
describe("attachment extraction (T7.10)", () => {
  it("classifies by type and name", () => {
    expect(attachmentKind("image/png", "x.png")).toBe("image");
    expect(attachmentKind("application/pdf", "x.pdf")).toBe("pdf");
    expect(attachmentKind("application/octet-stream", "x.docx")).toBe("office");
    expect(attachmentKind("text/csv", "x.csv")).toBe("text");
    expect(attachmentKind("application/octet-stream", "main.ts")).toBe("text");
    expect(attachmentKind("application/zip", "x.zip")).toBe("other");
  });

  it.skipIf(!hasPdftotext)("text PDF via pdftotext", async () => {
    const r = await extractText("pdf", file("text.pdf"), "text.pdf", "application/pdf", opts);
    expect(r.method).toBe("pdftotext");
    expect(r.text).toContain("Rechnung Nr. 4711");
  });

  it.skipIf(!hasOcr)("scanned PDF and image via tesseract OCR", async () => {
    for (const [name, kind, mime] of [["gescannt.pdf", "pdf", "application/pdf"], ["bild-mit-text.png", "image", "image/png"]] as const) {
      const r = await extractText(kind, file(name), name, mime, opts);
      expect(r.method, name).toBe("tesseract");
      expect(r.text, name).toMatch(/Rechnung Nr\. ?4711/);
      expect(r.text, name).toMatch(/129,90/);
    }
  }, 60_000);

  it("DOCX, XLSX, PPTX from their XML; CSV as text", async () => {
    expect(officeText(readFileSync(file("dokument.docx")), "dokument.docx")).toContain("Betrag: 129,90 Euro");
    const xlsx = officeText(readFileSync(file("tabelle.xlsx")), "tabelle.xlsx");
    expect(xlsx).toContain("Tastatur;49,9");
    const pptx = officeText(readFileSync(file("folien.pptx")), "folien.pptx");
    expect(pptx).toContain("--- Folie 1 ---\nFolie eins: Projektziele");
    expect(pptx).toContain("Zeitplan & Budget");
    expect((await extractText("text", file("tabelle.csv"), "tabelle.csv", "text/csv")).text).toContain("Maus;19,90");
  });

  it("says when the OCR tool is missing instead of sending the user after a key (BUG-0266)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ancientvoid-ocr-fehlt-"));
    const bild = join(dir, "bild.png");
    await copyFile(file("bild-mit-text.png"), bild);
    // Werkzeug gezielt abgesagt: der Befund muss auf allen Rechnern gleich sein.
    const ohneWerkzeug = await extractText("image", bild, "bild.png", "image/png", { ...opts, hasTool: async () => false });
    expect(ohneWerkzeug.text).toBe("");
    expect(ohneWerkzeug.error).toContain("tesseract");
    expect(ohneWerkzeug.error).toContain("voller Größe");
    expect(ohneWerkzeug.error).not.toMatch(/Schlüssel/);
    expect(ohneWerkzeug.error).toContain("Vision-Modell");
    // Mit eingeschaltetem Vision-Modell fällt der Hinweis darauf weg.
    const mitVision = await extractText("image", bild, "bild.png", "image/png", {
      ...opts,
      hasTool: async () => false,
      gemini: { apiKey: "test-key-123456", model: "gemini-test", fetch: (async () => new Response("{}")) as unknown as typeof fetch },
    });
    expect(mitVision.error).toContain("tesseract");
    expect(mitVision.error).not.toContain("Vision-Modell");
    await rm(dir, { recursive: true, force: true });
  });

  it.skipIf(!hasMagick || !hasOcr)("an image without text says what would help — Gemini only with a key", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ancientvoid-blank-"));
    const { execFileSync } = await import("node:child_process");
    execFileSync("magick", ["-size", "200x200", "xc:white", join(dir, "leer.png")]);
    const r = await extractText("image", join(dir, "leer.png"), "leer.png", "image/png", opts);
    expect(r.text).toBe("");
    // BUG-0277: seit BUG-0266 nennt der Schlüssel-lose Befund das
    // Vision-Modell (nicht mehr den Gemini-Schlüssel) — OCR lief, fand aber nichts.
    expect(r.error).toContain("Kein Text im Bild erkannt");
    expect(r.error).toContain("Vision-Modell");
    // with a key, Gemini is asked (stubbed fetch — no network in tests)
    const calls: string[] = [];
    const withGemini = await extractText("image", join(dir, "leer.png"), "leer.png", "image/png", {
      ...opts,
      gemini: {
        apiKey: "test-key-123456",
        model: "gemini-flash-latest",
        fetch: (async (url: string, init: { headers: Record<string, string> }) => {
          calls.push(`${url} ${init.headers["x-goog-api-key"]}`);
          return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Beschreibung: eine leere weiße Fläche." }] } }] }), { status: 200 });
        }) as unknown as typeof fetch,
      },
    });
    expect(withGemini).toMatchObject({ method: "gemini", text: "Beschreibung: eine leere weiße Fläche." });
    expect(calls[0]).toMatch(/generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-flash-latest:generateContent test-key-123456/);
    await rm(dir, { recursive: true, force: true });
  });

  it.skipIf(!hasPdftotext)("store: one file per content hash, extraction state on the record, resolve for adapters", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ancientvoid-att-"));
    const store = new AttachmentStore(new HubDatabase(":memory:"), dir, () => opts);
    const bytes = readFileSync(file("text.pdf"));
    const a = await store.save(bytes, "../../etc/rechnung.pdf", "application/pdf");
    const b = await store.save(bytes, "nochmal.pdf", "application/pdf");
    expect(b.id).toBe(a.id);
    expect(a.name).toBe("rechnung.pdf");
    expect(a.extraction.status).toBe("pending");
    const [resolved] = await store.resolve([a.id]);
    expect(resolved).toMatchObject({ name: "rechnung.pdf", kind: "pdf", method: "pdftotext", path: join(dir, a.id) });
    expect(resolved!.text).toContain("129,90");
    expect(store.get(a.id)?.extraction).toMatchObject({ status: "done", method: "pdftotext" });
    await expect(store.save(new Uint8Array(0), "leer", "text/plain")).rejects.toThrow("Leere Datei");
    await copyFile(file("tabelle.csv"), join(dir, "x"));
    await rm(dir, { recursive: true, force: true });
  });
});
