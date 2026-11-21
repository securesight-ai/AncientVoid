import { t } from "../../shared/i18n/index.ts";
import { useEffect, useState } from "preact/hooks";
import type { HubApi, PcState } from "../../shared/api.ts";

/**
 * EPIC-P15 T15.4: ist die Session am PC in einem Terminal offen? Die interaktive
 * Claude Code liest ihr Transcript nicht neu — was vom Handy kommt, steht dort erst
 * nach dem erneuten Öffnen. Die App sagt das und nennt den Befehl, statt den PC
 * veraltet aussehen zu lassen.
 *
 * ADR-0036 (EPIC-P17 T17.3): the command comes from the adapter's declared
 * resume template when the hub sends one; the old hardcoded claude text stays
 * as the fallback for hubs/registrations without a declaration.
 */
export function PcOpenNotice({ sessionId, api, resume }: { sessionId: string; api: HubApi; resume?: { argv: string[]; ref: "native" | "token" } }) {
  const [pc, setPc] = useState<PcState>({ open: false });
  useEffect(() => {
    let alive = true;
    let closedInARow = 0;
    const load = () =>
      api
        .sessionPc(sessionId)
        .then((state) => {
          if (!alive) return;
          // BUG-0049: "closed" has to hold for three reads before the notice goes — one empty read
          // (a slow `claude agents`) must not make it blink and push the layout.
          closedInARow = state.open ? 0 : closedInARow + 1;
          if (!state.open && closedInARow < 3) return;
          setPc((prev) => (prev.open === state.open && prev.name === state.name && prev.kind === state.kind ? prev : state));
        })
        .catch(() => undefined); // ein Fehlschlag lässt den Hinweis stehen (BUG-0045)
    void load();
    const timer = setInterval(load, 10_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [sessionId, api]);
  if (!pc.open) return null;
  const short = (pc.nativeSessionId ?? "").slice(0, 8);
  // Display-only substitution (ADR-0036): a known provider id fills the
  // placeholder, an unknown one stays visible as such — never guessed.
  const resumeCmd = resume
    ? resume.argv
        .map((a) => (a === "{sessionId}" ? (pc.nativeSessionId ?? "<session-id>") : a === "{token}" ? "<resume-token>" : a))
        .join(" ")
    : `claude --resume ${pc.nativeSessionId}`;
  return (
    <div class="pc-open-notice dim" role="note">
      <strong>{t("session.open_on_pc")}{pc.name ? ` (${pc.name})` : ""}.</strong>{" "}
      {pc.kind === "background" ? (
        <>
          {t("session.background_session_live_with")} <code>{t("session.claude_attach")} {short}</code>.
        </>
      ) : (
        <>
          {t("session.what_you_send_shows_later")} <code>{resumeCmd}</code>.
        </>
      )}
    </div>
  );
}
