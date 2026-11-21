import { t } from "../../shared/i18n/index.ts";
import { useEffect, useRef, useState } from "preact/hooks";
import { readStatusNote, saveStatusNote, STATUS_NOTE_EVENT } from "../../shared/status-notes.ts";

/** Persönliche Arbeitsnotiz; getrennt vom belegten Laufzeitstatus, gerätelokal wie Entwürfe. */
export function StatusNote({ sessionId }: { sessionId: string }) {
  const [text, setText] = useState(() => readStatusNote(sessionId));
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const sync = () => setText(readStatusNote(sessionId));
    sync();
    const open = () => {
      if (sessionStorage.getItem("ancientvoid.open-status-note") !== sessionId) return;
      sessionStorage.removeItem("ancientvoid.open-status-note");
      const menu = panel.current?.closest<HTMLDetailsElement>(".session-menu");
      if (menu) menu.open = true;
      input.current?.focus();
    };
    open();
    window.addEventListener("ancientvoid:open-status-note", open);
    window.addEventListener(STATUS_NOTE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener("ancientvoid:open-status-note", open); window.removeEventListener(STATUS_NOTE_EVENT, sync); window.removeEventListener("storage", sync); };
  }, [sessionId]);
  return <div class="session-status-note" ref={panel} role="group" aria-label={t("session.work_note")}>
    <span class="setting-title">{t("session.work_note_this_device")}</span>
    <label>{t("session.fachliche_statusnotiz")}<textarea ref={input} aria-label={t("session.fachliche_statusnotiz")} maxLength={400} rows={2} value={text} onInput={e => {
      const next = e.currentTarget.value;
      setText(next);
      try { saveStatusNote(sessionId, next); setError(""); } catch { setError(t("session.note_save_failed")); }
    }} /></label>
    <span class="dim">{t("session.own_note_not_sent")}</span>
    {error && <p role="alert">{error}</p>}
  </div>;
}
