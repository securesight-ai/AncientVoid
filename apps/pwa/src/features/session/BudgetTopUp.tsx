import { t } from "../../shared/i18n/index.ts";
import { useState } from "preact/hooks";
import { useApi } from "../../shared/api-context.ts";
import { Button, Card } from "../../shared/ui/index.ts";

/**
 * T1.6-4 — every row here has a named, real source (EPIC-P1.6 §3.3); "Tests"
 * has none today (no adapter emits a structured pass/fail signal, only free
 * text inside tool_result payloads) and says so instead of guessing (R9.7).
 * Kontingent-Wirkung is deliberately the adapter's CURRENT account-wide
 * snapshot, not a per-session before/after delta — computing a true delta
 * needs a "usage at session start" capture that doesn't exist yet; showing
 * the current snapshot honestly labeled beats a half-built delta.
 */
/**
 * T2.7 (EPIC-P2 §3 "Budget-Top-up (write-Klasse)") — shown only on a
 * session parked FOR BUDGET (ADR-0008's parkReason, never a manual park).
 * Success message differs depending on whether this hub gates it behind
 * an approval (still pending) or applied it immediately.
 */
export function BudgetTopUp({ sessionId, currentBudgetUsd }: { sessionId: string; currentBudgetUsd: number | null }) {
  const api = useApi();
  const [amount, setAmount] = useState(String(((currentBudgetUsd ?? 1) * 2).toFixed(2)));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const submit = async () => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return;
    setBusy(true);
    setMessage("");
    try {
      await api.requestBudgetTopUp(sessionId, value);
      setMessage(t("session.budget_topped_up"));
    } catch (err) {
      // A pending-approval response (422) throws here (see api.ts) — the
      // exact reason is still worth showing even though it's a real
      // request that succeeded in queuing, not a failure.
      setMessage(err instanceof Error ? err.message : "fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style="margin: 10px 0; display: grid; gap: 8px">
      <div>{t("session.paused_for_budget")}</div>
      <div style="display: flex; gap: 8px; align-items: center">
        <input
          type="number"
          step="0.01"
          min="0"
          value={amount}
          onInput={(e) => setAmount((e.target as HTMLInputElement).value)}
          style="width: 100px"
        />
        <span>{t("composer.budget_example")}</span>
      </div>
      <Button  aria-busy={busy} onClick={submit} disabled={busy} variant="primary" class={busy ? "busy" : undefined}>
        {busy ? t("common.loading_dots") : t("session.budget_top_up")}
      </Button>
      {message && <div class="dim" style="font-size: calc(12px * var(--font-scale, 1))">{message}</div>}
    </Card>
  );
}
