import { t } from "./i18n/index.ts";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { clipToTtsCap, ttsPlayer, ttsStatus, type TtsStatus } from "./tts.ts";

/** UI-Entscheidung aus dem Hub-Status: nennt der Knopf einen Grund, ist er aus. */
export function ttsBlockReason(status: TtsStatus): "tts.reason_unconfigured" | "tts.reason_unreachable" | null {
  if (status.available) return null;
  // Eine gelaufene Probe (checkedMsAgo) heißt: eingerichtet, aber nicht erreichbar.
  return status.checkedMsAgo !== undefined ? "tts.reason_unreachable" : "tts.reason_unconfigured";
}

type Phase = "idle" | "loading" | "playing" | "error";

/**
 * EPIC-P75 (ADR-0097): Vorlesen-Knopf an Assistant-Nachrichten und Frage-
 * Karten. Der Tipp ist die Autoplay-Geste; ein zweiter Tipp stoppt. Ohne
 * Dienst ist der Knopf aus und nennt den Grund (Fail loud, nie still).
 * Text über dem Cap wird sichtbar gekürzt vorgelesen (Hub erzwingt 413).
 */
export function SpeakButton({ text, class: cls }: { text: string; class?: string }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [blocked, setBlocked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useRef(0);
  const truncated = useMemo(() => clipToTtsCap(text).truncated, [text]);

  useEffect(() => {
    let alive = true;
    void ttsStatus().then((status) => {
      if (alive) setBlocked(ttsBlockReason(status));
    });
    return () => {
      alive = false;
    };
  }, []);

  const toggle = async () => {
    if (phase === "playing") {
      ttsPlayer.stop();
      return;
    }
    if (phase === "loading") return;
    const mine = ++run.current;
    setPhase("loading");
    setError(null);
    try {
      const clipped = clipToTtsCap(text);
      const handle = await ttsPlayer.speak(clipped.text);
      if (run.current !== mine) return;
      setPhase("playing");
      await handle.ended;
      if (run.current !== mine) return;
      setPhase("idle");
    } catch (err) {
      if (run.current !== mine) return;
      setError(err instanceof Error ? err.message : t("tts.error"));
      setPhase("error");
    }
  };

  const label = phase === "loading" ? t("common.loading_dots") : phase === "playing" ? t("tts.stop") : phase === "error" ? t("tts.error") : blocked ? t(blocked === "tts.reason_unconfigured" ? "tts.play_setup" : "tts.play_offline") : t("tts.play");
  const hint = phase === "error" && error ? error : blocked ? t(blocked) : truncated ? t("tts.truncated_title") : undefined;

  return (
    <>
      <button
        type="button"
        class={`link-btn tts-btn${cls ? ` ${cls}` : ""}`}
        data-testid="tts-play"
        data-phase={phase}
        disabled={blocked !== null || phase === "loading"}
        title={hint ?? undefined}
        aria-label={`${t("tts.play")}${truncated ? ` — ${t("tts.truncated")}` : ""}${hint ? ` — ${hint}` : ""}`}
        onClick={(ev) => {
          ev.stopPropagation();
          void toggle();
        }}
      >
        {phase === "playing" ? "⏸" : "▶"} {label}
      </button>
      {truncated && phase !== "idle" && <span class="dim tts-cut">{t("tts.truncated")}</span>}
      {phase === "error" && error && <span class="dim tts-err">{error}</span>}
    </>
  );
}
