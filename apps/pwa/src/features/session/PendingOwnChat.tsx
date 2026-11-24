import { t } from "../../shared/i18n/index.ts";
import { useEffect, useState } from "preact/hooks";
import type { HubApi, QueuedPrompt } from "../../shared/api.ts";
import { Button } from "../../shared/ui/index.ts";
import { pendingOwnRows } from "./pending-own.ts";

/**
 * BUG-0280: Die eigene Vorgemerke steht als eigene Zeile mit Status im Chat —
 * bisher gab es sie nur im Streifen unterhalb, und die lange Eingabe war im
 * Chat unsichtbar, bis sie rausging. Der Streifen bleibt die Verwaltung
 * (Umhängen, Jetzt senden); diese Zeilen zeigen in voller Länge, was wartet,
 * und lassen es bearbeiten und streichen. Ansicht, nicht Entscheidung — der
 * Hub führt die Reihe (ADR-0085).
 */
export function PendingOwnChat({ sessionId, api, refreshKey }: { sessionId: string; api: HubApi; refreshKey: number }) {
  const [items, setItems] = useState<QueuedPrompt[]>([]);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .sessionQueue(sessionId)
        .then((list) => alive && setItems(list))
        .catch(() => undefined); // ein Fehlschlag lässt die Ansicht stehen (BUG-0045), der nächste Takt holt nach
    void load();
    const timer = setInterval(load, 2500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [sessionId, api, refreshKey]);
  const rows = pendingOwnRows(items);
  if (rows.length === 0) return null;
  const reload = () => {
    void api
      .sessionQueue(sessionId)
      .then((list) => setItems(list))
      .catch(() => undefined);
  };
  const remove = (id: string) => {
    setError("");
    setItems((prev) => prev.filter((i) => i.id !== id));
    void api.removeQueued(sessionId, id).catch(() => {
      reload();
      setError(t("session.remove_failed_kept"));
    });
  };
  const saveEdit = (id: string, draft: string) => {
    const text = draft.trim();
    const original = items.find((q) => q.id === id);
    setEditing(null);
    if (!original || text === "" || text === original.text) return;
    setError("");
    setItems((prev) => prev.map((q) => (q.id === id ? { ...q, text } : q)));
    void api.editQueued(sessionId, id, { text }).catch(() => {
      reload();
      setError(t("session.change_failed_kept"));
    });
  };
  return (
    <div class="pending-own" aria-label={t("session.preset")}>
      {error && <div class="queue-error" role="alert">{error}</div>}
      {rows.map((row, i) => (
        <div key={row.id} class="pending-own-row" data-testid="pending-own-row">
          <div class="dim pending-own-meta">
            <span>{t("session.you_suffix", { "suffix": "" })} · {row.status === "unknown" ? t("session.assumption_unclear") : t("session.queue_waits_turn")}</span>
          </div>
          {editing?.id === row.id ? (
            <div class="queue-edit">
              <textarea
                class="queue-edit-input"
                data-testid="pending-own-edit-input"
                aria-label={t("session.queue_edit", { "n": i + 1 })}
                value={editing.text}
                rows={3}
                onInput={(e) => setEditing({ id: row.id, text: (e.target as HTMLTextAreaElement).value })}
              />
              <div class="queue-edit-actions">
                <Button variant="primary" data-testid="pending-own-edit-save" onClick={() => saveEdit(row.id, editing.text)}>
                  {t("common.save")}
                </Button>
                <Button onClick={() => setEditing(null)}>
                  {t("common.cancel")}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div class="pending-own-text">{row.text}</div>
              <div class="pending-own-actions">
                <Button data-testid="pending-own-edit" onClick={() => setEditing({ id: row.id, text: row.text })}>{t("session.queue_edit_word")}</Button>
                <Button data-testid="pending-own-remove" onClick={() => remove(row.id)}>{t("session.strikethrough")}</Button>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
