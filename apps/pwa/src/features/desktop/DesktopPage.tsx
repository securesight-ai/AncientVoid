import { t } from "../../shared/i18n/index.ts";
import { useEffect, useRef, useState } from "preact/hooks";
import { hubApi, type CompanionState, type DesktopAction } from "../../shared/api.ts";
import { Button, Card, EmptyState } from "../../shared/ui/index.ts";

/**
 * EPIC-P11 (ADR-0031): type on the PC from the phone. The page shows which
 * window has the focus there; "Eintippen" sends exactly that window as the
 * target — if the focus moved meanwhile, the hub says so and nothing is typed.
 * Spracheingabe: globaler Nyx-FAB (kein eigener Mic-Button mehr).
 */
const STATUS: Record<DesktopAction["status"], string> = {
  pending: "wartet",
  delivered: "abgeholt",
  running: "tippt…",
  done: "fertig",
  failed: "gestoppt",
  refused: "abgelehnt",
  cancelled: "abgebrochen",
  expired: "verfallen",
  uncertain: "ungewiss",
};
const KEYS: { key: string; label: string }[] = [
  { key: "Return", label: "↵ Enter" },
  { key: "Tab", label: "Tab" },
  { key: "Escape", label: "Esc" },
  { key: "undo", label: "Rückgängig" },
];

export function DesktopPage() {
  const [companions, setCompanions] = useState<CompanionState[] | null>(null);
  const [actions, setActions] = useState<DesktopAction[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [inputMode, setInputMode] = useState<"keystroke" | "targeted-paste">("keystroke");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // BUG-0047: the typed text is cleared only once the PC has really typed it.
  const sent = useRef<{ id: string; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = () =>
      hubApi
        .desktop()
        .then((d) => {
          if (!alive) return;
          setCompanions(d.companions);
          setActions(d.actions);
        })
        .catch((err: unknown) => alive && setError(err instanceof Error ? err.message : "nicht erreichbar"));
    void tick();
    const timer = setInterval(() => void tick(), 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const s = sent.current;
    const a = s ? actions.find((x) => x.id === s.id) : undefined;
    if (!s || !a) return;
    if (a.status === "done") setText((current) => (current === s.text ? "" : current));
    // Refused, failed, expired …: the person's text stays so nothing has to be typed again.
    if (["done", "failed", "refused", "cancelled", "expired", "uncertain"].includes(a.status)) sent.current = null;
  }, [actions]);

  const c = companions?.find((x) => x.name === chosen) ?? companions?.find((x) => x.online) ?? companions?.[0] ?? null;
  const ready = Boolean(c?.online && c.focus && !c.locked && !c.paused && !c.blocked);
  const textNeedsTargetedPaste = c?.backend === "hyprland" && inputMode !== "targeted-paste";

  const send = async (kind: "insert" | "replace" | "key", key?: string) => {
    if (!c?.focus) return;
    setBusy(true);
    setError("");
    try {
      // The target is the window shown right now — nothing else.
      const a = await hubApi.desktopAction({ companion: c.name, kind, ...(kind === "key" ? { key: key! } : { text, inputMode: c.backend === "hyprland" ? inputMode : "keystroke" }), target: { id: c.focus.id, revision: c.focus.revision } });
      setActions((all) => [a, ...all]);
      if (kind !== "key") sent.current = { id: a.id, text };
    } catch (err) {
      setError(err instanceof Error ? err.message : "abgelehnt");
    } finally {
      setBusy(false);
    }
  };

  if (companions === null) return <EmptyState text={t("common.loading_short")} />;
  if (companions.length === 0)
    return (
      <Card data-testid="desktop-setup">
        <h2>{t("common.type_at_pc")}</h2>
        <p>{t("desktop.no_pc_set_up")}</p>
        <pre class="desktop-cmd">{t("desktop.SKIP")}</pre>
        <p class="dim">{t("desktop.estop_hint")}</p>
      </Card>
    );

  return (
    <div class="desktop-page">
      <Card data-testid="desktop-target">
        {companions.length > 1 && (
          <select aria-label={t("desktop.pc")} value={c?.name ?? ""} onChange={(e) => setChosen((e.target as HTMLSelectElement).value)}>
            {companions.map((x) => (
              <option key={x.name} value={x.name}>
                {x.name} {x.online ? "" : "(offline)"}
              </option>
            ))}
          </select>
        )}
        <div class="desktop-head">
          <strong>{c?.name}</strong>
          <span class={`chip ${c?.online ? "ok" : "subtle"}`}>{c?.online ? "verbunden" : "offline"}</span>
          <span class="dim">{c?.backend}</span>
        </div>
        <div class="desktop-focus" aria-live="polite">
          {t("desktop.target")} {c?.focus ? (
            <>
              <strong>{c.focus.app}</strong> — {c.focus.title}
            </>
          ) : (
            "kein Fenster im Fokus"
          )}
        </div>
        {c?.paused && <div class="reply-error">{t("desktop.estop_active")}</div>}
        {c?.locked && <div class="reply-error">{t("desktop.pc_locked")}</div>}
        {c?.blocked && <div class="reply-error">{c.blocked}</div>}
      </Card>

      <Card class="desktop-input">
        <textarea rows={4} value={text} placeholder={t("desktop.text_typed_pc")} aria-label={t("desktop.text_for_pc")} maxLength={2000} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
        {c?.backend === "hyprland" && (
          <div class="dim" style="margin: 8px 0">
            <label style="display: flex; gap: 8px; align-items: flex-start">
              <input type="checkbox" checked={inputMode === "targeted-paste"} onChange={(e) => setInputMode((e.target as HTMLInputElement).checked ? "targeted-paste" : "keystroke")} />
              <span>{t("desktop.targeted_paste")}</span>
            </label>
            {textNeedsTargetedPaste && <div role="status">{t("desktop.text_locked")}</div>}
          </div>
        )}
        <div class="row" style="gap: 8px; flex-wrap: wrap">
          <Button disabled={!ready || busy || !text.trim() || textNeedsTargetedPaste} onClick={() => void send("insert")} variant="primary">
            {t("desktop.type")}
          </Button>
          <Button disabled={!ready || busy || !text.trim() || textNeedsTargetedPaste} onClick={() => void send("replace")} title={t("desktop.select_replace")}>
            {t("desktop.replace")}
          </Button>
        </div>
        <div class="row" style="gap: 6px; flex-wrap: wrap">
          {KEYS.map((k) => (
            <Button key={k.key} disabled={!ready || busy} onClick={() => void send("key", k.key)} class="subtle">
              {k.label}
            </Button>
          ))}
        </div>
        {error && <div class="reply-error">{error}</div>}
      </Card>

      {actions.length > 0 && (
        <Card>
          {actions.slice(0, 6).map((a) => (
            <div key={a.id} class={`desktop-action ${a.status}`}>
              <span  class="ui-chip">{STATUS[a.status]}</span> {a.kind === "key" ? `Taste ${a.key}` : `${a.textLength} Zeichen`} → {a.target.app}
              {a.detail && <div class="dim">{a.detail}</div>}
              {(a.status === "running" || a.status === "delivered" || a.status === "pending") && (
                <Button onClick={() => void hubApi.cancelDesktopAction(a.id)} class="subtle">
                  {t("common.cancel")}
                </Button>
              )}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
