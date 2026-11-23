import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { strFromU8, unzipSync } from "fflate";
import type { AttachmentKind, ExtractionMethod } from "@ancientvoid/contracts";

const run = promisify(execFile);

/**
 * T7.10 (ADR-0022): text out of an attachment. Local tools first —
 * poppler for PDFs, tesseract for scans and images, the Office XML itself
 * for DOCX/XLSX/PPTX. Gemini only when configured and the local way found
 * (almost) nothing. The method is always named; nothing is guessed.
 */
export interface ExtractOptions {
  /** Gemini vision/OCR fallback — only with a key from the settings. */
  gemini?: { apiKey: string; model: string; fetch?: typeof fetch } | undefined;
  /** tesseract languages; default "deu+eng" when both are installed. */
  tesseractLangs?: string;
  /**
   * Probe for an external tool. Injectable for tests; the default asks the
   * PATH. Needed because "no text" and "no OCR tool on this machine" are
   * different findings and the user must not be sent down the wrong path.
   */
  hasTool?: (cmd: string) => Promise<boolean>;
  tessdataDir?: string | undefined;
}

export interface Extracted {
  text: string;
  method: ExtractionMethod | null;
  error: string | null;
}

const MIN_USEFUL_CHARS = 20;

async function has(cmd: string): Promise<boolean> {
  try {
    await run("sh", ["-c", `command -v ${cmd}`]);
    return true;
  } catch {
    return false;
  }
}

async function tesseract(file: string, opts: ExtractOptions): Promise<string> {
  const args = [file, "stdout", "-l", opts.tesseractLangs ?? (await tesseractLangs(opts))];
  if (opts.tessdataDir) args.push("--tessdata-dir", opts.tessdataDir);
  const { stdout } = await run("tesseract", args, { maxBuffer: 20 * 1024 * 1024, timeout: 120_000 });
  return stdout;
}

async function tesseractLangs(opts: ExtractOptions): Promise<string> {
  try {
    const { stdout, stderr } = await run("tesseract", ["--list-langs", ...(opts.tessdataDir ? ["--tessdata-dir", opts.tessdataDir] : [])]);
    const langs = `${stdout}\n${stderr}`.split("\n").map((l) => l.trim());
    return ["deu", "eng"].filter((l) => langs.includes(l)).join("+") || "eng";
  } catch {
    return "eng";
  }
}

async function pdfText(file: string): Promise<string> {
  const { stdout } = await run("pdftotext", ["-layout", file, "-"], { maxBuffer: 50 * 1024 * 1024, timeout: 120_000 });
  return stdout;
}

/** Scanned PDF: render pages (max 20) and OCR them. */
async function pdfOcr(file: string, opts: ExtractOptions): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ancientvoid-ocr-"));
  try {
    await run("pdftoppm", ["-r", "200", "-png", "-l", "20", file, join(dir, "p")], { timeout: 300_000 });
    const pages = (await readdir(dir)).filter((f) => f.endsWith(".png")).sort();
    const texts: string[] = [];
    for (const page of pages) texts.push(await tesseract(join(dir, page), opts));
    return texts.join("\n\f\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function xmlText(xml: string, paragraph: RegExp): string {
  return xml
    .replace(paragraph, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** DOCX/XLSX/PPTX are zipped XML — read the text parts directly. */
// BUG-0109: the input cap covers the compressed file only — inflate just the
// parts this function reads, and cap those, or one small file decompresses
// gigabytes (measured: 4.9 MB in, ~4.9 GB RSS out).
const OFFICE_PART = /^(word\/document\.xml|content\.xml|xl\/workbook\.xml|xl\/sharedStrings\.xml|ppt\/slides\/slide\d+\.xml|xl\/worksheets\/sheet\d+\.xml)$/;
const MAX_EXTRACTED_BYTES = 128 * 1024 * 1024;

export function officeText(bytes: Uint8Array, name: string): string {
  const files = unzipSync(bytes, { filter: (f) => OFFICE_PART.test(f.name) });
  for (const [path, data] of Object.entries(files)) if (data.length > MAX_EXTRACTED_BYTES) throw new Error(`extracted entry over size limit: ${path}`);
  const text = (path: string) => (files[path] ? strFromU8(files[path]) : "");
  const ext = name.toLowerCase().split(".").pop();
  if (ext === "docx" || files["word/document.xml"]) return xmlText(text("word/document.xml"), /<\/w:p>|<w:br\/>|<w:tab\/>/g);
  if (ext === "pptx" || Object.keys(files).some((f) => f.startsWith("ppt/slides/"))) {
    return Object.keys(files)
      .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
      .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))
      .map((f, i) => `--- Folie ${i + 1} ---\n${xmlText(text(f), /<\/a:p>/g)}`)
      .join("\n\n");
  }
  if (ext === "xlsx" || files["xl/workbook.xml"]) {
    const shared = [...text("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => xmlText(m[1]!, /<\/t>/g).replace(/\n/g, " "));
    return Object.keys(files)
      .filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f))
      .sort()
      .map((f, i) => {
        const rows = [...text(f).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((row) =>
          [...row[1]!.matchAll(/<c([^>]*)>(?:[\s\S]*?<v>([\s\S]*?)<\/v>)?(?:[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>)?[\s\S]*?<\/c>/g)]
            .map((c) => (/t="s"/.test(c[1]!) ? (shared[Number(c[2])] ?? "") : (c[3] ?? c[2] ?? "")))
            .join(";"),
        );
        return `--- Tabelle ${i + 1} ---\n${rows.join("\n")}`;
      })
      .join("\n\n");
  }
  // ODF (odt/ods/odp): content.xml
  return xmlText(text("content.xml"), /<\/text:p>|<\/text:h>/g);
}

/** Gemini: OCR and a short description, for images and scans local tools couldn't read. */
export async function geminiExtract(bytes: Uint8Array, mimeType: string, gemini: NonNullable<ExtractOptions["gemini"]>): Promise<string> {
  const doFetch = gemini.fetch ?? fetch;
  const res = await doFetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(gemini.model)}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": gemini.apiKey },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: "Gib den gesamten lesbaren Text dieser Datei wörtlich wieder (OCR). Beschreibe danach in 1–3 Sätzen, was zu sehen ist (Abschnitt „Beschreibung:“). Keine weiteren Kommentare." },
            { inline_data: { mime_type: mimeType, data: Buffer.from(bytes).toString("base64") } },
          ],
        },
      ],
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; error?: { message?: string } };
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${body.error?.message ?? "Fehler"}`);
  return (body.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
}

export async function extractText(kind: AttachmentKind, file: string, name: string, mimeType: string, opts: ExtractOptions = {}): Promise<Extracted> {
  const bytes = new Uint8Array(await readFile(file));
  const hasTool = opts.hasTool ?? has;
  let local: Extracted = { text: "", method: null, error: null };
  try {
    if (kind === "text") local = { text: Buffer.from(bytes).toString("utf8"), method: "text", error: null };
    else if (kind === "office") local = { text: officeText(bytes, name), method: "office", error: null };
    else if (kind === "pdf") {
      if (await hasTool("pdftotext")) {
        const text = await pdfText(file);
        local = text.replace(/\s/g, "").length >= MIN_USEFUL_CHARS ? { text, method: "pdftotext", error: null } : { text: "", method: null, error: null };
        if (!local.method && (await hasTool("pdftoppm")) && (await hasTool("tesseract"))) local = { text: await pdfOcr(file, opts), method: "tesseract", error: null };
      }
    } else if (kind === "image" && (await hasTool("tesseract"))) {
      local = { text: await tesseract(file, opts), method: "tesseract", error: null };
    }
  } catch (err) {
    local = { text: "", method: null, error: err instanceof Error ? err.message.slice(0, 300) : String(err) };
  }
  const useful = local.text.replace(/\s/g, "").length >= MIN_USEFUL_CHARS;
  if (useful) return { text: local.text.trim(), method: local.method, error: null };
  // Images and scans without readable text: Gemini, if the user set a key.
  if ((kind === "image" || kind === "pdf") && opts.gemini) {
    try {
      const text = await geminiExtract(bytes, mimeType, opts.gemini);
      if (text) return { text, method: "gemini", error: null };
    } catch (err) {
      return { text: local.text.trim(), method: local.method, error: err instanceof Error ? err.message.slice(0, 300) : String(err) };
    }
  }
  if (local.text.trim()) return { text: local.text.trim(), method: local.method, error: null };
  // „Kein Text gefunden" und „hier fehlt das Werkzeug" sind verschiedene
  // Befunde. Wer ohne tesseract nach einem Schlüssel schickt, jagt einer
  // Fährte hinterher (Nutzerfund 23.11.2026: „kein Text gefunden …
  // Gemini-Schlüssel", obwohl der Hub kein OCR-Werkzeug hat).
  let hint: string;
  if (kind === "image" || kind === "pdf") {
    const ocrFehlt = !(await hasTool("tesseract"));
    hint = ocrFehlt
      ? "Der Hub-Rechner hat kein OCR-Werkzeug (tesseract nicht installiert) — der Text im Bild wurde nie gelesen. Das Bild selbst ist unverändert in voller Größe zu sehen."
      : "Kein Text im Bild erkannt.";
    if (!opts.gemini) hint += " Ein eingeschaltetes Vision-Modell in den Einstellungen könnte das Bild zusätzlich beschreiben.";
  } else if (kind === "other" || kind === "audio" || kind === "video") {
    hint = "Für diesen Dateityp gibt es (noch) keine Auslese.";
  } else {
    hint = "Kein Text gefunden.";
  }
  return { text: "", method: null, error: local.error ?? hint };
}
