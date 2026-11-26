import { t } from "../../shared/i18n/index.ts";
import { useEffect, useRef, useState } from "preact/hooks";
import type { AdbDeviceEntry, AvdDescriptor, DeviceSetupStatus, DeviceStatus } from "@ancientvoid/contracts";
import { DEVICE_AVD_PROFILES, DEVICE_DEFAULT_IMAGE, DEVICE_DEFAULT_PROFILE } from "@ancientvoid/contracts";
import { hubApi, remoteHost } from "../../shared/api.ts";
import { openPopout } from "../windows/windows.ts";
import { getHubStatus } from "../shell/hub-status.ts";
import { onLayerOpen } from "../../shared/layers.ts";
import { ADB_STATE_LABEL, EMU_STATE_LABEL, EXAMPLE_TEST, TEST_STATE_LABEL, parseTestCase, toDevicePoint } from "./device-model.ts";
import { projectName } from "../../shared/project-name.ts";
import { Button, Chip } from "../../shared/ui/index.ts";

type Tab = "view" | "tests" | "logs" | "tree";

/**
 * EPIC-P42 (ADR-0067): Geräte-Panel. AV-eigene Emulatoren werden sichtbar gestartet/gestoppt und über eine
 * Lease mit Generation bedient; jeder Tap trägt die Geometrie-Version des angezeigten Bildes — veraltete Bilder
 * treffen nie falsche Punkte. Physische/fremde Geräte werden erklärt, aber nicht gesteuert.
 */
export function DeviceLayer({ focusedSessionId }: { focusedSessionId: string | null }) {
  const [open, setOpen] = useState(false);
  // EPIC-P43: geöffnet aus „Mehr“ der Session (keine Randlasche mehr über dem Inhalt).
  useEffect(() => onLayerOpen("devices", () => setOpen(true)), []);
  const session = focusedSessionId ? getHubStatus().sessions.find((s) => s.id === focusedSessionId) : undefined;
  return (
    <>
      {open && (
        <DevicePanel
          sessionId={focusedSessionId}
          label={session ? (session.title ?? projectName(session.project) ?? session.id.slice(0, 8)) : null}
          hostId={session?.hostId ?? null}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export function DevicePanel({ sessionId, label, hostId, onClose }: { sessionId: string | null; label: string | null; hostId: string | null; onClose: () => void }) {
  const [status, setStatus] = useState<DeviceStatus | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("view");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [generation, setGeneration] = useState<number | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [setup, setSetup] = useState<DeviceSetupStatus | null>(null);
  const [sdkRoot, setSdkRoot] = useState("");
  const [avdCreated, setAvdCreated] = useState<string | null>(null);
  const remote = Boolean(remoteHost(hostId));

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const refresh = () => {
    void hubApi.devicesStatus().then(setStatus).catch((err) => setError(err instanceof Error ? err.message : "Status nicht lesbar"));
    void hubApi
      .deviceSetupStatus()
      .then((s) => {
        setSetup(s);
        setSdkRoot((cur) => cur.trim() || s.suggestedSdkRoot);
      })
      .catch(() => undefined);
  };

  useEffect(() => {
    if (remote) return;
    void refresh();
    const timer = setInterval(() => { if (document.visibilityState === "visible" && navigator.onLine) void refresh(); }, 2500);
    return () => clearInterval(timer);
  }, [remote]);

  const run = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    setBusy(true);
    setError("");
    try {
      return await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Aktion fehlgeschlagen");
      void refresh();
      return null;
    } finally {
      setBusy(false);
    }
  };

  const head = (
    <div class="browser-head">
      <strong>{t("devices.android_devices")}</strong>
      <span class="dim" data-testid="device-context">
        {remote ? "andere Maschine" : "dieser Host"}{sessionId ? ` · Lease an „${label ?? sessionId.slice(0, 8)}“` : " · ohne Session (Lease/Tests brauchen eine fokussierte Session)"}
      </span>
      <Chip aria-label={t("devices.devices_own_window")} title={t("session.in_own_window")} onClick={() => void openPopout({ kind: "device" })}>⧉</Chip>
      <Chip onClick={onClose} aria-label={t("devices.devices_close")}>×</Chip>
    </div>
  );
  if (remote) return <aside class="browser-panel device-panel" data-testid="device-panel">{head}<div class="files-error" role="status">{t("devices.devices_host")}</div></aside>;

  const owned = (status?.devices ?? []).filter((d) => d.owned && d.instance);
  const lease = status?.leases.find((l) => l.serial === selected) ?? null;

  const startOrStop = async (fn: () => Promise<unknown>) => {
    await run(fn);
    void refresh();
  };

  return (
    <aside class="browser-panel device-panel" data-testid="device-panel" aria-label={t("devices.android_test_devices")}>
      {head}
      {status && !status.capabilities.ready && (
        <div class="files-error" role="alert" data-testid="device-unavailable">
          {t("devices.not_ready")} {status.capabilities.reasons.join(" ") || "unbekannter Grund"}
        </div>
      )}
      {error && <div class="files-error" role="alert">{error}</div>}
      {!online && <div class="files-stale" role="status">{t("devices.offline")}</div>}
      {setup && status && !status.capabilities.ready && (
        <div class="device-setup" data-testid="device-setup">
          <strong>{t("devices.setup_title")}</strong>
          <div class="dim">{t("devices.setup_hint")}</div>
          <form
            class="browser-url"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                setSetup(await hubApi.deviceSetupStart(sdkRoot.trim()));
              });
            }}
          >
            <input
              aria-label={t("devices.setup_target")}
              placeholder={t("devices.setup_target")}
              value={sdkRoot}
              disabled={!online || setup.state === "running"}
              maxLength={4096}
              data-testid="device-setup-target"
              onInput={(e) => setSdkRoot((e.target as HTMLInputElement).value)}
            />
            <Button type="submit" disabled={!online || !sdkRoot.trim() || setup.state === "running"} data-testid="device-setup-start">
              {t("devices.setup_start")}
            </Button>
          </form>
          <div data-testid="device-setup-state">
            {setup.state === "running" && <span class="dim">{t("devices.setup_running")} — {t(`devices.setup_phase_${setup.phase}`)}</span>}
            {setup.state === "done" && <span class="run-ready">{t("devices.setup_done")}</span>}
            {setup.state === "failed" && <span class="files-error" role="alert">{t("devices.setup_failed")}: {setup.reason ?? "?"}</span>}
          </div>
          {setup.tail && <details><summary class="dim">{t("devices.setup_log")}</summary><pre class="file-text mono">{setup.tail}</pre></details>}
        </div>
      )}
      {status?.capabilities.ready && (
        <details class="device-install">
          <summary class="dim">{t("devices.avd_create")}</summary>
          <CreateAvd busy={busy} online={online} created={avdCreated} onCreated={(name) => { setAvdCreated(name); void refresh(); }} onError={setError} />
        </details>
      )}
      <div class="device-bar">
        <label class="dim" title={t("devices.avd_home")}>
          {t("devices.avd")}{" "}
          <select aria-label={t("devices.avd_choose")} disabled={busy || !online} data-testid="device-avd">
            {(status?.avds ?? []).map((a) => <option key={a.name} value={a.name} disabled={!a.allowed}>{a.name}{a.lcdWidth ? ` (${a.lcdWidth}×${a.lcdHeight})` : ""}{a.allowed ? "" : " — gesperrt"}</option>)}
          </select>
        </label>
        <Button
          data-testid="device-start"
          disabled={busy || !online || (status?.avds.length ?? 0) === 0 || !status?.capabilities.ready}
          onClick={(e) => {
            const avd = ((e.currentTarget.closest(".device-bar")?.querySelector("select") as HTMLSelectElement | null)?.value ?? "").trim();
            if (avd) void startOrStop(() => hubApi.deviceStart(avd, sessionId));
          }}
        >
          {t("devices.start_emulator")}
        </Button>
      </div>
      <ul class="device-list" data-testid="device-list">
        {(status?.devices ?? []).map((d) => (
          <li key={d.serial} class="device-row" data-testid="device-row" data-serial={d.serial}>
            <Chip  onClick={() => setSelected(d.serial)} active={selected === d.serial}>
              <span class="mono">{d.serial}</span>
            </Chip>
            <span class={`run-${d.instance?.state ?? (d.state === "device" ? "ready" : "failed")}`} data-testid="device-state">
              {d.instance ? EMU_STATE_LABEL[d.instance.state] ?? d.instance.state : ADB_STATE_LABEL[d.state] ?? d.rawState}
            </span>
            {d.instance && <span class="dim">{d.instance.avdName}</span>}
            {d.physical && <span class="dim">{t("devices.physical_view")}</span>}
            {d.foreignEmulator && <span class="dim">{t("devices.foreign_emulator")}</span>}
            {d.state === "unauthorized" && <span class="dim">{t("devices.confirm_usb")}</span>}
            {d.owned && (
              <Chip data-testid="device-stop" disabled={busy || !online} onClick={() => void startOrStop(() => hubApi.deviceStop(d.serial))}>
                {t("devices.quit")}
              </Chip>
            )}
          </li>
        ))}
        {(status?.devices.length ?? 0) === 0 && <li class="dim">{t("devices.no_devices")}</li>}
      </ul>
      {selected && (
        <>
          <div class="device-bar">
            <span class="mono dim" data-testid="device-selected">{selected}</span>
            {generation === null ? (
              <Button
                data-testid="device-lease"
                disabled={busy || !online || !sessionId || !owned.some((d) => d.serial === selected && d.instance?.state === "ready")}
                title={sessionId ? "Steuerungslease für dieses Gerät holen" : "Zuerst eine Session fokussieren"}
                onClick={() => void run(async () => { const r = await hubApi.deviceLease(selected, sessionId); setGeneration(r.generation); void refresh(); })}
              >
                {t("devices.get_control")}
              </Button>
            ) : (
              <>
                <span class="dim" data-testid="device-generation">{t("devices.generation")} {generation}</span>
                <Chip disabled={busy || !online} onClick={() => void run(async () => { await hubApi.deviceRelease(selected, generation); setGeneration(null); void refresh(); })}>{t("approvals.approve")}</Chip>
              </>
            )}
            {lease && generation === null && <span class="files-stale" role="status">{t("devices.held_by")}{lease.owner}“</span>}
          </div>
          <div class="browser-tabs" role="tablist">
            {(["view", "tests", "logs", "tree"] as const).map((t) => (
              <Chip key={t} role="tab" aria-selected={tab === t}  onClick={() => setTab(t)} active={tab === t}>
                {t === "view" ? "Ansicht" : t === "tests" ? "Tests" : t === "logs" ? "Logs" : "Baum"}
              </Chip>
            ))}
          </div>
          {tab === "view" && <DeviceView serial={selected} generation={generation} online={online} busy={busy} onError={setError} />}
          {tab === "tests" && <Tests serial={selected} online={online} />}
          {tab === "logs" && <Logs serial={selected} online={online} />}
          {tab === "tree" && <Tree serial={selected} online={online} />}
        </>
      )}
    </aside>
  );
}

function DeviceView({ serial, generation, online, busy, onError }: { serial: string; generation: number | null; online: boolean; busy: boolean; onError: (m: string) => void }) {
  const [frame, setFrame] = useState<{ url: string; seq: number; geometryVersion: number; width: number; height: number; at: Date } | null>(null);
  const [typed, setTyped] = useState("");
  const [url, setUrl] = useState("");
  const [apk, setApk] = useState("");
  const img = useRef<HTMLImageElement>(null);

  useEffect(() => {
    setFrame(null);
    let alive = true;
    let last: string | null = null;
    const tick = async () => {
      if (!alive || document.visibilityState !== "visible" || !navigator.onLine) return;
      try {
        const f = await hubApi.deviceFrame(serial);
        if (!alive) { if (f) URL.revokeObjectURL(f.url); return; }
        if (f) {
          if (last) URL.revokeObjectURL(last);
          last = f.url;
          setFrame({ ...f, at: new Date() });
        }
      } catch { /* nächster Tick; Offline zeigt das letzte Bild */}
    };
    void tick();
    const timer = setInterval(tick, 700);
    return () => { alive = false; clearInterval(timer); if (last) URL.revokeObjectURL(last); };
  }, [serial]);

  const act = (action: Parameters<typeof hubApi.deviceAction>[3], geoVersion: number) => {
    if (generation === null) { onError("Zuerst die Steuerung (Lease) holen."); return; }
    void hubApi.deviceAction(serial, generation, geoVersion, action).catch((err) => {
      const msg = err instanceof Error ? err.message : "Aktion fehlgeschlagen";
      onError(msg.includes(t("devices.generation")) || msg.includes("veraltet") ? `${msg} — Bild aktualisiert sich gleich; erneut versuchen.` : msg);
    });
  };

  const onImageClick = (e: MouseEvent) => {
    const el = img.current;
    if (!el || !online || !frame || generation === null) return;
    const rect = el.getBoundingClientRect();
    const point = toDevicePoint({ x: e.clientX, y: e.clientY }, rect, { width: frame.width || el.naturalWidth, height: frame.height || el.naturalHeight });
    if (point) act({ type: "tap", x: point.x, y: point.y }, frame.geometryVersion);
  };

  const keys = ["back", "home", "app-switch", "enter", "del", "volume-up", "volume-down"] as const;
  return (
    <div>
      {generation === null && <div class="dim">{t("devices.view_only")}</div>}
      <div class="browser-tools">
        <Chip disabled={!online || generation === null} onClick={() => frame && act({ type: "swipe", x1: Math.round(frame.width / 2), y1: Math.round(frame.height * 0.7), x2: Math.round(frame.width / 2), y2: Math.round(frame.height * 0.3), durationMs: 300 }, frame.geometryVersion)} aria-label={t("devices.swipe_up")}>↑</Chip>
        <Chip disabled={!online || generation === null} onClick={() => frame && act({ type: "swipe", x1: Math.round(frame.width / 2), y1: Math.round(frame.height * 0.3), x2: Math.round(frame.width / 2), y2: Math.round(frame.height * 0.7), durationMs: 300 }, frame.geometryVersion)} aria-label={t("devices.swipe_down")}>↓</Chip>
        {keys.map((k) => <Chip key={k} disabled={!online || generation === null} onClick={() => frame && act({ type: "key", key: k }, frame.geometryVersion)}>{k}</Chip>)}
        <label class="dim"> {t("devices.orientation")}{" "}
          <select aria-label={t("devices.orientation")} disabled={!online || generation === null} onChange={(e) => frame && act({ type: "rotate", orientation: (e.target as HTMLSelectElement).value as "portrait" | "landscape" }, frame.geometryVersion)}>
            <option value="portrait">{t("devices.portrait")}</option>
            <option value="landscape">{t("devices.landscape")}</option>
          </select>
        </label>
      </div>
      <form class="browser-type" onSubmit={(e) => { e.preventDefault(); if (typed && frame) { act({ type: "text", text: typed }, frame.geometryVersion); setTyped(""); } }}>
        <input aria-label={t("devices.type_on_device")} placeholder={t("devices.ascii_type")} value={typed} disabled={!online || busy || generation === null} maxLength={500} onInput={(e) => setTyped((e.target as HTMLInputElement).value)} />
        <Button type="submit" disabled={!online || !typed || generation === null}>{t("devices.tap")}</Button>
      </form>
      <form class="browser-url" onSubmit={(e) => { e.preventDefault(); if (url && frame) { act({ type: "openUrl", url }, frame.geometryVersion); setUrl(""); } }}>
        <input aria-label={t("devices.open_url_emulator")} placeholder={t("devices.host_loopback")} value={url} disabled={!online || generation === null} maxLength={2048} onInput={(e) => setUrl((e.target as HTMLInputElement).value)} />
        <Button type="submit" disabled={!online || !url || generation === null}>{t("devices.open")}</Button>
      </form>
      <details class="device-install">
        <summary class="dim">{t("devices.install_apk")}</summary>
        <form class="browser-type" onSubmit={(e) => { e.preventDefault(); if (apk && generation !== null) void hubApi.deviceInstall(serial, generation, apk.trim()).catch((err) => onError(err instanceof Error ? err.message : "Installation fehlgeschlagen")).finally(() => setApk("")); }}>
          <input aria-label={t("devices.attachment_id")} placeholder={t("devices.attachment_id_session")} value={apk} disabled={!online || generation === null} maxLength={64} onInput={(e) => setApk((e.target as HTMLInputElement).value)} />
          <Button type="submit" disabled={!online || !apk || generation === null}>{t("devices.install")}</Button>
        </form>
        <div class="dim">{t("devices.referenced_only")}</div>
      </details>
      {frame ? (
        <img
          ref={img}
          class="browser-frame device-frame"
          data-testid="device-frame"
          src={frame.url}
          alt={`Gerätebild ${serial}`}
          onClick={onImageClick}
          draggable={false}
        />
      ) : (
        <div class="ui-empty" data-testid="device-noframe">{t("devices.no_image")}</div>
      )}
      {frame && <div class="dim" data-testid="device-frame-time">{t("devices.as_of")} {frame.at.toLocaleTimeString("de-DE")} {t("devices.seq_frag")} {frame.seq} {t("devices.geometry_frag")} {frame.geometryVersion} · {frame.width}×{frame.height}{t("devices.px")}</div>}
    </div>
  );
}

function Logs({ serial, online }: { serial: string; online: boolean }) {
  const [text, setText] = useState("");
  const [meta, setMeta] = useState<{ truncated: boolean; at: string } | null>(null);
  const [auto, setAuto] = useState(false);
  const [error, setError] = useState("");
  const load = () => hubApi.deviceLogs(serial).then((r) => { setText(r.text); setMeta({ truncated: r.truncated, at: r.at }); }).catch((e) => setError(e instanceof Error ? e.message : "Logs nicht lesbar"));
  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => { if (navigator.onLine && document.visibilityState === "visible") void load(); }, 10_000);
    return () => clearInterval(t);
  }, [auto, serial]);
  return (
    <div class="device-logs" data-testid="device-logs">
      <div class="file-tools">
        <Button disabled={!online} onClick={() => void load()}>{t("devices.load_logcat")}</Button>
        <label class="dim"><input type="checkbox" checked={auto} onChange={(e) => setAuto((e.target as HTMLInputElement).checked)} /> {t("devices.every_10s")}</label>
        {meta && <span class="dim">{meta.at}{meta.truncated ? " · gekürzt" : ""}</span>}
      </div>
      {error && <div class="files-error" role="alert">{error}</div>}
      <pre class="file-text mono">{text || "Noch nicht geladen."}</pre>
    </div>
  );
}

function Tree({ serial, online }: { serial: string; online: boolean }) {
  const [xml, setXml] = useState("");
  const [error, setError] = useState("");
  const [at, setAt] = useState("");
  return (
    <div class="device-tree" data-testid="device-tree">
      <div class="file-tools">
        <Button
          disabled={!online}
          onClick={() => hubApi.deviceTree(serial).then((t) => { setXml(t); setAt(new Date().toISOString()); setError(""); }).catch((e) => setError(e instanceof Error ? e.message : "Baum nicht lesbar"))}
        >
          {t("devices.load_a11y")}
        </Button>
        {at && <span class="dim">{at}</span>}
      </div>
      {error && <div class="files-error" role="alert">{error}</div>}
      <pre class="file-text mono">{xml || "Noch nicht geladen."}</pre>
    </div>
  );
}

function Tests({ serial, online }: { serial: string; online: boolean }) {
  const [runs, setRuns] = useState<{ id: string; name: string; state: keyof typeof TEST_STATE_LABEL; steps: { index: number; type: string; ok: boolean; detail: string | null }[]; artifact: { name: string } | null; note: string | null; env: Record<string, unknown> }[]>([]);
  const [text, setText] = useState(EXAMPLE_TEST.replace('"emulator-5554"', JSON.stringify(serial)));
  const [error, setError] = useState("");
  const [artifact, setArtifact] = useState<{ runId: string; url: string } | null>(null);
  const load = () => hubApi.deviceTests(serial).then((r) => setRuns(r.runs)).catch(() => undefined);
  useEffect(() => {
    void load();
    const timer = setInterval(() => { if (navigator.onLine) void load(); }, 2000);
    return () => clearInterval(timer);
  }, [serial]);
  useEffect(() => () => { if (artifact) URL.revokeObjectURL(artifact.url); }, [artifact]);

  const start = async () => {
    const parsed = parseTestCase(text);
    if (!parsed.ok) return setError(parsed.error);
    setError("");
    try { await hubApi.deviceRunTest(parsed.test); void load(); } catch (err) { setError(err instanceof Error ? err.message : "Start fehlgeschlagen"); }
  };
  return (
    <div  data-testid="device-tests">
      <div class="dim file-note">{t("devices.registered_steps")}</div>
      <textarea class="browser-test-editor mono" aria-label={t("devices.device_test_json")} rows={10} spellcheck={false} value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
      {error && <div class="files-error" role="alert">{error}</div>}
      <Button disabled={!online} data-testid="device-test-start" onClick={start}>{t("devices.start_test")}</Button>
      <ul class="browser-runs">
        {runs.map((r) => (
          <li key={r.id} data-testid="device-run" data-state={r.state}>
            <strong>{r.name}</strong> · <span class={`run-${r.state}`}>{TEST_STATE_LABEL[r.state]}</span>
            {r.state === "running" && <Chip onClick={() => hubApi.deviceAbortTest(serial, r.id).then(load)}>{t("common.cancel")}</Chip>}
            {r.note && <div class="dim">{r.note}</div>}
            <div class="dim">{t("devices.api")} {String(r.env.apiVersion ?? "?")} · {r.env.resolution ? `${(r.env.resolution as { width: number; height: number }).width}×${(r.env.resolution as { width: number; height: number }).height}` : "?"} · {String(r.env.avdName ?? "?")}</div>
            <ol class="dim">{r.steps.map((s) => <li key={s.index}>{s.ok ? "✓" : "✗"} {s.type}{s.detail ? ` — ${s.detail}` : ""}</li>)}</ol>
            {r.artifact && <Chip onClick={async () => setArtifact({ runId: r.id, url: await hubApi.browserBlobUrl(`/api/devices/tests/${r.id}/artifact?serial=${encodeURIComponent(serial)}`) })}>{t("devices.screenshot")}</Chip>}
            {artifact?.runId === r.id && <img class="file-media" src={artifact.url} alt={`Screenshot von ${r.name}`} />}
          </li>
        ))}
        {runs.length === 0 && <li class="dim">{t("devices.no_runs")}</li>}
      </ul>
    </div>
  );
}

/** In-App-Setup (2026-11-24): neuen AVD anlegen — Name, installiertes Image, Geräteprofil. */
function CreateAvd({ busy, online, created, onCreated, onError }: { busy: boolean; online: boolean; created: string | null; onCreated: (name: string) => void; onError: (m: string) => void }) {
  const [name, setName] = useState("");
  const [image, setImage] = useState(DEVICE_DEFAULT_IMAGE);
  const [profile, setProfile] = useState<string>(DEVICE_DEFAULT_PROFILE);
  const [images, setImages] = useState<string[]>([]);
  useEffect(() => {
    void hubApi
      .deviceImages()
      .then((r) => {
        setImages(r.images);
        if (r.images.length > 0 && !r.images.includes(DEVICE_DEFAULT_IMAGE)) setImage(r.images[0]!);
      })
      .catch(() => undefined);
  }, []);
  return (
    <div data-testid="device-avd-create">
      <form
        class="browser-type"
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = name.trim();
          if (!trimmed) return;
          void hubApi
            .deviceCreateAvd({ name: trimmed, image, profile })
            .then((avd: AvdDescriptor) => {
              setName("");
              onCreated(avd.name);
            })
            .catch((err) => onError(err instanceof Error ? err.message : "AVD-Anlage fehlgeschlagen"));
        }}
      >
        <input aria-label={t("devices.avd_name")} placeholder={t("devices.avd_name")} value={name} disabled={!online || busy} maxLength={32} data-testid="device-avd-name" onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        <select aria-label={t("devices.avd_image")} value={image} disabled={!online} data-testid="device-avd-image" onChange={(e) => setImage((e.target as HTMLSelectElement).value)}>
          {(images.length > 0 ? images : [DEVICE_DEFAULT_IMAGE]).map((i) => <option key={i} value={i}>{i}</option>)}
        </select>
        <select aria-label={t("devices.avd_profile")} value={profile} disabled={!online} data-testid="device-avd-profile" onChange={(e) => setProfile((e.target as HTMLSelectElement).value)}>
          {DEVICE_AVD_PROFILES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <Button type="submit" disabled={!online || busy || !name.trim() || !image} data-testid="device-avd-create-btn">{t("devices.avd_create_btn")}</Button>
      </form>
      {created && <div class="dim" data-testid="device-avd-created">{t("devices.avd_created")} „{created}“</div>}
    </div>
  );
}
