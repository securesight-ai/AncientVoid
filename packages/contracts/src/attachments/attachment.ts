import { z } from "zod";

/**
 * T7.5/T7.10 (ADR-0022): files and images a user brings into a session.
 * Stored once by content hash; events carry only this small record (K5),
 * never the bytes or the full extracted text.
 */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
/** Extracted text handed to a harness per attachment, at most. */
export const MAX_ATTACHMENT_TEXT_CHARS = 40_000;

export const ATTACHMENT_KINDS = ["image", "pdf", "office", "text", "audio", "video", "other"] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export const EXTRACTION_METHODS = ["text", "pdftotext", "tesseract", "office", "gemini"] as const;
export type ExtractionMethod = (typeof EXTRACTION_METHODS)[number];

export interface AttachmentExtraction {
  status: "pending" | "done" | "failed" | "none";
  /** Which way the text came out — local tools first, Gemini only if configured. */
  method: ExtractionMethod | null;
  chars: number;
  /** In words, when it failed or found nothing. */
  error: string | null;
}

export interface AttachmentRecord {
  /** sha256 of the bytes (hex). */
  id: string;
  name: string;
  mimeType: string;
  bytes: number;
  kind: AttachmentKind;
  createdAt: string;
  extraction: AttachmentExtraction;
}

export const AttachmentId = z.string().regex(/^[a-f0-9]{64}$/);

/** What an adapter gets: the file on disk and what could be read from it. */
export interface PromptAttachment {
  id: string;
  name: string;
  mimeType: string;
  kind: AttachmentKind;
  bytes: number;
  /** Absolute path of the stored file (read-only for the harness). */
  path: string;
  /** Extracted text (truncated), or null. */
  text: string | null;
  method: ExtractionMethod | null;
}

export function attachmentKind(mimeType: string, name: string): AttachmentKind {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType === "application/pdf" || ext === "pdf") return "pdf";
  if (/officedocument|msword|ms-excel|ms-powerpoint|opendocument/.test(mimeType) || ["docx", "xlsx", "pptx", "odt", "ods", "odp"].includes(ext)) return "office";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("text/") || /json|xml|yaml|csv|javascript|typescript|x-sh|x-python/.test(mimeType) ||
    ["txt", "md", "csv", "json", "yaml", "yml", "xml", "ts", "tsx", "js", "mjs", "py", "sh", "go", "rs", "java", "kt", "c", "h", "cpp", "css", "html", "sql", "toml", "ini", "log"].includes(ext)) return "text";
  return "other";
}

/**
 * The text form of attachments for harnesses that can't take the file
 * itself (or as context next to it): name, type, where the file is, and
 * what was read from it. `native` lists attachments the adapter already
 * hands over as real files/images — they get a reference, not their text.
 */
export function promptWithAttachments(text: string, attachments: readonly PromptAttachment[] | undefined, native: ReadonlySet<string> = new Set()): string {
  if (!attachments || attachments.length === 0) return text;
  const parts = attachments.map((a, i) => {
    const head = `[Anhang ${i + 1}: ${a.name} (${a.mimeType}, ${Math.max(1, Math.round(a.bytes / 1024))} KB) — Datei: ${a.path}]`;
    if (native.has(a.id)) return `${head}\n(als Datei übergeben)`;
    if (!a.text) {
      // Ein Agent mit Datei-Werkzeug kann das Bild selbst oeffnen — der Pfad steht
      // oben. Ohne diesen Hinweis ist ein eingefuegter Screenshot nur ein Vermerk
      // ("kein Text auslesbar") und wird uebergangen (Nutzerfund 23.11.2026).
      return a.kind === "image" || a.mimeType.startsWith("image/")
        ? `${head}\n(kein OCR-Text — das Bild liegt als Datei unter dem Pfad oben; mit dem Datei-/Bild-Werkzeug ansehen)`
        : `${head}\n(kein Text auslesbar)`;
    }
    const body = a.text.length > MAX_ATTACHMENT_TEXT_CHARS ? `${a.text.slice(0, MAX_ATTACHMENT_TEXT_CHARS)}\n… (gekürzt, ganze Datei unter dem Pfad oben)` : a.text;
    return `${head}\nInhalt (${a.method ?? "?"}):\n${body}`;
  });
  return `${text}\n\n${parts.join("\n\n")}`;
}
