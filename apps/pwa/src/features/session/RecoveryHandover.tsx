import { t } from "../../shared/i18n/index.ts";
import { useEffect, useRef } from "preact/hooks";
import type { HubApi, SessionRecord } from "../../shared/api.ts";
import { HandoverForm } from "./Handover.tsx";

/** Native modal: focus trap, Escape, and controls above the fixed composer. */
export function RecoveryHandover({ session, api, onClose, onHandedOver }: {
  session: SessionRecord;
  api: HubApi;
  onClose: () => void;
  onHandedOver: (session: SessionRecord) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return <dialog ref={ref} class="recovery-handover" aria-label={t("session.hand_over_task")} onCancel={onClose}>
    <h2>{t("session.hand_over_task")}</h2>
    <HandoverForm session={session} api={api} onCancel={onClose} onHandedOver={onHandedOver} />
  </dialog>;
}
