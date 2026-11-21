import { fmtDateTime } from "../shared/i18n/format.ts";
import { loadFilter } from "../features/session/event-filter.ts";
import { contentHash } from "../features/workspace/content.ts";
import { onWorkspaceOpen } from "../features/workspace/open-content.ts";
import { onLayerOpen } from "../shared/layers.ts";
import { initPresentation, type DevicePreset } from "../features/settings/presets.ts";
import { TooltipLayer } from "../shared/Tooltip.tsx";
import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { App } from "./App.tsx";
import { SessionTail } from "../features/session/SessionTail.tsx";
import { getToken, isAuthError, setToken, hubApi, hostApi, remoteHost, setSelfHostId, type SessionRecord } from "../shared/api.ts";
import { resyncPush } from "../shared/push.ts";
import { CommandBar } from "../features/commands/CommandBar.tsx";
import { pageHash, parseAppHash, redirectLegacyRunHash, sessionHash, type CodeTarget, type TailTab } from "./route.ts";
import { registerShortcut } from "../shared/shortcuts/registry.ts";
import { CheatSheet } from "../shared/shortcuts/CheatSheet.tsx";
import { installShortcutHints } from "../shared/shortcut-hint.ts";
import { installSoundUnlock } from "../shared/audio.ts";
import { classifyGateError, gateMessage, lastHubContact, noteHubContact } from "./token-gate.ts";
import { applyTheme, getTheme } from "./theme.ts";
import { t, applyLanguage } from "../shared/i18n/index.ts";
import { initAppearance } from "./appearance.ts";
import { applyPinchZoom, pinchZoomAllowed } from "./zoom.ts";
import { applyCtxMotion, applyScale, ctxMotionOn, getScale, installScaleShortcuts } from "./ui-scale.ts";
import { captureShareTarget, storeShareInbox } from "./share-inbox.ts";
import { NotificationCenter } from "../features/notifications/Notifications.tsx";
import { TileWorkspace } from "../features/workspace/TileWorkspace.tsx";
import { StatusBar } from "../features/shell/StatusBar.tsx";
import { getHubStatus } from "../features/shell/hub-status.ts";
import { rememberSession } from "../features/shell/last-session.ts";
import { FilesLayer } from "../features/files/FilesLayer.tsx";
import { BrowserLayer } from "../features/browser/BrowserLayer.tsx";
import { DeviceLayer } from "../features/devices/DeviceLayer.tsx";
import { RestoreBar } from "../features/windows/RestoreBar.tsx";
import { PopoutShell } from "../features/windows/PopoutShell.tsx";
import type { DropPoint } from "../features/windows/drag.ts";
import { focusWindowFor, isPopoutWindow, onWindowMessage, openPopout, startWindowHub } from "../features/windows/windows.ts";
import { detachTile, focusOpenSession, forgetDetached, openInNewTile, openInTile, parseWorkspace, reattach, serializeWorkspace, visibleTiles, type TileRef, type Workspace } from "../features/workspace/tiles.ts";
import { targetKey } from "../features/windows/protocol.ts";
import { NyxFab } from "../features/stt/NyxFab.tsx";
import type { Page } from "./Dock.tsx";
import "./styles/index.css";
import { Button } from "../shared/ui/index.ts";
import { ClipboardShelf } from "../features/clipboard/ClipboardShelf.tsx";

// T1.6-2: applied before the first render so a stored "light" preference
// never flashes dark first — index.html's data-theme="dark" was previously
// the only value that ever existed.
applyTheme(getTheme());
// EPIC-P61 (ADR-0101): <html lang> folgt der Geräte-Sprache, vor dem ersten Paint.
applyLanguage();
// EPIC-P34 T34.4: Akzentfarbe, Schrift und Größe dieses Geräts, ebenfalls vor dem ersten Paint.
initAppearance();
initPresentation();
applyPinchZoom(pinchZoomAllowed());
// EPIC-P20: UI scale (Ctrl+wheel, Ctrl +/−/0) and the context-bar shimmer, before the first paint.
applyScale(getScale());
applyCtxMotion(ctxMotionOn());
installScaleShortcuts();
// EPIC-P51 T51.8: Kürzel-Hinweis-Pill bei Klicks auf Elemente mit Shortcut.
installShortcutHints();
// EPIC-P65: WebAudio-Wiedergabe — die erste Geste entsperrt den Context (Premortem P65-1).
installSoundUnlock();

function TokenGate({ onReady, rejected }: { onReady: () => void; rejected: string }) {
  const [token, setVal] = useState(getToken());
  const [error, setError] = useState("");
  // BUG-0054: the automatic check fails after the first paint. Without this,
  // a stored token that the hub rejects leaves a filled field and "Verbinden"
  // and no reason.
  useEffect(() => {
    if (rejected) setError(rejected);
  }, [rejected]);
  const [checking, setChecking] = useState(false);
  // Real find: a hidden, case-sensitive, hyphen-containing token typed on a
  // phone keyboard is exactly the kind of input mobile autocorrect/
  // autocapitalize silently mangles, and type="password" means the user
  // can never see what actually landed in the field to catch it.
  const [reveal, setReveal] = useState(false);

  const submit = async () => {
    // EPIC-P57 T57.9: ein leeres Token braucht keinen Hub-Aufruf — gleich sagen, woher es kommt.
    if (token.trim() === "") {
      setError(gateMessage("empty", ""));
      return;
    }
    setChecking(true);
    setError("");
    try {
      setToken(token.trim());
      // BUG-0006 (part 2): health() needs no token, so this used to
      // "verify" an empty or wrong token as valid — the actual API calls
      // would then 401 on the very next screen. adapters() is protected.
      await hubApi.adapters();
      onReady();
    } catch (err) {
      setError(gateMessage(classifyGateError(err), err instanceof Error ? err.message : "connection failed", lastHubContact()));
    } finally {
      setChecking(false);
    }
  };

  return (
    <div class="card form-grid" style="margin-top: 20vh">
      <img class="login-artwork" src="/assets/artwork-tempel.webp" alt="" width="1280" height="720" />
      <h2 style="margin: 0">{t("app.sign_in")}</h2>
      <p class="dim" style="margin: 0">
        {t("app.token_intro_1")} <code>hubctl token issue &lt;label&gt;</code> {t("app.token_intro_2")}
      </p>
      <label>
        {t("common.device_token")}
        <div style="display: flex; gap: 8px">
          <input
            // Preact 11 typisiert <input> je type-Variante; ein Literal-Union passt zu keiner.
            {...(reveal ? { type: "text" as const } : { type: "password" as const })}
            value={token}
            onInput={(e) => setVal((e.target as HTMLInputElement).value)}
            placeholder={t("app.token_placeholder")}
            autocapitalize="off"
            autocorrect="off"
            autocomplete="off"
            spellcheck={false}
            style="flex: 1"
          />
          <Button
            onClick={() => setReveal((v) => !v)}
            title={reveal ? t("common.hide_token") : t("common.show_token")}
          >
            {reveal ? "🙈" : "👁"}
          </Button>
        </div>
      </label>
      {error && (
        <div role="alert" style="color: var(--err)">
          {error}
        </div>
      )}
      <Button  aria-busy={checking} onClick={submit} disabled={checking} variant="primary" class={checking ? "busy" : undefined}>
        {checking ? t("common.loading_dots") : t("common.connect")}
      </Button>
    </div>
  );
}

/** Ab 700 px teilen sich PC und Tablet den Kachel-Arbeitsplatz (dabe85d5) — aber nur
 * bei nutzbarer Höhe: im Handy-Querformat (≤ 520 px, BUG-0053) bleibt das Mobil-Layout
 * mit seiner Verdichtung, sonst frisst der Kachelkopf den Verlauf auf. */
const WIDE = "(min-width: 700px) and (min-height: 521px)";
const WORKSPACE_KEY = "ancientvoid.workspace";
const LIST_COLLAPSED_KEY = "ancientvoid.listCollapsed";

function defaultSessionRef(ref: TileRef): TileRef {
  return ref.content ? ref : { ...ref, content: { kind: "session", tab: loadFilter() === "lesen" ? "chat" : "verlauf" } };
}

function tileRefOf(session: SessionRecord): TileRef {
  const host = remoteHost(session.hostId);
  return defaultSessionRef(host ? { sessionId: session.id, hostId: host } : { sessionId: session.id });
}

function useMedia(query: string): boolean {
  const [hit, setHit] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const on = () => setHit(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return hit;
}

function Main() {
  const [ready, setReady] = useState(false);
  const [gateError, setGateError] = useState("");
  // EPIC-P6: know this hub's host id before any session opens, so its own
  // sessions keep short links and direct calls.
  const becomeReady = () => {
    // Token validation is the login gate; fleet discovery must not keep the
    // user on the token form when a peer or local handshake is slow.
    setReady(true);
    void hubApi
      .fleetHello()
      .then((h) => setSelfHostId(h.hostId))
      .catch(() => setSelfHostId(null));
  };
  const [route, setRoute] = useState<
    { view: "list"; page: Page; vaultFile?: string; vaultTab?: "wissen" } | { view: "tail"; session: SessionRecord; code?: CodeTarget; tab?: TailTab; file?: string }
  >({ view: "list", page: "dashboard" });

  useEffect(() => {
    // BUG-0006 (part 2): /api/health is deliberately open (tailnet
    // monitoring) — using it here to decide "ready" meant this always
    // succeeded regardless of whether a valid token existed, so
    // TokenGate could never actually appear for a device without one.
    // adapters() is a real, token-protected endpoint.
    // BUG-0015 / T8.2: offline (no network, 503 from the service worker) is
    // not a wrong token — with a token, start on the cached data.
    hubApi
      .adapters()
      .then(() => {
        void becomeReady();
        // T8.3: a rotated push subscription is registered again.
        void resyncPush();
        navigator.serviceWorker?.addEventListener("message", (e) => {
          const msg = e.data as { type?: string; url?: string };
          if (msg?.type === "ancientvoid:push-resubscribe") void resyncPush();
          // Notification tap in an already open app: route by hash (navigate() is unreliable on mobile).
          if (msg?.type === "ancientvoid:navigate" && msg.url?.startsWith("/#")) location.hash = msg.url.slice(1);
        });
        // A phone suspends the app for hours; re-register the subscription when it comes back.
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") void resyncPush();
        });
      })
      .catch((err) => {
        if (getToken() && !isAuthError(err)) void becomeReady();
        else {
          setReady(false);
          // BUG-0054: a rejected stored token used to leave the gate silent.
          if (getToken()) setGateError(gateMessage(classifyGateError(err), err instanceof Error ? err.message : t("app.login_rejected"), lastHubContact()));
        }
      });
  }, []);

  useEffect(() => {
    const onStale = (e: Event) => {
      const at = new Date(String((e as CustomEvent<string>).detail ?? ""));
      setStaleAt(Number.isNaN(at.getTime()) ? new Date() : at);
    };
    // BUG: die Meldung verschwand nur beim „online”-Event des Browsers. Netz an,
    // Hub aber unreachable (unterwegs/Tailnet zu) → Cache-Badge erscheint; kam der
    // Hub zurück, flossen frische Daten, die Meldung blieb trotzdem stehen. Eine
    // erfolgreiche Antwort ohne Cache-Marker (api.ts) löscht sie jetzt ebenfalls.
    const onFresh = () => {
      setStaleAt(null);
      // EPIC-P57 T57.9 / K10: wann dieses Gerät den Hub zuletzt live erreicht hat — das Token-Gate nennt es bei „nicht erreichbar“.
      noteHubContact();
    };
    const onOnline = () => setStaleAt(null);
    window.addEventListener("online", onOnline);
    document.addEventListener("ancientvoid:stale-data", onStale);
    document.addEventListener("ancientvoid:fresh-data", onFresh);
    return () => {
      document.removeEventListener("ancientvoid:stale-data", onStale);
      document.removeEventListener("ancientvoid:fresh-data", onFresh);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const openFromHash = () => {
      // EPIC-P60 (AC-P60-1): alte `#/runs…`-Links permanent auf `#/teams…`
      // umleiten — der Hash-Replace löst einen neuen hashchange aus.
      const redirected = redirectLegacyRunHash(location.hash);
      if (redirected !== null && redirected !== location.hash) {
        location.hash = redirected;
        return;
      }
      const parsed = parseAppHash(location.hash);
      if (parsed.view === "devices") {
        // EPIC-P42: `#/geraete` ist die Fenster-Route des Popouts; im Hauptfenster geht es zur Übersicht
        // (das Panel öffnet sich über den Geräte-Knopf).
        setRoute({ view: "list", page: "dashboard" });
        return;
      }
      if (parsed.view === "filetree") {
        // BUG-0128: `#/dateibaum` ist die Fenster-Route des Dateibaum-Popouts; im Hauptfenster geht es zur Übersicht.
        setRoute({ view: "list", page: "dashboard" });
        return;
      }
      if (parsed.view !== "tail") {
        setRoute({ view: "list", page: parsed.page, ...(parsed.vaultFile ? { vaultFile: parsed.vaultFile } : {}), ...(parsed.vaultTab ? { vaultTab: parsed.vaultTab } : {}) });
        return;
      }
      hostApi(parsed.hostId)
        .session(parsed.sessionId)
        .then((session) =>
          setRoute({ view: "tail", session, ...(parsed.code ? { code: parsed.code } : {}), ...(parsed.tab ? { tab: parsed.tab } : {}), ...(parsed.file ? { file: parsed.file } : {}) }),
        )
        .catch(() => setRoute({ view: "list", page: "dashboard" }));
    };
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    return () => window.removeEventListener("hashchange", openFromHash);
  }, [ready]);

  const [staleAt, setStaleAt] = useState<Date | null>(null);
  const wide = useMedia(WIDE);
  const filesWide = useMedia("(min-width: 1280px)");

  // EPIC-P18 T18.5: layout and tiles are this device's choice; the hash
  // follows the focused tile (replaceState: focus moves are no history).
  const [listCollapsed, setListCollapsed] = useState(() => localStorage.getItem(LIST_COLLAPSED_KEY) === "1");
  const [ws, setWs] = useState(() => {
    const stored = parseWorkspace(localStorage.getItem(WORKSPACE_KEY));
    return { ...stored, slots: stored.slots.map((ref) => ref ? defaultSessionRef(ref) : null) };
  });
  const changeWorkspace = (next: Workspace) => {
    setWs(next);
    localStorage.setItem(WORKSPACE_KEY, serializeWorkspace(next));
    const focused = visibleTiles(next)[next.focus];
    rememberSession(focused?.sessionId ? focused : null);
    const hash = contentHash(focused);
    // Each card owns its target, so focusing a chat must also clear another card's file suffix.
    if (location.hash !== hash) history.replaceState(null, "", hash);
  };
  // EPIC-P34 T34.10: eigene Fenster. Der Kanal-Handler läuft über Referenzen, damit er immer den neuesten Stand sieht.
  const latest = useRef({ ws, changeWorkspace });
  latest.current = { ws, changeWorkspace };
  useEffect(() => {
    const restore = (e: Event) => {
      const layout = (e as CustomEvent<DevicePreset["layout"]>).detail;
      const current = latest.current.ws;
      latest.current.changeWorkspace({ ...current, layout: layout.kind, focus: 0, sizes: { col: layout.col, row: layout.row, col2: layout.col2 } });
    };
    window.addEventListener("ancientvoid:restore-layout", restore);
    return () => window.removeEventListener("ancientvoid:restore-layout", restore);
  }, []);
  const [popoutNotice, setPopoutNotice] = useState("");
  const [retryPopout, setRetryPopout] = useState<(() => void) | null>(null);
  useEffect(() => {
    /** BUG-0245: Reload sendet auch `bye` — kurz warten, ob dasselbe Ziel neu `hello` sagt, sonst `detached` wegräumen. */
    const FORGET_GRACE_MS = 1500;
    const pendingForget = new Map<string, ReturnType<typeof setTimeout>>();
    const stop = startWindowHub();
    const off = onWindowMessage((msg) => {
      if (msg.type === "hello") {
        const key = targetKey(msg.target);
        const wait = pendingForget.get(key);
        if (wait) {
          clearTimeout(wait);
          pendingForget.delete(key);
        }
      }
      if (msg.type === "bye" && msg.target?.kind === "session") {
        const target = msg.target;
        const key = targetKey(target);
        const prev = pendingForget.get(key);
        if (prev) clearTimeout(prev);
        pendingForget.set(
          key,
          setTimeout(() => {
            pendingForget.delete(key);
            const ref: TileRef = target.hostId ? { sessionId: target.sessionId, hostId: target.hostId } : { sessionId: target.sessionId };
            latest.current.changeWorkspace(forgetDetached(latest.current.ws, defaultSessionRef(ref)));
          }, FORGET_GRACE_MS),
        );
      }
      if (msg.type !== "return" || msg.target.kind !== "session") return;
      const ref: TileRef = msg.target.hostId ? { sessionId: msg.target.sessionId, hostId: msg.target.hostId } : { sessionId: msg.target.sessionId };
      latest.current.changeWorkspace(reattach(latest.current.ws, defaultSessionRef(ref)));
    });
    return () => {
      off();
      stop();
      for (const wait of pendingForget.values()) clearTimeout(wait);
      pendingForget.clear();
    };
  }, []);
  const blockedNotice = t("app.popup_blocked");
  const popoutTile = async (index: number, drop?: DropPoint) => {
    const ref = latest.current.ws.slots[index];
    if (!ref) return;
    const result = await openPopout({ kind: "session", sessionId: ref.sessionId, ...(ref.hostId ? { hostId: ref.hostId } : {}) }, drop);
    if (result === "blocked") {
      setPopoutNotice(blockedNotice);
      // Rückfall der Ziehgeste: die Nutzeraktion kann abgelaufen sein — ein Klick auf den Knopf ist eine frische.
      setRetryPopout(() => () => void popoutTile(index));
      return;
    }
    setPopoutNotice("");
    // BUG-0245: nur neu geöffnete Fenster lösen die Kachel — „focused“ heißt das Fenster war schon da.
    if (result === "opened") latest.current.changeWorkspace(detachTile(latest.current.ws, index));
  };
  // Opening a session adds a card; already detached sessions retain their explicit window.
  const openFromList = (session: SessionRecord) => {
    const ref = tileRefOf(session);
    // EPIC-P34 T34.10: läuft die Session in einem eigenen Fenster, kommt dieses nach vorn — kein zweiter Composer.
    if (focusWindowFor({ kind: "session", sessionId: ref.sessionId, ...(ref.hostId ? { hostId: ref.hostId } : {}) })) return;
    setRoute({ view: "tail", session });
    // Kein Fenster mehr da (geschlossen, abgestürzt): die Session gehört wieder in eine Kachel.
    const base = forgetDetached(ws, ref);
    // Schon offen in einer Kachel → nur hinspringen, keine zweite Karte.
    const focused = focusOpenSession(base, ref);
    changeWorkspace(focused ?? openInNewTile(base, ref));
  };
  // Every route has its own remembered target. Existing cards never consume new route props.
  useEffect(() => {
    if (!wide) return;
    const current = latest.current.ws;
    let ref: TileRef;
    if (route.view === "tail") {
      const deep = !!(route.tab || route.code);
      ref = { ...tileRefOf(route.session), ...(deep ? { content: { kind: "session" as const, tab: route.code ? "code" as const : route.tab!, ...(route.file ? { file: route.file } : {}), ...(route.code ? { code: route.code } : {}) } } : {}) };
      // Listen-/Session-Wechsel: schon offene Karte fokussieren, statt Tab-Default als neue Kachel.
      if (!deep) {
        const focused = focusOpenSession(current, ref);
        if (focused) {
          latest.current.changeWorkspace(focused);
          return;
        }
      }
    } else {
      if (route.page === "dashboard") return;
      ref = { sessionId: "", content: { kind: "page", page: route.page, ...(route.vaultFile ? { vaultFile: route.vaultFile } : {}), ...(route.vaultTab ? { vaultTab: route.vaultTab } : {}), hash: location.hash } };
      // BUG-0244: Neue Session immer in Kachel 1.
      if (route.page === "new") {
        latest.current.changeWorkspace(openInTile(current, ref, 0));
        return;
      }
    }
    latest.current.changeWorkspace(openInNewTile(current, ref));
  }, [wide, route]);
  useEffect(() => {
    if (!wide) return;
    const open = (ref: TileRef) => {
      const current = latest.current.ws;
      const next = openInNewTile(current, ref);
      // Search operates on the current card's command fields, just as the phone dialog does.
      latest.current.changeWorkspace(ref.content?.kind === "search" ? { ...next, focus: current.focus } : next);
      if (ref.content?.kind === "search") document.querySelector<HTMLInputElement>(".command-card input")?.focus();
    };
    const off = onWorkspaceOpen(open);
    const layer = (kind: "browser" | "devices") => onLayerOpen(kind, () => {
      const ref = visibleTiles(latest.current.ws)[latest.current.ws.focus];
      open({ sessionId: ref?.sessionId ?? "", ...(ref?.hostId ? { hostId: ref.hostId } : {}), content: { kind } });
    });
    const browser = layer("browser");
    const devices = layer("devices");
    return () => { off(); browser(); devices(); };
  }, [wide]);

  // EPIC-P23 T23.1: a deep link or a reload on a session counts as "worked in last", too.
  useEffect(() => {
    if (route.view === "tail") rememberSession(tileRefOf(route.session));
  }, [route]);

  // EPIC-P51 T51.6: globale View-Wechsel über die Shortcut-Registry. Alt+←/→
  // nutzen die Ansichts-Historie; selbst wenn der Browser sie konsumiert,
  // passiert genau das Gewünschte (Browser-Historie = AV-Hash-Historie).
  useEffect(() => {
    const offs = [
      registerShortcut("view.home", (e) => {
        e.preventDefault();
        location.hash = pageHash("dashboard");
      }),
      registerShortcut("view.back", (e) => {
        e.preventDefault();
        history.back();
      }),
      registerShortcut("view.forward", (e) => {
        e.preventDefault();
        history.forward();
      }),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, []);

  if (!ready) return <TokenGate onReady={() => void becomeReady()} rejected={gateError} />;

  return (
    <>
      <TooltipLayer />
      {/* EPIC-P64 T64.4: am PC mit sichtbarer Liste sitzt die Glocke im Kopf
       * der Listenspalte (App bell-Prop) — die globale Eck-Glocke gilt nur
       * noch für zugeklappte Liste (T51.4) und schmale Layouts. */}
      {wide ? (listCollapsed ? <NotificationCenter corner /> : null) : <NotificationCenter />}
      {staleAt && (
        <div class="topbar">
          {/* K10: tippen lädt neu — der Service Worker holt dann wieder Netz-zuerst. */}
          <button type="button" class="badge-stale" data-testid="badge-refresh" onClick={() => location.reload()}>
            {t("app.data_from")} {fmtDateTime(staleAt)} {t("app.offline_tap")}
          </button>
        </div>
      )}
      <CommandBar />
      <ClipboardShelf />
      <CheatSheet />
      {wide && (
        <RestoreBar
          ws={ws}
          sessions={getHubStatus().sessions}
          onOpen={(ref) => {
            void openPopout({ kind: "session", sessionId: ref.sessionId, ...(ref.hostId ? { hostId: ref.hostId } : {}) }).then((result) => {
              if (result === "blocked") setPopoutNotice(blockedNotice);
            });
          }}
          onDiscard={(refs) => changeWorkspace(refs.reduce((acc, ref) => forgetDetached(acc, ref), ws))}
        />
      )}
      {popoutNotice && (
        <div class="popout-notice" role="alert">
          {popoutNotice}{" "}
          {retryPopout && (
            <Button
              onClick={() => {
                setPopoutNotice("");
                retryPopout();
              }}
            >
              {t("common.open_window")}
            </Button>
          )}{" "}
          <button type="button" class="link-btn" onClick={() => setPopoutNotice("")}>
            {t("common.close")}
          </button>
        </div>
      )}
      {wide ? (
        // T8.5 (AC-P8-6): from 1280 px list and session side by side.
        <div class={`split${listCollapsed ? " list-collapsed" : ""}`}>
          <aside class="split-list">
            <App wide onOpen={openFromList} ready={() => setReady(false)} page={route.view === "list" ? route.page : "dashboard"} bell={!listCollapsed} {...(route.view === "list" && route.vaultFile ? { vaultFile: route.vaultFile } : {})} />
          </aside>
          <section class="split-detail">
            {/* EPIC-P18: up to four sessions as tiles. */}
            <div class="tile-host">
            <TileWorkspace
              onSwitchToken={() => setReady(false)}
              listCollapsed={listCollapsed}
              onToggleList={() =>
                setListCollapsed((v) => {
                  localStorage.setItem(LIST_COLLAPSED_KEY, v ? "0" : "1");
                  return !v;
                })
              }
              ws={ws}
              onChange={changeWorkspace}
              onPopout={(index, drop) => void popoutTile(index, drop)}
              onNavigate={(page) => {
                location.hash = pageHash(page);
              }}
            />
            </div>

          </section>
          <FilesLayer wide={filesWide} focusedSessionId={visibleTiles(ws)[ws.focus]?.sessionId ?? null} />
          <StatusBar focused={visibleTiles(ws)[ws.focus] ?? null} onOpenApprovals={() => (location.hash = pageHash("approvals"))} />
        </div>
      ) : route.view === "list" ? (
        <App
          onOpen={(session) => {
            rememberSession(tileRefOf(session));
            location.hash = sessionHash(session.id, remoteHost(session.hostId));
            setRoute({ view: "tail", session });
          }}
          ready={() => setReady(false)}
          page={route.page}
          {...(route.vaultFile ? { vaultFile: route.vaultFile } : {})}
          vaultTab={route.view === "list" ? route.vaultTab ?? "notizen" : "notizen"}
        />
      ) : (
        // T1.6-3: one callback back into the list, optionally landing on a
        // specific dock page — "Übersicht ist aus jedem Kontext heraus mit
        // einem Tap erreichbar" applies to Neue Session/Einstellungen too.
        // BUG-0024: keyed by id — a link from one session to another must
        // not keep the first session's events, filter or reply draft.
        <>
          <SessionTail
            key={route.session.id}
            session={route.session}
            {...(route.code ? { initialCode: route.code } : {})}
            {...(route.view === "tail" && route.tab ? { initialTab: route.tab, ...(route.file ? { initialFile: route.file } : {}) } : {})}
            onNavigate={(page) => {
              location.hash = pageHash(page);
            }}
          />
        </>
      )}
      {!wide && <FilesLayer wide={false} focusedSessionId={route.view === "tail" ? route.session.id : null} />}
      {!wide && <BrowserLayer focusedSessionId={route.view === "tail" ? route.session.id : null} />}
      {!wide && <DeviceLayer focusedSessionId={route.view === "tail" ? route.session.id : null} />}
      <NyxFab />
    </>
  );
}

// AI-P9-2: aus dem Teilen-Menü einer anderen App — Query aufräumen und
// direkt auf "Neu" landen, der Auftrag wird vorbefüllt. Läuft vor dem
// ersten Render, damit Token-Gate und Offline-Start denselben Zustand sehen.
const shared = captureShareTarget(location.search);
if (shared) {
  storeShareInbox(shared.text);
  history.replaceState(null, "", "/#/neu");
}

// EPIC-P34 T34.10: `/?window=1` ist ein eigenes Fenster — nur die schlanke Hülle, nie das Hauptfenster.
render(isPopoutWindow() ? <PopoutShell /> : <Main />, document.getElementById("app")!);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js");
  });
}
