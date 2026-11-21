import { t } from "../../shared/i18n/index.ts";
import { Sheet, Button } from "../../shared/ui/index.ts";
import { useEffect, useRef, useState } from "preact/hooks";
import { useApi } from "../../shared/api-context.ts";
import type { AttachmentRecord } from "../../shared/api.ts";
import { onExternalAttach } from "../../shared/attach-external.ts";

/**
 * T7.10 (ADR-0022): files and images into a session. Uploaded right away;
 * the hub reads them (local OCR/PDF/Office, Gemini only with a key) and the
 * chip shows how far that got.
 */

function size(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const METHOD: Record<string, string> = { text: "Text", pdftotext: "PDF-Text", tesseract: "OCR", office: "Office", gemini: "Gemini" };

function extractionLabel(a: Pick<AttachmentRecord, "extraction">): string {
  const e = a.extraction;
  if (e.status === "pending") return "wird gelesen…";
  if (e.status === "done") return `${e.chars.toLocaleString("de-DE")} Zeichen · ${METHOD[e.method ?? ""] ?? e.method}`;
  return e.error ?? "kein Text";
}

type Item = AttachmentRecord | { id: string; name: string; uploading: true; error?: string };

/** The paperclip: pick, upload, watch the extraction, remove. */
export function AttachmentPicker({ attachments, onChange, disabled }: { attachments: AttachmentRecord[]; onChange: (next: AttachmentRecord[]) => void; disabled?: boolean }) {
  const api = useApi();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<Item[]>([]);
  const latest = useRef(attachments);
  latest.current = attachments;

  // Poll until every extraction is settled.
  useEffect(() => {
    if (!attachments.some((a) => a.extraction.status === "pending")) return;
    const timer = setTimeout(() => {
      void Promise.all(latest.current.map((a) => (a.extraction.status === "pending" ? api.attachment(a.id).catch(() => a) : a))).then(onChange);
    }, 1000);
    return () => clearTimeout(timer);
  }, [attachments]);

  const pick = async (dateien: File[]) => {
    if (dateien.length === 0) return;
    for (const file of dateien) {
      const key = `${file.name}-${file.size}-${Date.now()}`;
      setUploading((u) => [...u, { id: key, name: file.name, uploading: true }]);
      try {
        const record = await api.uploadAttachment(file);
        if (!latest.current.some((a) => a.id === record.id)) onChange([...latest.current, record]);
        setUploading((u) => u.filter((x) => x.id !== key));
      } catch (err) {
        setUploading((u) => u.map((x) => (x.id === key ? { ...x, error: err instanceof Error ? err.message : "Upload fehlgeschlagen" } : x)));
      }
    }
    if (input.current) input.current.value = "";
  };

  // ADR-0093: auch ein Bild aus der Ablage nimmt denselben Weg (Hochladen, Lese-Status).
  useEffect(() => {
    if (disabled) return;
    return onExternalAttach((datei) => void pick([datei]));
  }, [disabled]);

  return (
    <>
      <input ref={input} type="file" multiple hidden aria-label={t("attachments.attach_files")} data-testid="attachment-input" onChange={(e) => void pick(Array.from((e.target as HTMLInputElement).files ?? []))} />
      <Button disabled={disabled} onClick={() => input.current?.click()} title={t("attachments.attach_files_images")} aria-label={t("attachments.add_attachment")} class="attach-btn">
        📎
      </Button>
      {(attachments.length > 0 || uploading.length > 0) && (
        <div class="attachment-chips">
          {attachments.map((a) => (
            <span key={a.id} class={`attachment-chip ${a.extraction.status}`} data-testid="attachment-chip">
              <strong>{a.name}</strong> <span class="dim">{size(a.bytes)} · {extractionLabel(a)}</span>
              <button type="button" class="attachment-remove" aria-label={`${a.name} entfernen`} onClick={() => onChange(attachments.filter((x) => x.id !== a.id))}>
                ×
              </button>
            </span>
          ))}
          {uploading.map((u) => (
            <span key={u.id} class={`attachment-chip ${"error" in u && u.error ? "failed" : "pending"}`} data-testid="attachment-chip">
              <strong>{u.name}</strong> <span class="dim">{"error" in u && u.error ? u.error : "lädt hoch…"}</span>
              {"error" in u && u.error && (
                <button type="button" class="attachment-remove" aria-label={`${u.name} entfernen`} onClick={() => setUploading((x) => x.filter((y) => y.id !== u.id))}>
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

export interface AttachmentRef {
  id: string;
  name: string;
  mimeType: string;
  kind: string;
  bytes: number;
  method?: string | null;
}

/** In the chat: what was sent along; tap for the picture and the read text. */
export function AttachmentChips({ refs }: { refs: AttachmentRef[] }) {
  const [open, setOpen] = useState<AttachmentRef | null>(null);
  return (
    <div class="attachment-chips">
      {refs.map((a) => (
        <button key={a.id} type="button" class="attachment-chip" onClick={() => setOpen(a)}>
          {a.kind === "image" ? "🖼" : "📄"} <strong>{a.name}</strong> <span class="dim">{size(a.bytes)}</span>
        </button>
      ))}
      {open && <AttachmentViewer attachment={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function AttachmentViewer({ attachment, onClose }: { attachment: AttachmentRef; onClose: () => void }) {
  const api = useApi();
  const [url, setUrl] = useState<string | null>(null);
  const [text, setText] = useState<{ extraction: AttachmentRecord["extraction"]; text: string | null } | null>(null);
  useEffect(() => {
    let revoke: string | null = null;
    if (attachment.kind === "image") void api.attachmentUrl(attachment.id).then((u) => setUrl((revoke = u)));
    void api.attachmentText(attachment.id).then(setText).catch(() => setText(null));
    return () => {
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [attachment.id]);
  return (
    <Sheet open onClose={onClose} label={attachment.name} testid="attachment-viewer">
        <div class="row" style="justify-content: space-between; align-items: center">
          <strong>{attachment.name}</strong>
          <Button onClick={onClose}>
            ✕
          </Button>
        </div>
        {url && <img class="attachment-preview" src={url} alt={attachment.name} />}
        {text === null ? (
          <div class="dim">{t("common.loading_dots")}</div>
        ) : text.text ? (
          <>
            <div class="dim" style="font-size: calc(11px * var(--font-scale, 1))">{t("attachments.parsed")} {extractionLabel(text)}</div>
            <pre class="attachment-text">{text.text}</pre>
          </>
        ) : (
          <div class="dim">{text.extraction.error ?? "Kein Text ausgelesen."}</div>
        )}
    </Sheet>
  );
}
