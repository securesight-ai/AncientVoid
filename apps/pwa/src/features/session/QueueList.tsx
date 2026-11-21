import { t } from "../../shared/i18n/index.ts";
import { useEffect, useState } from "preact/hooks";
import type { HubApi, QueuedPrompt } from "../../shared/api.ts";
import { Button } from "../../shared/ui/index.ts";

/**
 * EPIC-P15 T15.3: vorgemerkte Nachrichten — gehen der Reihe nach raus, sobald der Zug endet.
 * BUG-0114: zusätzlich je Eintrag sofort in den laufenden Zug sendbar.
 * ADR-0085: derselbe Eintrag lässt sich nachträglich umhängen (↑/↓ — "der Nächste" sein) und
 * in seinem Text ändern, solange er noch nicht unterwegs ist. Beides wirkt auf die Reihe,
 * wie sie der Hub hält; die Liste hier ist Ansicht, nicht Entscheidung.
 */
/**
 * ADR-0085: die gespeicherte Reihe bestimmt die Reihenfolge. Liefert ein aelterer Hub
 * keine Positionen, bleibt die Reihenfolge erhalten, die der Hub gesendet hat —
 * sonst rechnet `undefined - undefined` = NaN und die Liste wuerde willkuellr stehen.
 */
export function queueOrder(items: QueuedPrompt[]): QueuedPrompt[] {
  if (!items.every((q) => typeof q.position === "number")) return [...items];
  return [...items].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

export function QueueList({ sessionId, api, refreshKey }: { sessionId: string; api: HubApi; refreshKey: number }) {
  const [items, setItems] = useState<QueuedPrompt[]>([]);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .sessionQueue(sessionId)
        .then((list) =>
          alive &&
          setItems((prev) =>
            prev.length === list.length && prev.every((p, i) => p.id === list[i]!.id && p.delivery === list[i]!.delivery) ? prev : list,
          ),
        )
        .catch(() => undefined); // ein Fehlschlag lässt die Liste stehen (BUG-0045)
    void load();
    const timer = setInterval(load, 2500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [sessionId, api, refreshKey]);
  if (items.length === 0) return null;
  const sorted = queueOrder(items);
  /** Ein aelterer Hub (vor Migration 35) liefert keine Position — dann sind Text-
   *  und Reihen-Aenderung nicht moeglich, und die Knopfe bleiben zu (fail loud, nicht kaputt). */
  const speaksQueueOrder = items.length > 0 && items.every((q) => typeof q.position === "number");
  const replace = (list: QueuedPrompt[]) => setItems(list);
  const remove = (item: QueuedPrompt) => {
    setError("");
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    void api.removeQueued(sessionId, item.id).catch((err: unknown) => {
      // 404 = schon weg (gesendet oder anderswo gestrichen) — alles andere ehrlich zurückstellen.
      if ((err as { status?: unknown })?.status === 404) return;
      setItems((prev) => (prev.some((i) => i.id === item.id) ? prev : [...prev, item].sort((a, b) => a.createdAt.localeCompare(b.createdAt))));
      setError(t("session.remove_failed_kept"));
    });
  };
  const sendNow = (item: QueuedPrompt) => {
    setError("");
    void api
      .sendQueuedNow(sessionId, item.id)
      .then(() => setItems((prev) => prev.filter((i) => i.id !== item.id)))
      // 422 trägt den Ablehnungsgrund (Error-Message); der Hub hat die Nachricht dann wieder vorgemerkt.
      .catch((err) =>
        setError(`${err instanceof Error && err.message && !/^\d/.test(err.message) ? err.message : t("session.send_failed")} — die Nachricht bleibt vorgemerkt.`),
      );
  };
  /** ADR-0085: umhängen. Optimistisch, damit die Reihe sofort der gewählten folgt. */
  const move = (item: QueuedPrompt, where: "front" | "back") => {
    setError("");
    const idx = sorted.findIndex((q) => q.id === item.id);
    const to = where === "front" ? 0 : sorted.length - 1;
    if (idx === to) return;
    const next = [...sorted];
    next.splice(idx, 1);
    next.splice(to, 0, item);
    replace(next.map((q, i) => ({ ...q, position: i })));
    void api.editQueued(sessionId, item.id, { move: where }).catch(() => {
      setError(t("session.requeue_failed"));
      void api.sessionQueue(sessionId).then((list) => replace(list)).catch(() => undefined);
    });
  };
  /** ADR-0085: Text nachträglich ändern. */
  const saveEdit = () => {
    if (!editing) return;
    const text = editing.text.trim();
    const original = items.find((q) => q.id === editing.id);
    setEditing(null);
    if (!original || text === "" || text === original.text) return;
    setError("");
    replace(items.map((q) => (q.id === editing.id ? { ...q, text } : q)));
    void api.editQueued(sessionId, editing.id, { text }).catch(() => {
      setError(t("session.change_failed_kept"));
      void api.sessionQueue(sessionId).then((list) => replace(list)).catch(() => undefined);
    });
  };
  return (
    <div class="queue-list" aria-label={t("session.preset")}>
      <div class="queue-title dim">{t("session.preset_open")}{sorted.length}{t("session.goes_out_when_turn_ends")}</div>
      {error && <div class="reply-error" role="alert">{error}</div>}
      {sorted.map((item, i) => (
        <div key={item.id} class="queue-item">
          <span class="queue-pos dim">{i + 1}.</span>
          {editing?.id === item.id ? (
            <div class="queue-edit">
              <textarea
                class="queue-edit-input"
                aria-label={t("session.queue_edit", { "n": i + 1 })}
                value={editing.text}
                rows={3}
                onInput={(e) => setEditing({ id: item.id, text: (e.target as HTMLTextAreaElement).value })}
              />
              <div class="queue-edit-actions">
                <Button variant="primary" data-testid="queue-edit-save" onClick={saveEdit}>
                  {t("common.save")}
                </Button>
                <Button onClick={() => setEditing(null)}>
                  {t("common.cancel")}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <span class="queue-text">{item.text.length > 140 ? `${item.text.slice(0, 139)}…` : item.text}</span>
              {item.delivery === "unknown" && <span role="alert">{t("session.assumption_unclear")}</span>}
              {/* ADR-0085 + eigener Review: die Knöpfe unter dem Text — sonst bleibt auf
                  dem Handy (390 px) nur eine fünfzehn Zeichen lange Textspur übrig. */}
              <span class="queue-actions">
                <button
                  disabled={item.delivery === "unknown"}
                  class="icon-action"
                  type="button"
                  aria-label={t("session.queue_send_now", { "n": i + 1 })}
                  title={t("composer.send_into_running_turn")}
                  onClick={() => sendNow(item)}
                >
                  ➤
                </button>
                {/* ADR-0085: der Nächste in der Reihe werden — oder zurückfallen. */}
                <button
                  disabled={i === 0 || item.delivery === "unknown" || !speaksQueueOrder}
                  class="icon-action"
                  type="button"
                  data-testid="queue-move-front"
                  aria-label={t("session.queue_send_next", { "n": i + 1 })}
                  title={speaksQueueOrder ? t("session.send_next_now") : t("session.hub_cannot_queue")}
                  onClick={() => move(item, "front")}
                >
                  ↑
                </button>
                <button
                  disabled={i === sorted.length - 1 || item.delivery === "unknown" || !speaksQueueOrder}
                  class="icon-action"
                  type="button"
                  data-testid="queue-move-back"
                  aria-label={t("session.queue_to_back", { "n": i + 1 })}
                  title={speaksQueueOrder ? t("session.to_back") : t("session.hub_cannot_queue")}
                  onClick={() => move(item, "back")}
                >
                  ↓
                </button>
                <button
                  disabled={item.delivery === "unknown" || !speaksQueueOrder}
                  class="icon-action"
                  type="button"
                  data-testid="queue-edit"
                  aria-label={t("session.queue_edit", { "n": i + 1 })}
                  title={speaksQueueOrder ? t("session.edit_text") : t("session.hub_cannot_update")}
                  onClick={() => setEditing({ id: item.id, text: item.text })}
                >
                  ✎
                </button>
                <button class="icon-action danger" type="button" aria-label={t("session.queue_remove", { "n": i + 1 })} title={t("session.strikethrough")} onClick={() => remove(item)}>
                  ✕
                </button>
              </span>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
