import { t } from "../../shared/i18n/index.ts";
import { useEffect, useState } from "preact/hooks";
import { hubApi, type ApprovalRequest, type HubApi, type ToolAssessment, type ToolQuestion } from "../../shared/api.ts";
import { startAuthentication } from "@simplewebauthn/browser";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { isYesNo, recommendedOption } from "../nyx/nyx-state.ts";
import { Button, EmptyState, Card } from "../../shared/ui/index.ts";

/** T7.3: what happened after the decision, in words. */
const OPERATION_LABEL: Partial<Record<NonNullable<ApprovalRequest["operation"]>["state"], string>> = {
  dispatching: t("approvals.will_execute"),
  done: t("approvals.executed"),
  failed: t("approvals.not_executed"),
  uncertain: t("approvals.execution_uncertain"),
};

/**
 * T2.6 (EPIC-P2 §4 "Approval-Queue (S4) mit Zeit-schleifen-Gruppierung und
 * Risiko-Badges"): a global inbox for every pending write/destructive
 * decision (ADR-0007), reached from the Dashboard's pending-count banner.
 *
 * Grouping is time-based ("Zeit…-Gruppierung"): what still needs a
 * decision right now vs. what was already decided, bucketed by how
 * recently — a reviewer cares about "what's live" far more than a flat
 * chronological list.
 */

function secondsLeft(timeoutAt: string): number {
  return Math.max(0, Math.round((new Date(timeoutAt).getTime() - Date.now()) / 1000));
}

function riskBadge(cls: ApprovalRequest["class"]) {
  if (cls === "destructive") return <span class="badge risk-destructive">{t("approvals.destructive_biometric")}</span>;
  return <span class="badge risk-write">{t("approvals.confirmation")}</span>;
}

/** T7.2: the arguments a provider wants to run, readable. */
function toolInputText(raw: string): string {
  try {
    const input = JSON.parse(raw) as Record<string, unknown>;
    if (typeof input.command === "string") return input.command;
    if (typeof input.file_path === "string") return input.file_path;
    return JSON.stringify(input, null, 2);
  } catch {
    return raw;
  }
}

/**
 * T7.2/T21.4: a provider question — the hybrid of what the harnesses do. Header chip and option
 * descriptions (claude), single vs. several choices stated plainly (claude/opencode), an own answer
 * that replaces the pick (codex "Other"), digit keys per question (terminal UIs), Enter sends once
 * everything is answered, and the summary of what will be sent stays visible (maki).
 */
/**
 * `preselect` (EPIC-P43 T43.8, Nyx-Blatt): die vom Agenten empfohlene Option steht vorgewählt — gesendet wird
 * trotzdem erst auf Tipp. `oneTap`: eine einzelne Ja/Nein-Frage antwortet mit dem Tipp auf die Option.
 */
export function QuestionForm({
  questions,
  busy,
  onAnswer,
  onReject,
  preselect = false,
  oneTap = false,
}: {
  questions: ToolQuestion[];
  busy: boolean;
  onAnswer: (answers: Record<string, string>) => void;
  onReject: () => void;
  preselect?: boolean;
  oneTap?: boolean;
}) {
  const [picked, setPicked] = useState<Record<string, string[]>>(() =>
    preselect ? Object.fromEntries(questions.flatMap((q) => (q.multiSelect || q.required === false ? [] : [[q.question, [recommendedOption(q.options)].filter((l): l is string => l !== null)]]))) : {},
  );
  const tapAnswers = oneTap && questions.length === 1 && !questions[0]!.multiSelect && isYesNo(questions[0]!.options);
  const [free, setFree] = useState<Record<string, string | undefined>>({});
  const pick = (q: ToolQuestion, label: string) => {
    if (busy) return;
    if (tapAnswers) {
      onAnswer({ [q.question]: label });
      return;
    }
    setFree((prev) => ({ ...prev, [q.question]: undefined }));
    setPicked((prev) => {
      const now = prev[q.question] ?? [];
      const next = q.multiSelect ? (now.includes(label) ? now.filter((l) => l !== label) : [...now, label]) : now.includes(label) ? [] : [label];
      return { ...prev, [q.question]: next };
    });
  };
  // An own answer replaces the pick — it is what the person actually wrote.
  const answers = Object.fromEntries(questions.flatMap((q) => {
    const answer = free[q.question]?.trim() || (picked[q.question] ?? []).join(", ");
    return answer ? [[q.question, answer]] : [];
  }));
  const answered = Object.keys(answers).length;
  const complete = questions.every(q => q.required === false || Object.hasOwn(answers, q.question));
  const send = () => {
    if (complete && !busy) onAnswer(answers);
  };
  const onKey = (q: ToolQuestion) => (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === "INPUT" || e.ctrlKey || e.metaKey || e.altKey) return;
    const n = /^[1-9]$/.test(e.key) ? Number(e.key) - 1 : -1;
    if (n >= 0 && q.options[n]) {
      e.preventDefault();
      pick(q, q.options[n]!.label);
    }
  };
  return (
    <div class="question-form">
      {questions.length > 1 && (
        <div class="question-progress" aria-live="polite">
          {answered} {t("common.word_of")} {questions.length} {t("approvals.answered")}
        </div>
      )}
      {questions.map((q) => (
        <div key={q.question} class={`question${answers[q.question] ? " answered" : ""}`} onKeyDown={onKey(q)}>
          {q.header && <span class="question-header">{q.header}</span>}
          <div class="question-text">{q.question}</div>
          {q.required === false && <div class="question-hint dim">{t("approvals.optional")}</div>}
          {q.options.length > 0 && <div class="question-hint dim">{q.multiSelect ? t("approvals.multiple_possible") : t("approvals.one_answer")} {t("approvals.key_hint")}{Math.min(q.options.length, 9)}</div>}
          <div class="choice-row" role="group" aria-label={q.question}>
            {q.options.map((o, i) => {
              const on = (picked[q.question] ?? []).includes(o.label) && !free[q.question]?.trim();
              return (
                <button
                  key={o.label}
                  type="button"
                  aria-pressed={on}
                  class={`choice ${on ? "active" : ""}`}
                  title={o.description}
                  disabled={busy}
                  onClick={() => pick(q, o.label)}
                >
                  <span class="choice-index">{i + 1}</span>
                  <span class="choice-body">
                    <span data-testid="choice-label">{o.label}</span>
                    {o.description && <span class="choice-desc">{o.description}</span>}
                  </span>
                </button>
              );
            })}
          </div>
          {q.options.length > 0 && free[q.question] === undefined ? (
            <Button disabled={busy} onClick={() => {
              setPicked(prev => ({ ...prev, [q.question]: [] }));
              setFree(prev => ({ ...prev, [q.question]: "" }));
            }}>
              {t("approvals.own_answer")}
            </Button>
          ) : <input
            class="question-free"
            aria-label={t("approvals.own_answer_q", { "q": q.question })}
            placeholder={t("approvals.own_answer_ph")}
            value={free[q.question] ?? ""}
            disabled={busy}
            autoFocus={q.options.length > 0}
            onInput={(e) => setFree((prev) => ({ ...prev, [q.question]: (e.target as HTMLInputElement).value }))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />}
        </div>
      ))}
      {complete && answered > 0 && questions.length > 1 && (
        <ul class="question-summary dim" aria-label={t("approvals.summary")}>
          {questions.filter(q => Object.hasOwn(answers, q.question)).map((q) => (
            <li key={q.question}>
              {q.question} → <strong>{answers[q.question]}</strong>
            </li>
          ))}
        </ul>
      )}
      <div class="approval-actions">
        <Button  disabled={busy || !complete} onClick={send} variant="primary" class={busy ? "busy" : undefined}>
          {busy ? t("common.loading_dots") : t("approvals.answer_verb")}
        </Button>
        <Button disabled={busy} onClick={onReject} variant="danger">
          {t("approvals.decline")}
        </Button>
      </div>
    </div>
  );
}

const RISK_TEXT: Record<ToolAssessment["toolRisk"], string> = {
  READ_ONLY: t("approvals.reads_only"),
  LOCAL_WRITE: t("approvals.writes_local"),
  DESTRUCTIVE: t("approvals.risk_destructive"),
  EXFILTRATION: t("approvals.risk_outbound"),
};
const GATE_TEXT: Record<ToolAssessment["securityGate"], string> = { CLEAN: t("approvals.risk_benign"), WARNING: t("approvals.look_closer"), CRITICAL_BLOCK: t("approvals.risk_critical") };
const SOURCE_TEXT: Record<ToolAssessment["source"], string> = { model: t("common.model"), rules: t("approvals.source_rules"), fallback: t("approvals.source_stricter") };

/** T7.9: the gatekeeper's label — a hint for the human, never a decision. */
function AssessmentBadge({ a }: { a: ToolAssessment }) {
  const conf = a.confidence.securityGate !== null ? ` · ${Math.round(a.confidence.securityGate * 100)} %` : "";
  return (
    <div class={`assessment gate-${a.securityGate}`} title={a.notes.join(" · ")}>
      <span class="assessment-gate">{t("approvals.laya_colon")} {GATE_TEXT[a.securityGate]}</span>
      <span >{RISK_TEXT[a.toolRisk]}</span>
      <span class="dim">
        {SOURCE_TEXT[a.source]}
        {conf}
      </span>
      {a.notes.length > 0 && <span class="assessment-notes dim">{a.notes.slice(0, 3).join(" · ")}</span>}
    </div>
  );
}

/**
 * EPIC-P43 T43.3: die Entscheidung auf der Karte der Übersicht — Befehl, Laya-Einschätzung, Restzeit,
 * Erlauben/Ablehnen. Nur für Freigaben, die ein Tipp entscheidet (overview/queue.ts: decidableOnCard);
 * derselbe Weg zum Hub wie `ApprovalCard`, kein zweiter.
 */
export function CardDecision({ req, onDecided, api = hubApi }: { req: ApprovalRequest; onDecided: () => void; api?: HubApi }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const decide = async (decision: "approve" | "reject") => {
    setBusy(true);
    setError("");
    try {
      await api.decideApproval(req.id, decision);
      onDecided();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("approvals.decision_failed"));
      setBusy(false);
    }
  };
  return (
    <div class="card-decision" data-approval={req.id}>
      <div class="card-decision-what">
        {req.tool ? (
          <>
            <span class="badge tool-badge">{req.tool.name}</span>
            <code class="card-decision-input mono">{toolInputText(req.tool.input)}</code>
          </>
        ) : (
          <span class="card-decision-input">{req.summary}</span>
        )}
      </div>
      {req.assessment && <AssessmentBadge a={req.assessment} />}
      {error && <div class="reply-error">{error}</div>}
      <div class="card-decision-actions">
        <Button aria-busy={busy} disabled={busy} onClick={() => void decide("approve")} variant="primary" class={busy ? "busy" : undefined}>
          {req.tool ? t("approvals.allow") : t("approvals.approve")}
        </Button>
        <Button disabled={busy} onClick={() => void decide("reject")} variant="danger">
          {t("approvals.decline")}
        </Button>
        <span class="card-decision-left num dim">{t("approvals.still")} {secondsLeft(req.timeoutAt)} s</span>
      </div>
    </div>
  );
}

export function ApprovalCard({ req, onDecided, api = hubApi }: { req: ApprovalRequest; onDecided: () => void; api?: HubApi }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = req.status === "pending";
  const destructive = req.class === "destructive";
  const questions = req.tool?.questions;
  const isQuestion = req.action === "tool.question" || Boolean(questions?.length);

  const decide = async (decision: "approve" | "reject", answers?: Record<string, string>) => {
    setBusy(true);
    setError("");
    try {
      await api.decideApproval(req.id, decision, reason || undefined, answers);
      onDecided();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("approvals.decision_failed"));
    } finally {
      setBusy(false);
    }
  };

  // T2.5: the real biometric path for destructive approvals — a fresh
  // WebAuthn assertion ceremony per decision, never a cached/reused one.
  const decideBiometric = async (decision: "approve" | "reject") => {
    setBusy(true);
    setError("");
    try {
      const options = (await api.webauthnAssertOptions(req.id)) as PublicKeyCredentialRequestOptionsJSON;
      const assertion = await startAuthentication({ optionsJSON: options });
      await api.decideApprovalBiometric(req.id, decision, assertion, reason || undefined);
      onDecided();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("approvals.biometric_failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card class="approval-card">
      <div class="approval-card-head">
        {isQuestion ? <span class="badge question">{t("notifications.section_question")}</span> : riskBadge(req.class)}
        {pending && <span class="approval-countdown mono">{t("approvals.expires_in")} {secondsLeft(req.timeoutAt)}s</span>}
        {!pending && <span class={`badge status-${req.status}`}>{req.status}</span>}
      </div>
      {req.assessment && <AssessmentBadge a={req.assessment} />}
      {req.tool && !req.tool.questions ? (
        <>
          <div class="approval-summary">
            <span class="badge tool-badge">{req.tool.name}</span> {t("approvals.wants_to_run")}
          </div>
          <pre class="tool-input mono">{toolInputText(req.tool.input)}</pre>
        </>
      ) : (
        <div class="approval-summary">{req.summary}</div>
      )}
      <div class="dim" style="font-size: calc(11px * var(--font-scale, 1))">
        {t("common.session_cap")} {req.sessionId.slice(0, 8)} · {req.action}
      </div>

      {pending && !!questions?.length && (
        <>
          {error && <div style="color: var(--err); font-size: calc(12px * var(--font-scale, 1))">{error}</div>}
          <QuestionForm questions={questions} busy={busy} onAnswer={(answers) => void decide("approve", answers)} onReject={() => void decide("reject")} />
        </>
      )}
      {pending && isQuestion && !questions?.length && (
        <>
          <p role="alert">{t("approvals.no_question")}</p>
          {error && <p role="alert">{error}</p>}
          <Button disabled={busy} onClick={() => void decide("reject")} variant="danger">{t("approvals.decline")}</Button>
        </>
      )}
      {pending && !isQuestion && (
        <>
          {req.reasonRequired && (
            <textarea
              class="approval-reason"
              placeholder={t("approvals.reason_required_ph")}
              value={reason}
              onInput={(e) => setReason((e.target as HTMLTextAreaElement).value)}
            />
          )}
          {error && <div style="color: var(--err); font-size: calc(12px * var(--font-scale, 1))">{error}</div>}
          <div class="approval-actions">
            {destructive ? (
              <>
                <Button
                  
                  aria-busy={busy}
                  disabled={busy || (req.reasonRequired && !reason.trim())}
                  onClick={() => decideBiometric("approve")}
                 variant="primary" class={busy ? "busy" : undefined}>
                  {busy ? t("common.loading_dots") : t("approvals.passkey_approve")}
                </Button>
                <Button  aria-busy={busy} disabled={busy} onClick={() => decideBiometric("reject")} variant="danger" class={busy ? "busy" : undefined}>
                  {busy ? t("common.loading_dots") : t("approvals.decline")}
                </Button>
              </>
            ) : (
              <>
                <Button
                  
                  aria-busy={busy}
                  disabled={busy || (req.reasonRequired && !reason.trim())}
                  onClick={() => decide("approve")}
                 variant="primary" class={busy ? "busy" : undefined}>
                  {busy ? t("common.loading_dots") : req.tool ? t("approvals.allow") : t("approvals.approve")}
                </Button>
                <Button  aria-busy={busy} disabled={busy} onClick={() => decide("reject")} variant="danger" class={busy ? "busy" : undefined}>
                  {busy ? t("common.loading_dots") : t("approvals.decline")}
                </Button>
              </>
            )}
          </div>
        </>
      )}

      {!pending && req.reason && <div class="dim" style="font-size: calc(11px * var(--font-scale, 1)); margin-top: 4px">{t("approvals.reason_colon")} {req.reason}</div>}
      {!pending && req.decidedByLabel && (
        <div class="dim" style="font-size: calc(11px * var(--font-scale, 1))">
          {t("approvals.decided_by")} {req.decidedByLabel} {t("approvals.signed")} {req.signature ? "✓" : "—"}
        </div>
      )}
      {!pending && req.operation && OPERATION_LABEL[req.operation.state] && (
        <div class={`approval-outcome ${req.operation.state}`}>
          {OPERATION_LABEL[req.operation.state]}
          {req.operation.state !== "done" && req.operation.outcome ? ` — ${req.operation.outcome}` : ""}
        </div>
      )}
    </Card>
  );
}

export function ApprovalQueuePane() {
  const [items, setItems] = useState<ApprovalRequest[] | null>(null);
  const [unsupported, setUnsupported] = useState(false);

  const reload = () => {
    hubApi
      .approvals()
      .then((res) => setItems(res))
      .catch((err) => {
        // A hub without ApprovalService configured answers 501 — an
        // honest "this hub doesn't have this feature on", not a broken load.
        if (err instanceof Error && err.message.includes("501")) setUnsupported(true);
        setItems([]);
      });
  };

  useEffect(() => {
    reload();
    const timer = setInterval(reload, 3000);
    return () => clearInterval(timer);
  }, []);

  if (unsupported) {
    return <EmptyState text={t("session.approval_queue_unconfigured")} />;
  }
  if (items === null) return <EmptyState text={t("common.loading")} />;

  const now = Date.now();
  const pending = items.filter((i) => i.status === "pending");
  const recent = items.filter((i) => i.status !== "pending" && i.decidedAt && now - new Date(i.decidedAt).getTime() < 10 * 60_000);
  const older = items.filter((i) => !pending.includes(i) && !recent.includes(i)).slice(0, 20);

  return (
    <div>
      <h2 class="approval-group-heading">{t("approvals.waiting_for_you")}{pending.length})</h2>
      {pending.length === 0 ? (
        <div class="ui-empty">{t("approvals.no_open")}</div>
      ) : (
        pending.map((r) => <ApprovalCard key={r.id} req={r} onDecided={reload} />)
      )}

      {recent.length > 0 && (
        <>
          <h2 class="approval-group-heading">{t("approvals.recently_decided")}</h2>
          {recent.map((r) => (
            <ApprovalCard key={r.id} req={r} onDecided={reload} />
          ))}
        </>
      )}

      {older.length > 0 && (
        <>
          <h2 class="approval-group-heading">{t("approvals.older")}</h2>
          {older.map((r) => (
            <ApprovalCard key={r.id} req={r} onDecided={reload} />
          ))}
        </>
      )}
    </div>
  );
}
