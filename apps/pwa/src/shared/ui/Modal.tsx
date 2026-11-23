import { t } from "../i18n/index.ts";
import { useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { Button } from "./Button.tsx";
import { Sheet } from "./Sheet.tsx";

/**
 * Das zentrierte Base-Modal im App-Style — baut auf Sheet (variant="modal")
 * auf und ersetzt überall die Browser-Standard-Dialoge: `ConfirmDialog` für
 * confirm(), `PromptDialog` für window.prompt(). Stile: styles/ui/modal.css.
 */

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Name für Screenreader (aria-label des Dialogs). */
  label: string;
  /** Überschrift im Modal-Kopf. */
  title: string;
  testid?: string;
  class?: string;
  children?: ComponentChildren;
}

export function Modal({ open, onClose, label, title, testid = "modal", class: cls, children }: ModalProps) {
  return (
    <Sheet open={open} onClose={onClose} label={label} variant="modal" testid={testid} class={["ui-modal", cls].filter(Boolean).join(" ")}>
      <h3 class="ui-modal-title">{title}</h3>
      <div class="ui-modal-body">{children}</div>
    </Sheet>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  body: ComponentChildren;
  /** Zerstörerische Bestätigung (Löschen, Stoppen) — färbt die Taste. */
  danger?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  testid?: string;
}

export function ConfirmDialog({ open, onClose, onConfirm, title, body, danger = false, confirmLabel, cancelLabel, busy = false, testid }: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={onClose} label={title} title={title} {...(testid ? { testid } : {})}>
      <p class="ui-modal-text">{body}</p>
      <div class="ui-modal-actions">
        <Button class="ui-modal-cancel" onClick={onClose}>{cancelLabel ?? t("common.cancel")}</Button>
        <Button class={`ui-modal-confirm${danger ? " danger" : ""}`} variant={danger ? "danger" : "primary"} disabled={busy} onClick={onConfirm}>{confirmLabel ?? t("common.ok")}</Button>
      </div>
    </Modal>
  );
}

export interface PromptDialogProps {
  open: boolean;
  onClose: () => void;
  /** Erhält den getrimmten Text — leer zählt wie window.prompt: nichts gescheit. */
  onSubmit: (text: string) => void;
  title: string;
  label?: string;
  value?: string;
  submitLabel?: string;
  cancelLabel?: string;
  testid?: string;
}

export function PromptDialog({ open, onClose, onSubmit, title, label, value = "", submitLabel, cancelLabel, testid }: PromptDialogProps) {
  const [draft, setDraft] = useState(value);
  return (
    <Modal open={open} onClose={onClose} label={title} title={title} {...(testid ? { testid } : {})}>
      <form
        class="ui-modal-form"
        onSubmit={(e) => {
          e.preventDefault();
          const text = draft.trim();
          if (text !== "") onSubmit(text);
        }}
      >
        {label && (
          <label class="ui-modal-field">
            {label}
            <input class="ui-modal-input" value={draft} autoFocus onInput={(e) => setDraft((e.target as HTMLInputElement).value)} />
          </label>
        )}
        <div class="ui-modal-actions">
          <Button class="ui-modal-cancel" type="button" onClick={onClose}>{cancelLabel ?? t("common.cancel")}</Button>
          <Button class="ui-modal-confirm" type="submit" variant="primary">{submitLabel ?? t("common.ok")}</Button>
        </div>
      </form>
    </Modal>
  );
}
