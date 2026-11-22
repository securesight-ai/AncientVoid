import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { attachmentKind, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_TEXT_CHARS, TTS_TIMEOUT_MS, type AttachmentExtraction, type AttachmentKind, type AttachmentRecord, type PromptAttachment, type TtsSettingsView } from "@ancientvoid/contracts";
import type { HubDatabase } from "../../platform/index.ts";
import { extractText, type ExtractOptions } from "./extract.ts";

interface AttachmentRow {
  id: string;
  name: string;
  mime_type: string;
  bytes: number;
  kind: string;
  created_at: string;
  extraction: string;
}

function toRecord(row: AttachmentRow): AttachmentRecord {
  return {
    id: row.id,
    name: row.name,
    mimeType: row.mime_type,
    bytes: row.bytes,
    kind: row.kind as AttachmentKind,
    createdAt: row.created_at,
    extraction: JSON.parse(row.extraction) as AttachmentExtraction,
  };
}

/** Keep names printable and short; the bytes are identified by their hash. */
function cleanName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "datei";
  // Printable characters only (control characters out).
  return [...base].filter((c) => c.charCodeAt(0) >= 0x20).join("").slice(0, 200) || "datei";
}

/**
 * T7.10 (ADR-0022): uploaded files, stored once per content hash under
 * `<dir>/<sha256>`, with the extracted text next to it (`.txt`). The
 * extraction runs after the upload returns; its state is on the record.
 */
export class AttachmentStore {
  private readonly db: HubDatabase;
  private readonly dir: string;
  private readonly extractOptions: () => ExtractOptions;
  private readonly running = new Map<string, Promise<void>>();

  constructor(db: HubDatabase, dir: string, extractOptions: () => ExtractOptions = () => ({})) {
    this.db = db;
    this.dir = dir;
    this.extractOptions = extractOptions;
  }

  pathOf(id: string): string {
    return join(this.dir, id);
  }

  async save(bytes: Uint8Array, name: string, mimeType: string): Promise<AttachmentRecord> {
    if (bytes.byteLength === 0) throw new Error("Leere Datei.");
    if (bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new Error(`Datei zu groß (${Math.round(bytes.byteLength / 1024 / 1024)} MB, erlaubt ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB).`);
    const id = createHash("sha256").update(bytes).digest("hex");
    const known = this.get(id);
    if (known) return known;
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await writeFile(this.pathOf(id), bytes, { mode: 0o600 });
    const clean = cleanName(name);
    const mime = mimeType || "application/octet-stream";
    const record: AttachmentRecord = {
      id,
      name: clean,
      mimeType: mime,
      bytes: bytes.byteLength,
      kind: attachmentKind(mime, clean),
      createdAt: new Date().toISOString(),
      extraction: { status: "pending", method: null, chars: 0, error: null },
    };
    this.db
      .prepare("INSERT INTO attachments (id, name, mime_type, bytes, kind, created_at, extraction) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(record.id, record.name, record.mimeType, record.bytes, record.kind, record.createdAt, JSON.stringify(record.extraction));
    this.running.set(id, this.extract(record).finally(() => this.running.delete(id)));
    return record;
  }

  get(id: string): AttachmentRecord | undefined {
    const row = this.db.prepare("SELECT * FROM attachments WHERE id = ?").get(id) as unknown as AttachmentRow | undefined;
    return row ? toRecord(row) : undefined;
  }

  /** Waits for a running extraction (at most `timeoutMs`). */
  async settled(id: string, timeoutMs = 120_000): Promise<AttachmentRecord | undefined> {
    const job = this.running.get(id);
    if (job) await Promise.race([job, new Promise((r) => setTimeout(r, timeoutMs).unref())]);
    return this.get(id);
  }

  async text(id: string): Promise<string | null> {
    return readFile(`${this.pathOf(id)}.txt`, "utf8").catch(() => null);
  }

  /** Extract again (e.g. after a Gemini key was set). */
  async reextract(id: string): Promise<AttachmentRecord | undefined> {
    const record = this.get(id);
    if (!record) return undefined;
    await this.extract(record);
    return this.get(id);
  }

  /** What an adapter gets for the given ids — waits for extractions. */
  async resolve(ids: readonly string[]): Promise<PromptAttachment[]> {
    const out: PromptAttachment[] = [];
    for (const id of ids) {
      const record = await this.settled(id);
      if (!record) throw new Error(`Anhang ${id.slice(0, 12)} unbekannt — bitte erneut hochladen.`);
      await access(this.pathOf(id));
      const text = await this.text(id);
      out.push({
        id,
        name: record.name,
        mimeType: record.mimeType,
        kind: record.kind,
        bytes: record.bytes,
        path: this.pathOf(id),
        text: text ? text.slice(0, MAX_ATTACHMENT_TEXT_CHARS * 2) : null,
        method: record.extraction.method,
      });
    }
    return out;
  }

  private async extract(record: AttachmentRecord): Promise<void> {
    const result = await extractText(record.kind, this.pathOf(record.id), record.name, record.mimeType, this.extractOptions()).catch((err: unknown) => ({
      text: "",
      method: null,
      error: err instanceof Error ? err.message : String(err),
    }));
    if (result.text) await writeFile(`${this.pathOf(record.id)}.txt`, result.text, { mode: 0o600 });
    const extraction: AttachmentExtraction = {
      status: result.text ? "done" : result.error && !/Kein Text|keine Auslese/.test(result.error) ? "failed" : "none",
      method: result.method,
      chars: result.text.length,
      error: result.error,
    };
    this.db.prepare("UPDATE attachments SET extraction = ? WHERE id = ?").run(JSON.stringify(extraction), record.id);
  }
}

/** T7.10: hub settings in the `config` table. Secrets are write-only via the API. */
export class SettingsStore {
  private readonly db: HubDatabase;

  constructor(db: HubDatabase) {
    this.db = db;
  }

  get(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM config WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  set(key: string, value: string | null): void {
    if (value === null) this.db.prepare("DELETE FROM config WHERE key = ?").run(key);
    else this.db.prepare("INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }

  /** Gemini for OCR/description of attachments — only with a key. */
  gemini(): { apiKey: string; model: string } | undefined {
    const apiKey = this.get("gemini.apiKey");
    return apiKey ? { apiKey, model: this.get("gemini.model") ?? DEFAULT_GEMINI_MODEL } : undefined;
  }

  /** EPIC-P75 (ADR-0097): TTS-Ziel fürs Chat-Vorlesen — runtime änderbar im
   *  SettingsStore (eine Wahrheit, kein hub.config.json-Block). */
  ttsView(): TtsSettingsView {
    return {
      url: this.get("tts.url"),
      engine: this.get("tts.engine"),
      language: this.get("tts.language") === "en" ? "en" : "de",
      speed: storedNumber(this.get("tts.speed"), 1),
      timeoutMs: storedNumber(this.get("tts.timeoutMs"), TTS_TIMEOUT_MS),
    };
  }
}


/** Numbers live as text in the config table — anything unparsable falls back. */
function storedNumber(raw: string | null, fallback: number): number {
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const DEFAULT_GEMINI_MODEL = "gemini-flash-latest";
