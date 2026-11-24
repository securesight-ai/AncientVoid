import { t } from "../../shared/i18n/index.ts";
import { createPortal } from "preact/compat";
import type { ComponentChildren } from "preact";
import { useOverlayFocus } from "../../shared/overlay-focus.ts";
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

/**
 * Kurzform fuer die Eingabezeile: der Hub-Grund kann ein ganzer Satz sein und
 * presst die Zeile. Der volle Grund bleibt als title/aria erhalten.
 */
function extractionKurz(a: Pick<AttachmentRecord, "extraction">): string {
  const e = a.extraction;
  if (e.status === "pending") return "wird gelesen…";
  if (e.status === "done") return `${e.chars.toLocaleString("de-DE")} Zeichen · ${METHOD[e.method ?? ""] ?? e.method}`;
  return "kein Text gelesen";
}

function extractionGrund(a: Pick<AttachmentRecord, "extraction">): string {
  const e = a.extraction;
  if (e.status === "failed") return e.error ?? "Kein Text gelesen.";
  return extractionKurz(a);
}

type Item = AttachmentRecord | { id: string; name: string; uploading: true; error?: string };

/** The paperclip: pick, upload, watch the extraction, remove. */
export function AttachmentPicker({ attachments, onChange, disabled }: { attachments: AttachmentRecord[]; onChange: (next: AttachmentRecord[]) => void; disabled?: boolean }) {
  const api = useApi();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<Item[]>([]);
  const [vorschau, setVorschau] = useState<AttachmentRef | null>(null);
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
            <span key={a.id} class={`attachment-chip ${a.extraction.status}${a.kind === "image" ? " rich" : ""}`} data-testid="attachment-chip" title={extractionGrund(a)}>
              {a.kind === "image" && (
                <AttachmentThumb
                  compact
                  attachment={{ id: a.id, name: a.name, mimeType: a.mimeType, kind: a.kind, bytes: a.bytes }}
                  onOpen={() => setVorschau(a)}
                />
              )}
              <span class="attachment-meta">
                <strong>{a.name}</strong> <span class="dim">{size(a.bytes)} · {extractionKurz(a)}</span>
              </span>
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
      {vorschau && <ImageLightbox attachment={vorschau} onClose={() => setVorschau(null)} />}
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
  const images = refs.filter((a) => a.kind === "image");
  const documents = refs.filter((a) => a.kind !== "image");
  return (
    <div class="attachment-chips">
      {images.map((a) => (
        <AttachmentThumb key={a.id} attachment={a} onOpen={() => setOpen(a)} />
      ))}
      {documents.map((a) => (
        <button key={a.id} type="button" class="attachment-chip" onClick={() => setOpen(a)}>
          📄 <strong>{a.name}</strong> <span class="dim">{size(a.bytes)}</span>
        </button>
      ))}
      {open &&
        (open.kind === "image" ? <ImageLightbox attachment={open} onClose={() => setOpen(null)} /> : <AttachmentViewer attachment={open} onClose={() => setOpen(null)} />)}
    </div>
  );
}

/** Holt die Bytes als Objekt-URL — der Token bleibt im Header, niemals in der URL. */
function useObjectUrl(attachmentId: string): { url: string | null; fehlgeschlagen: boolean } {
  const api = useApi();
  const [url, setUrl] = useState<string | null>(null);
  const [fehlgeschlagen, setFehlgeschlagen] = useState(false);
  useEffect(() => {
    let revoke: string | null = null;
    let lebt = true;
    setUrl(null);
    setFehlgeschlagen(false);
    void api.attachmentUrl(attachmentId).then(
      (neue) => {
        if (!lebt) {
          URL.revokeObjectURL(neue);
          return;
        }
        revoke = neue;
        setUrl(neue);
      },
      () => {
        if (lebt) setFehlgeschlagen(true);
      },
    );
    return () => {
      lebt = false;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [attachmentId, api]);
  return { url, fehlgeschlagen };
}

/**
 * Ein Bild in der Chat-Zeile: echtes Vorschaubild statt Chip, ein Tipp darauf oeffnet
 * das Vollbild. Die Vorschau haelt eine feste Hohe — der Chat springt nicht, wenn die
 * Bytes eintreffen.
 */
function AttachmentThumb({ attachment, onOpen, compact }: { attachment: AttachmentRef; onOpen: () => void; compact?: boolean }) {
  const { url, fehlgeschlagen } = useObjectUrl(attachment.id);
  return (
    <button type="button" class="attachment-thumb" onClick={onOpen} data-testid="attachment-thumb" aria-label={`${t("attachments.open_image")}: ${attachment.name}`}>
      <span class="attachment-thumb-frame">
        {url ? <img src={url} alt="" loading="lazy" /> : <span class="attachment-thumb-ph">{fehlgeschlagen ? "⚠︎" : "…"}</span>}
      </span>
      {!compact && (
        <span class="attachment-thumb-meta">
          <strong>{attachment.name}</strong> <span class="dim">{size(attachment.bytes)}</span>
        </span>
      )}
    </button>
  );
}

/**
 * Das Vollbild-geruest. Es liegt — wie der Datei-Betrachter und die Medien-Lupe — im `body`:
 * nur dann liegt es ueber allen Flaechebenen (Schiene, Kopfzeile, Statusleiste) statt in der
 * Stapelung des Composers stecken zu bleiben.
 */
function LightboxShell({
  title,
  meta,
  onClose,
  download,
  children,
}: {
  title: string;
  meta?: string;
  onClose: () => void;
  download?: { href: string; name: string };
  children: ComponentChildren;
}) {
  const { ref } = useOverlayFocus<HTMLDivElement>(true);
  useEffect(() => {
    const auf = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", auf);
    return () => document.removeEventListener("keydown", auf);
  }, [onClose]);
  return createPortal(
    <div
      ref={ref}
      class="attachment-lightbox"
      data-testid="attachment-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      tabindex={-1}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div class="attachment-lightbox-bar">
        <span class="attachment-lightbox-name">
          <strong>{title}</strong>
          {meta ? <span class="dim"> {meta}</span> : null}
        </span>
        <span class="attachment-lightbox-actions">
          {download && (
            <a class="attachment-lightbox-dl" href={download.href} download={download.name}>
              {t("attachments.download")}
            </a>
          )}
          <Button onClick={onClose} aria-label={t("common.close")}>
            ✕
          </Button>
        </span>
      </div>
      <div class="attachment-lightbox-stage">{children}</div>
    </div>,
    document.body,
  );
}

/** Vollbild fuer ein Bild: ein Tipp oeffnet, ein Tipp am Rand, ✕ oder Esc schliesst. */
function ImageLightbox({ attachment, onClose }: { attachment: AttachmentRef; onClose: () => void }) {
  const { url, fehlgeschlagen } = useObjectUrl(attachment.id);
  return (
    <LightboxShell title={attachment.name} meta={size(attachment.bytes)} onClose={onClose} {...(url ? { download: { href: url, name: attachment.name } } : {})}>
      {fehlgeschlagen ? (
        <div class="attachment-lightbox-note">{t("attachments.image_failed")}</div>
      ) : url ? (
        <img src={url} alt={attachment.name} data-testid="attachment-lightbox-img" />
      ) : (
        <div class="dim">{t("common.loading_dots")}</div>
      )}
    </LightboxShell>
  );
}

/**
 * Der Deep-Link eines Anhangs (`#/anhang/<id>` oder `…/sessions/<id>/anhang/<id>`) —
 * genau der Link, den ein Agent zu einem Bild mitschickt. Das Geraet oeffnet ihn mit
 * seinem eigenen Token, deshalb steht in der URL nichts, was man weitergeben duerfte.
 */
export function AttachmentRouteView({ attachmentId, onClose }: { attachmentId: string; onClose: () => void }) {
  const api = useApi();
  const [ref, setRef] = useState<AttachmentRef | "fehler" | null>(null);
  useEffect(() => {
    let lebt = true;
    void api.attachment(attachmentId).then(
      (a) => {
        if (!lebt) return;
        setRef({ id: a.id, name: a.name, mimeType: a.mimeType, kind: a.kind, bytes: a.bytes });
      },
      () => {
        if (lebt) setRef("fehler");
      },
    );
    return () => {
      lebt = false;
    };
  }, [attachmentId, api]);
  if (ref === "fehler") {
    return (
      <LightboxShell title={attachmentId} onClose={onClose}>
        <div class="attachment-lightbox-note">{t("attachments.image_failed")}</div>
      </LightboxShell>
    );
  }
  if (!ref) {
    return (
      <LightboxShell title={t("common.loading_dots")} onClose={onClose}>
        <div class="dim">{t("common.loading_dots")}</div>
      </LightboxShell>
    );
  }
  return ref.kind === "image" ? <ImageLightbox attachment={ref} onClose={onClose} /> : <AttachmentViewer attachment={ref} onClose={onClose} />;
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
