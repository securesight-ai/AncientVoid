import { t } from "../../shared/i18n/index.ts";
import { useState } from "preact/hooks";
import type { HubApi } from "../../shared/api.ts";
import { basket, useBasket } from "./feedback-basket.ts";
import { addSource } from "../../shared/sources.ts";
import { codeHash } from "../../app/route.ts";
import { Button, Chip } from "../../shared/ui/index.ts";

/**
 * EPIC-P46 T46.8 (ADR-0058 §11): gesammelte Datei-/Diagnose-Befunde → Folgeauftrag an die Session. Vorschau zeigt
 * exakt den Text, der gesendet wird (der Hub baut ihn aus der Datei, nicht aus Client-Angaben); veraltete Befunde
 * werden abgewiesen.
 * EPIC-P43.5 T43.5-1: Befunde können alternativ als Quellenchips in den Composer wandern —
 * sichtbare Vorschau dort, Senden bleibt die bewusste Handlung des Menschen.
 */
export function FeedbackPanel({ api, sessionId }: { api: HubApi; sessionId: string | null }) {
  const items = useBasket();
  const [preview, setPreview] = useState<{ prompt: string; stale: { path: string; reason: string | null }[] } | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  if (items.length === 0) return null;
  if (!sessionId) return <div class="dim file-note" data-testid="feedback-panel">{items.length} {t("files.findings_need_session")}</div>;

  const doPreview = async () => {
    setBusy(true);
    setStatus("");
    try {
      setPreview(await api.fileFeedbackPreview(sessionId, items));
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Vorschau fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };

  /** T43.5-1: Befunde als Quellenchips — jedes Item eine Quelle mit Sprung zur Stelle. */
  const toComposer = () => {
    for (const it of items) {
      const label = `${it.path}:${it.startLine}${it.endLine !== it.startLine ? `–${it.endLine}` : ""}`;
      addSource(sessionId, {
        id: `code:${label}:${it.startLine}`,
        kind: "code",
        label,
        excerpt: [it.note.trim(), `[Stand ${it.revision.slice(0, 8)}]`, basket.excerpt(it), it.diagnostic?.message].filter(Boolean).join("\n"),
        hash: codeHash(sessionId, it.path, it.startLine),
      });
    }
    basket.clear();
    setPreview(null);
    setStatus("In den Composer übernommen — dort prüfen und mit dem nächsten Absenden mitgeben.");
  };
  const send = async () => {
    setBusy(true);
    try {
      await api.fileFeedbackSend(sessionId, items, crypto.randomUUID());
      basket.clear();
      setPreview(null);
      setStatus("Gesendet.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Senden fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="feedback-panel" data-testid="feedback-panel">
      <strong>{t("files.feedback_open")}{items.length})</strong>
      <ul>
        {items.map((it, k) => (
          <li key={`${it.path}:${it.startLine}:${it.endLine}`}>
            <span class="mono">{it.path}:{it.startLine}{it.endLine !== it.startLine ? `–${it.endLine}` : ""}</span>
            <input class="file-find" placeholder={t("files.note")} aria-label={`Anmerkung zu ${it.path} Zeile ${it.startLine}`} maxLength={2000} value={it.note} onInput={(e) => { it.note = (e.target as HTMLInputElement).value; setPreview(null); }} />
            <Chip aria-label={t("files.remove_finding")} onClick={() => { basket.remove(k); setPreview(null); }}>×</Chip>
          </li>
        ))}
      </ul>
      <div class="file-tools">
        <Button disabled={busy} onClick={doPreview} data-testid="feedback-preview">{t("files.preview")}</Button>
        <Button disabled={busy} onClick={toComposer} data-testid="feedback-to-composer">{t("files.into_composer")}</Button>
        <Button disabled={busy || !preview || preview.stale.length > 0} onClick={send} data-testid="feedback-send">{t("files.send_session")}</Button>
      </div>
      {preview && preview.stale.length > 0 && <div class="files-stale" role="alert">{t("files.outdated")} {preview.stale.map((s) => `${s.path} (${s.reason})`).join("; ")} {t("files.remove_reselect")}</div>}
      {preview && <pre class="file-text" data-testid="feedback-prompt">{preview.prompt}</pre>}
      {status && <div class="dim" role="status">{status}</div>}
    </div>
  );
}
