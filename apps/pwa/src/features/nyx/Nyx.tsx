import { t } from "../../shared/i18n/index.ts";
import type { ComponentChildren } from "preact";
import { Sheet, Button } from "../../shared/ui/index.ts";
import { createPortal } from "preact/compat";
import { useEffect, useRef, useState } from "preact/hooks";
import { hubApi, remoteHost, type ApprovalRequest, type SessionRecord } from "../../shared/api.ts";
import { registerShortcut } from "../../shared/shortcuts/registry.ts";
import { sessionHash } from "../../app/route.ts";
import { CardDecision, QuestionForm } from "../approvals/Approvals.tsx";
import { decidableOnCard } from "../overview/queue.ts";
import { DetachButton } from "../windows/DetachButton.tsx";
import { openPopout } from "../windows/windows.ts";
import { NYX_SPRITE, nyxSentence, nyxSummary, type NyxState, type NyxSummary } from "./nyx-state.ts";
import { projectName } from "../../shared/project-name.ts";

/**
 * Sprite-Atlas: Kopie aus VoidWarden (`web/public/nyx/nyx-atlas.{png,json}`, Commit 46430cf vom 2026-11-06,
 * Werk des Projekteigners; Herkunft und Prüfsummen in docs/design-system.md). Ein Streifen aus 64×64-Bildern,
 * Zustände nacheinander in dieser Reihenfolge. Keine Laufzeitabhängigkeit zu VoidWarden.
 */
const ATLAS: readonly { state: string; frames: number; ms: number }[] = [
  { state: "idle", frames: 7, ms: 130 },
  { state: "listening", frames: 5, ms: 110 },
  { state: "approval_pending", frames: 4, ms: 150 },
  { state: "executing", frames: 6, ms: 90 },
  { state: "success", frames: 3, ms: 120 },
  { state: "error", frames: 4, ms: 90 },
  { state: "offline", frames: 4, ms: 200 },
];

function spriteOf(state: NyxState): { from: number; n: number; ms: number } {
  const name = NYX_SPRITE[state];
  let from = 0;
  for (const s of ATLAS) {
    if (s.state === name) return { from, n: s.frames, ms: s.ms };
    from += s.frames;
  }
  return { from: 0, n: 1, ms: 130 };
}

/** Nyx als Bild — nur `transform` bewegt (K2); ohne Bewegung oder offline steht das erste Bild. */
export function NyxSprite({ state, size = 32 }: { state: NyxState; size?: number }) {
  const { from, n, ms } = spriteOf(state);
  return (
    <span class={`nyx-sprite nyx-${state}`} style={`--nyx-size:${size}px;--from:${from};--n:${n};--ms:${ms}`} aria-hidden="true">
      <img src="/nyx/nyx-atlas.png" alt="" width={size * 33} height={size} />
    </span>
  );
}

/** Wohin der Weg in die Session führt: im Hauptfenster der Hash, im eigenen Fenster ein Session-Fenster. */
type OpenSession = (sessionId: string, hostId: string | null) => void;
const openInApp: OpenSession = (sessionId, hostId) => (location.hash = sessionHash(sessionId, hostId));

const sessionName = (s: SessionRecord | undefined, req: ApprovalRequest) => s?.title ?? (s ? projectName(s.project) : undefined) ?? req.sessionId.slice(0, 8);

/** Eine wartende Anfrage im Blatt: Frage mit Optionen, entscheidbare Freigabe — oder der Weg in die Session. */
function NyxItem({ req, session, onDone, onOpen }: { req: ApprovalRequest; session: SessionRecord | undefined; onDone: () => void; onOpen: OpenSession }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const open = () => onOpen(req.sessionId, remoteHost(session?.hostId));
  const answer = async (decision: "approve" | "reject", answers?: Record<string, string>) => {
    setBusy(true);
    setError("");
    try {
      // Derselbe Weg wie Freigaben-Seite und Session (P21) — kein zweiter Antwortweg.
      await hubApi.decideApproval(req.id, decision, undefined, answers);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Antwort fehlgeschlagen");
      setBusy(false);
    }
  };
  const questions = req.tool?.questions;
  return (
    <li class="nyx-item" data-approval={req.id}>
      <button type="button" class="link-btn nyx-item-session" onClick={open}>
        {sessionName(session, req)}
      </button>
      {questions && questions.length > 0 ? (
        <QuestionForm questions={questions} busy={busy} preselect oneTap onAnswer={(a) => void answer("approve", a)} onReject={() => void answer("reject")} />
      ) : decidableOnCard(req) ? (
        <CardDecision req={req} onDecided={onDone} />
      ) : (
        <div class="nyx-item-elsewhere">
          <span>{req.reasonRequired ? "Braucht eine Begründung." : "Braucht deinen Passkey."}</span>
          <Button onClick={open}>
            {t("nyx.decide_in_session")}
          </Button>
        </div>
      )}
      {error && <div class="reply-error">{error}</div>}
    </li>
  );
}

function useNyx(online: boolean, sessions: readonly SessionRecord[], approvals: readonly ApprovalRequest[]) {
  const pending = approvals.filter((a) => a.status === "pending");
  const summary: NyxSummary = nyxSummary({
    online,
    sessions,
    pendingApprovals: pending.length,
    questionSessions: pending.filter((a) => (a.tool?.questions?.length ?? 0) > 0).map((a) => a.sessionId),
  });
  // Was zuerst abläuft, steht oben.
  const queue = [...pending].sort((a, b) => a.timeoutAt.localeCompare(b.timeoutAt));
  return { summary, sentence: nyxSentence(summary), queue };
}

/** Inhalt des Blatts — im Hauptfenster als Overlay, am PC auch als eigenes Fenster (ADR-0068). */
function NyxPanel({ online, sessions, approvals, onChanged, onOpen, actions }: { online: boolean; sessions: readonly SessionRecord[]; approvals: readonly ApprovalRequest[]; onChanged: () => void; onOpen: OpenSession; actions?: ComponentChildren }) {
  const { summary, sentence, queue } = useNyx(online, sessions, approvals);
  const byId = new Map(sessions.map((s) => [s.id, s]));
  return (
    <>
      <div class="nyx-sheet-head">
        <NyxSprite state={summary.state} size={64} />
        <p class="nyx-sentence">{sentence}</p>
        {actions}
      </div>
      {queue.length === 0 ? (
        <p class="dim nyx-empty">{t("nyx.nothing_waits")}</p>
      ) : (
        <ul class="nyx-list">
          {queue.map((req) => (
            <NyxItem key={req.id} req={req} session={byId.get(req.sessionId)} onDone={onChanged} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * EPIC-P43 T43.8: die kleine Nyx zeigt den Gesamtzustand; Antippen öffnet das Blatt mit allen wartenden
 * Freigaben und Fragen über alle Sessions. Nyx' Satz ist eine feste Vorlage (nyx-state.ts), nie Agenten-Text.
 */
export function NyxButton({ online, sessions, approvals, onChanged }: { online: boolean; sessions: readonly SessionRecord[]; approvals: readonly ApprovalRequest[]; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const { summary, sentence, queue } = useNyx(online, sessions, approvals);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    // Fokus rein/zurück übernimmt Sheet (useOverlayFocus). Esc: Registry + Sheet.
    const off = registerShortcut("nyx.close", (e) => {
      e.preventDefault();
      setOpen(false);
    });
    return off;
  }, [open]);
  return (
    <>
      <button ref={button} type="button" class="nyx-button" data-nyx={summary.state} aria-label={`Nyx: ${sentence}`} title={sentence} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        <NyxSprite state={summary.state} />
        {queue.length > 0 && <span class="nyx-count num">{queue.length}</span>}
      </button>
      {/* Ins <body>: die Kopfzeile ist ein eigener Stapelkontext (sticky, z-index 10) — darin läge das Blatt unter dem Dock. */}
      {open &&
        createPortal(
          <Sheet open onClose={() => setOpen(false)} label={t("nyx.nyx")} class="nyx-sheet">
            <NyxPanel
              online={online}
              sessions={sessions}
              approvals={approvals}
              onChanged={onChanged}
              onOpen={(id, host) => {
                setOpen(false);
                openInApp(id, host);
              }}
              actions={
                <>
                  <Button aria-label={t("common.close")} title={t("common.close")} onClick={() => setOpen(false)}>
                    ✕
                  </Button>
                  <DetachButton target={{ kind: "nyx" }} label={t("nyx.nyx")} onDetached={() => setOpen(false)} />
                </>
              }
            />
          </Sheet>,
          document.body,
        )}
    </>
  );
}

/** Nyx als eigenes Fenster: lädt Sessions und Freigaben selbst; der Weg in die Session öffnet ein Session-Fenster. */
export function NyxWindow() {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [online, setOnline] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [fleet, pending] = await Promise.all([hubApi.fleet().catch(async () => ({ sessions: await hubApi.sessions() })), hubApi.approvals("pending").catch(() => [] as ApprovalRequest[])]);
        if (!alive) return;
        setSessions(fleet.sessions);
        setApprovals(pending);
        setOnline(true);
      } catch {
        if (alive) setOnline(false);
      }
    };
    void load();
    const timer = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [tick]);
  return (
    <div class="nyx-window">
      <NyxPanel
        online={online}
        sessions={sessions}
        approvals={approvals}
        onChanged={() => setTick((n) => n + 1)}
        onOpen={(sessionId, hostId) => void openPopout({ kind: "session", sessionId, ...(hostId ? { hostId } : {}) })}
      />
    </div>
  );
}
