import { t } from "../../shared/i18n/index.ts";
import { useEffect, useState } from "preact/hooks";
import type { HarnessFeatures, HubApi, SessionRecord } from "../../shared/api.ts";

/** ADR-0033: Namen, wie die Oberfläche sie zeigt; unbekannte Modi erscheinen unverändert. */
const MODE_LABEL: Record<string, string> = {
  auto: t("session.auto"),
  manual: t("session.ask"),
  plan: t("common.plan"),
  acceptEdits: t("session.edits_no_ask"),
  dontAsk: t("session.never_ask"),
  bypassPermissions: t("session.allow_all"),
};

/**
 * ADR-0033: Modus und Modell der Session, direkt über der Eingabe. Gezeigt wird
 * nur, was der Adapter meldet; der Wechsel gilt ab dem nächsten Zug.
 */
export function SessionConfigure({
  session,
  features,
  api,
  onChanged,
}: {
  session: SessionRecord;
  features: HarnessFeatures | null;
  api: HubApi;
  onChanged: (patch: Partial<SessionRecord>) => void;
}) {
  const modes = features?.permissionModes ?? [];
  const canModel = features?.modelSwitch === true;
  const [models, setModels] = useState<{ id: string; label?: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!canModel) return;
    let alive = true;
    api
      .adapterModels(session.adapter)
      .then((res) => alive && setModels((prev) => (res.models && res.models.length > 0 ? res.models : prev)))
      .catch(() => undefined); // BUG-0049: a failed read keeps the list — the select must not turn into plain text and back
    return () => {
      alive = false;
    };
  }, [canModel, session.adapter, api]);

  if (modes.length === 0 && !canModel) return null;

  const change = async (patch: { model?: string; permissionMode?: string }) => {
    setBusy(true);
    setError("");
    const ack = await api.steer(session.id, { kind: "configure", ...patch }).catch((err: unknown) => ({ ok: false, detail: err instanceof Error ? err.message : t("common.change_failed") }));
    setBusy(false);
    if (ack.ok) onChanged(patch);
    else setError(ack.detail ?? t("session.change_not_possible"));
  };

  const current = session.model ?? "";
  const known = models.some((m) => m.id === current);
  return (
    <div class="session-configure">
      {modes.length > 0 && (
        <label>
          {t("common.mode")}
          <select
            aria-label={t("common.mode")}
            disabled={busy}
            value={session.permissionMode ?? ""}
            onChange={(e) => void change({ permissionMode: (e.target as HTMLSelectElement).value })}
          >
            {!session.permissionMode && <option value="">—</option>}
            {modes.map((m) => (
              <option key={m} value={m}>
                {MODE_LABEL[m] ?? m}
              </option>
            ))}
          </select>
        </label>
      )}
      {canModel && (
        <label>
          {t("common.model")}
          {models.length > 0 ? (
            <select aria-label={t("common.model")} disabled={busy} value={current} onChange={(e) => void change({ model: (e.target as HTMLSelectElement).value })}>
              {!current && <option value="">{t("common.standard")}</option>}
              {current && !known && <option value={current}>{current}</option>}
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label ?? m.id}
                </option>
              ))}
            </select>
          ) : (
            <span class="dim">{current || t("common.standard")}</span>
          )}
        </label>
      )}
      {error && <div class="reply-error">{error}</div>}
    </div>
  );
}
