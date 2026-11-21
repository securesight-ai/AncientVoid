import { t } from "../../shared/i18n/index.ts";
import { useEffect, useState } from "preact/hooks";
import type { DiagnosticsResult, FileMeta } from "@ancientvoid/contracts";
import { hostApi, type HubApi } from "../../shared/api.ts";
import { BLOB_MAX_BYTES, HEX_PAGE_BYTES, formatBytes, hexRows, metaSummary } from "./files-model.ts";
import { DiagnosticsPanel } from "./DiagnosticsPanel.tsx";
import { FeedbackPanel } from "./FeedbackPanel.tsx";
import { RenderedView, renderKindOf } from "./RenderedViews.tsx";
import { SourceView, type Jump } from "./SourceView.tsx";
import { Button, Chip, EmptyState } from "../../shared/ui/index.ts";

type Mode = "preview" | "rendered" | "source" | "hex";

/**
 * EPIC-P46 T46.5/T46.6 (ADR-0058): eine Datei bis zum letzten Byte — immer genau ein Abschnitt im DOM
 * (Speicherbudget), jeder Abschnitt an die Revision gebunden. Änderungen während des Lesens werden gemeldet,
 * nie gemischt. Medien als Blob (nur bis BLOB_MAX_BYTES), alles andere über Quelltext/Hex.
 */
export function FileViewer({ target, path, hostId = null, sessionId = null, onChangedOnDisk }: { target: string; path: string; hostId?: string | null; sessionId?: string | null; onChangedOnDisk?: () => void }) {
  const api = hostApi(hostId);
  const [meta, setMeta] = useState<FileMeta | null>(null);
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const [mode, setMode] = useState<Mode>("source");
  const [reload, setReload] = useState(0);
  const [diag, setDiag] = useState<DiagnosticsResult | null>(null);
  const [jump, setJump] = useState<Jump | null>(null);
  const [showDiag, setShowDiag] = useState(false);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setMeta(null);
    setError("");
    setStale(false);
    setDiag(null);
    api
      .codeMeta(target, path)
      .then((m) => {
        if (!alive) return;
        setMeta(m);
        setMode(renderKindOf(m) && m.family !== "text" ? "rendered" : m.family === "text" ? "source" : m.family === "binary" ? "hex" : "preview");
      })
      .catch((err) => alive && setError(err instanceof Error ? err.message : "Datei nicht lesbar"));
    return () => {
      alive = false;
    };
  }, [target, path, reload, hostId]);

  const markStale = () => {
    setStale(true);
    onChangedOnDisk?.();
  };

  if (error) return <div class="files-error" role="alert">{error}</div>;
  if (!meta) return <EmptyState text={t("common.loading")} />;
  const kind = renderKindOf(meta);
  const local = !hostId;
  const canPreview = meta.family === "image" || meta.family === "pdf" || meta.family === "audio" || meta.family === "video";
  return (
    <div class="file-viewer" data-testid="file-viewer">
      <div class="file-viewer-head">
        <span class="mono file-viewer-path" title={meta.path}>{meta.path}</span>
        <span class="dim">{metaSummary(meta)}</span>
        <span class="file-viewer-modes" role="group" aria-label={t("files.view")}>
          {kind && <Chip  onClick={() => setMode("rendered")} active={mode === "rendered"}>{t("files.view")}</Chip>}
          {canPreview && <Chip  onClick={() => setMode("preview")} active={mode === "preview"}>{t("files.preview")}</Chip>}
          {meta.family === "text" && <Chip  onClick={() => setMode("source")} active={mode === "source"}>{t("files.text")}</Chip>}
          <Chip  onClick={() => setMode("hex")} active={mode === "hex"}>{t("files.hex")}</Chip>
          {meta.family === "text" && local && <Chip  aria-pressed={showDiag} onClick={() => setShowDiag(!showDiag)} active={showDiag}>{t("files.diagnose")}</Chip>}
          <DownloadButton api={api} target={target} meta={meta} />
        </span>
      </div>
      <div class="dim file-note" data-testid="file-freshness" role="status">
        {t("files.file_as_of")} {new Date(meta.mtimeMs).toLocaleString("de-DE")} {t("files.revision_frag")} {meta.revision.slice(0, 8)}
        {!online && " · offline — nur bereits geladene Abschnitte, weitere Bereiche folgen nach Reconnect"}
      </div>
      {stale && (
        <div class="files-stale" role="alert">
          {t("files.file_changed")}{" "}
          <Button onClick={() => setReload((n) => n + 1)}>{t("files.reload")}</Button>
        </div>
      )}
      {showDiag && meta.family === "text" && local && (
        <DiagnosticsPanel api={api} target={target} meta={meta} result={diag} onResult={setDiag} onJump={(line, column) => { setMode("source"); setJump({ line, column, nonce: Date.now() }); }} />
      )}
      {mode === "source" && meta.family === "text" && <SourceView api={api} target={target} meta={meta} onStale={markStale} diagnostics={diag} jump={jump} />}
      {mode === "rendered" && kind && <RenderedView api={api} target={target} meta={meta} kind={kind} onStale={markStale} />}
      {mode === "hex" && <HexPages api={api} target={target} meta={meta} onStale={markStale} />}
      {mode === "preview" && canPreview && <MediaPreview api={api} target={target} meta={meta} onUnplayable={() => setMode("hex")} />}
      <FeedbackPanel api={api} sessionId={local ? sessionId : null} />
    </div>
  );
}

function useRevisionGuard(onStale: () => void) {
  return (err: unknown): string => {
    const message = err instanceof Error ? err.message : "Lesen fehlgeschlagen";
    if (/geändert/.test(message)) onStale();
    return message;
  };
}

function Pager({ offset, length, total, hasPrev, hasNext, onPrev, onNext, onJump }: { offset: number; length: number; total: number; hasPrev: boolean; hasNext: boolean; onPrev: () => void; onNext: () => void; onJump: (byte: number) => void }) {
  const [jump, setJump] = useState("");
  return (
    <div class="file-pager">
      <Button disabled={!hasPrev} onClick={onPrev} aria-label={t("files.prev_section")}>‹</Button>
      <span class="dim" data-testid="file-pager-range">
        {t("files.bytes")} {offset.toLocaleString("de-DE")}–{(offset + length).toLocaleString("de-DE")} {t("common.word_of")} {total.toLocaleString("de-DE")}
        {!hasNext && " · Ende"}
      </span>
      <Button disabled={!hasNext} onClick={onNext} aria-label={t("files.next_section")}>›</Button>
      <input
        class="file-pager-jump"
        inputMode="numeric"
        placeholder={t("files.byte_offset")}
        aria-label={t("files.jump_byte")}
        value={jump}
        onInput={(e) => setJump((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && /^\d+$/.test(jump)) onJump(Math.min(Number(jump), Math.max(total - 1, 0)));
        }}
      />
    </div>
  );
}

function HexPages({ api, target, meta, onStale }: { api: HubApi; target: string; meta: FileMeta; onStale: () => void }) {
  const [at, setAt] = useState(0);
  const [rows, setRows] = useState<{ offset: string; hex: string; ascii: string }[] | null>(null);
  const [len, setLen] = useState(0);
  const [error, setError] = useState("");
  const guard = useRevisionGuard(onStale);
  useEffect(() => {
    let alive = true;
    setError("");
    api
      .codeRange(target, meta.path, { offset: at, length: HEX_PAGE_BYTES, rev: meta.revision, as: "bytes" })
      .then((r) => {
        if (!alive) return;
        setLen(r.length);
        setRows(hexRows(r.base64 ?? "", r.offset));
      })
      .catch((err) => alive && setError(guard(err)));
    return () => {
      alive = false;
    };
  }, [target, meta.path, meta.revision, at]);
  if (error) return <div class="files-error" role="alert">{error}</div>;
  if (meta.bytes === 0) return <EmptyState text={t("files.empty_file")} />;
  if (!rows) return <EmptyState text={t("common.loading")} />;
  return (
    <>
      <Pager
        offset={at}
        length={len}
        total={meta.bytes}
        hasPrev={at > 0}
        hasNext={at + len < meta.bytes}
        onPrev={() => setAt(Math.max(at - HEX_PAGE_BYTES, 0))}
        onNext={() => setAt(at + len)}
        onJump={(byte) => setAt(byte - (byte % 16))}
      />
      <pre class="file-hex mono" data-testid="file-hex">{rows.map((r) => `${r.offset}  ${r.hex.padEnd(47)}  ${r.ascii}`).join("\n")}</pre>
    </>
  );
}

function MediaPreview({ api, target, meta, onUnplayable }: { api: HubApi; target: string; meta: FileMeta; onUnplayable: () => void }) {
  const [playError, setPlayError] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const tooBig = meta.bytes > BLOB_MAX_BYTES;
  useEffect(() => {
    if (tooBig) return;
    let alive = true;
    let made: string | null = null;
    api
      .codeRawUrl(target, meta.path, meta.revision)
      .then((u) => {
        made = u;
        if (alive) setUrl(u);
        else URL.revokeObjectURL(u);
      })
      .catch((err) => alive && setError(err instanceof Error ? err.message : "Vorschau fehlgeschlagen"));
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [target, meta.path, meta.revision]);
  if (tooBig) return <div class="files-error" role="status">{formatBytes(meta.bytes)} {t("files.too_large_preview")} {formatBytes(BLOB_MAX_BYTES)}{t("files.hex_reads_to2")}</div>;
  if (error) return <div class="files-error" role="alert">{error} {t("files.hex_original")}</div>;
  if (!url) return <EmptyState text={t("common.loading")} />;
  if (playError) {
    return (
      <div class="files-error" role="status">
        {t("files.codec_missing")}{" "}
        <Button onClick={onUnplayable}>{t("files.open_hex")}</Button>
      </div>
    );
  }
  // Passiv: <img>/<audio>/<video> führen keine Skripte aus; PDF nur im sandboxed iframe ohne Rechte.
  if (meta.family === "image") return <img class="file-media" src={url} alt={meta.path} onError={() => setPlayError(true)} />;
  if (meta.family === "audio") return <audio class="file-media" src={url} controls onError={() => setPlayError(true)} />;
  if (meta.family === "video") return <video class="file-media" src={url} controls onError={() => setPlayError(true)} />;
  // PDF braucht einen eingebauten Viewer; ohne ihn bleibt der Download (kein stilles Leerfeld).
  if (typeof navigator !== "undefined" && navigator.pdfViewerEnabled === false) {
    return <div class="files-error" role="status">{t("files.no_inline_pdf")}</div>;
  }
  return <iframe class="file-pdf" title={meta.path} src={url} sandbox="" />;
}

function DownloadButton({ api, target, meta }: { api: HubApi; target: string; meta: FileMeta }) {
  const [busy, setBusy] = useState(false);
  if (meta.bytes > BLOB_MAX_BYTES * 4) return <span class="dim" title={t("files.too_big_hex")}>{t("files.no_download")}</span>;
  return (
    <Chip
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const url = await api.codeRawUrl(target, meta.path, meta.revision);
          const a = document.createElement("a");
          a.href = url;
          a.download = meta.path.split("/").pop() ?? "datei";
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 10_000);
        } finally {
          setBusy(false);
        }
      }}
    >
      {t("files.download")}
    </Chip>
  );
}
