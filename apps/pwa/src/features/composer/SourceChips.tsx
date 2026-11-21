import { t } from "../../shared/i18n/index.ts";
import { jumpToSource, removeSource, sourcesBlock, useSources, type SourceRef } from "../../shared/sources.ts";

/**
 * EPIC-P43.5 T43.5-1: sichtbare Quellenchips über dem Eingabefeld. Klick auf
 * einen Chip zeigt die Vorschau — genau der Block, der beim Absenden mitgeht
 * (immer Vorschau, nie implizites Senden); entfernbare Quelle, optionaler
 * Sprung ans Original. Der Block selbst hängt beim Submit am Prompt
 * (Composer), nicht hier.
 */
export function SourceChips({ target }: { target: string }) {
  const sources = useSources(target);
  if (sources.length === 0) return null;
  return (
    <div class="source-chips" data-testid="source-chips">
      {sources.map((s, i) => (
        <Chip key={s.id} source={s} index={i + 1} target={target} />
      ))}
    </div>
  );
}

function Chip({ source, index, target }: { source: SourceRef; index: number; target: string }) {
  return (
    <span class={`source-chip kind-${source.kind}`} data-kind={source.kind}>
      <span class="source-chip-label" title={source.excerpt ?? source.label}>
        {index}. {source.label}
      </span>
      {source.hash && (
        <button type="button" class="source-jump link-btn" aria-label={t("session.view_source", { "label": source.label })} onClick={() => jumpToSource(source)}>
          ↗
        </button>
      )}
      <button type="button" class="source-remove" aria-label={t("session.remove_source", { "label": source.label })} onClick={() => removeSource(target, source.id)}>
        ×
      </button>
    </span>
  );
}

/** Mitgesendet-Antworttext: identisch zum Block im Prompt (Vorschau-Pflicht). */
export function SourcePreviewNote({ target }: { target: string }) {
  const sources = useSources(target);
  if (sources.length === 0) return null;
  return (
    <div class="source-preview" data-testid="source-preview">
      <div class="dim source-preview-head">{t("composer.sent_with_next")}{sources.length} {t("composer.source")}{sources.length > 1 ? "n" : ""}):</div>
      <pre class="source-preview-block">{sourcesBlock(sources)}</pre>
    </div>
  );
}
