import { t } from "../../shared/i18n/index.ts";
import { useEffect, useState } from "preact/hooks";
import type { CodeFile } from "@ancientvoid/contracts";
import { hostApi } from "../../shared/api.ts";

/**
 * BUG-0191: Datei-Inhalt einer Git-Revision (nicht Worktree).
 * Read-only; gelöschte Pfade kommen über Parent-Fallback vom Server.
 */
export function HistoricalBlobView({
  target,
  path,
  sha,
  hostId = null,
}: {
  target: string;
  path: string;
  sha: string;
  hostId?: string | null;
}) {
  const api = hostApi(hostId);
  const [file, setFile] = useState<CodeFile | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setFile(null);
    setError("");
    api
      .codeFileAt(target, path, sha)
      .then((f) => {
        if (alive) setFile(f);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : "Historie-Datei nicht lesbar");
      });
    return () => {
      alive = false;
    };
  }, [api, target, path, sha]);

  if (error) return <div class="files-error" role="alert" data-testid="historical-blob-error">{error}</div>;
  if (!file) return <div class="ui-empty">{t("files.loading_history")}</div>;

  return (
    <div class="file-viewer historical-blob" data-testid="historical-blob-view">
      <div class="file-viewer-head">
        <span class="mono file-viewer-path" title={file.path}>{file.path}</span>
        <span class="dim">{file.language} · {file.bytes} B · {file.lines} {t("files.lines")}</span>
      </div>
      <div class="dim file-note" data-testid="historical-blob-banner" role="status">
        {t("files.history_at")} {sha.slice(0, 7)} {t("files.revision_state")}
        {file.truncated ? " · Inhalt gekappt" : ""}
        {file.binary ? " · Binärdatei (kein Text)" : ""}
      </div>
      {file.binary ? (
        <div class="ui-empty">{t("files.binary_no_preview")}</div>
      ) : (
        <pre class="historical-blob-source mono" data-testid="historical-blob-source">{file.content}</pre>
      )}
    </div>
  );
}
