import { t } from "../../shared/i18n/index.ts";
import { createPortal } from "preact/compat";
import { useEffect, useRef, useState } from "preact/hooks";
import { hubApi, remoteHost, type MediaInfo, type MediaJob, type MediaResult, type SessionRecord } from "../../shared/api.ts";
import { formatTimestamp, handOver, MEDIA_STEP_LABELS, MEDIA_STEPS, timestampLink } from "../../shared/media.ts";
import { pageHash, sessionHash } from "../../app/route.ts";
import { projectName } from "../../shared/project-name.ts";
import { Button, Card } from "../../shared/ui/index.ts";

/**
 * EPIC-P10.5 (ADR-0030): a video becomes material for a session. Link or
 * file in; steps with progress; transcript, key frames, chapters and a
 * summary out — and one tap hands the result to a session.
 */
const STATUS_TEXT: Record<MediaJob["status"], string> = { queued: "wartet", running: "läuft", done: "fertig", failed: "fehlgeschlagen", cancelled: "abgebrochen" };
const STEP_ICON: Record<string, string> = { pending: "·", running: "…", done: "✓", skipped: "–", failed: "✗" };
const SELECTED = "ancientvoid.mediaJob";

function StepList({ job }: { job: MediaJob }) {
  return (
    <ol class="media-steps">
      {MEDIA_STEPS.map((s) => {
        const st = job.steps[s];
        // Jobs aus Zeiten vor einem Step kennen diesen nicht — die Karte bleibt nutzbar.
        if (!st) return null;
        return (
          <li key={s} class={`media-step ${st.status}`} title={st.detail ?? undefined}>
            <span class="media-step-icon">{STEP_ICON[st.status]}</span> {MEDIA_STEP_LABELS[s]}
            {st.status === "running" && st.progress !== null ? ` ${Math.round(st.progress * 100)} %` : ""}
            {st.detail && (st.status !== "pending" || st.detail.includes("Neustart")) ? <span class="dim"> · {st.detail}</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

function Frame({ jobId, file, alt }: { jobId: string; file: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    void hubApi
      .mediaFrameUrl(jobId, file)
      .then((u) => {
        url = u;
        setSrc(u);
      })
      .catch(() => setSrc(null));
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [jobId, file]);
  return src ? <img class="media-frame-img" src={src} alt={alt} loading="lazy" /> : <span class="media-frame-img placeholder">{t("media.image_loading")}</span>;
}

function ResultView({ job, result, sessions }: { job: MediaJob; result: MediaResult; sessions: SessionRecord[] }) {
  const [focus, setFocus] = useState<number | null>(null);
  const [focusFrameIndex, setFocusFrameIndex] = useState<number | null>(null);
  // Esc gehört dem Vollbild allein: der Capture-Listener läuft vor der
  // Shortcut-Registry, preventDefault hält tool.close auf (wie AccentPicker).
  useEffect(() => {
    if (focusFrameIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setFocusFrameIndex(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [focusFrameIndex]);
  const [target, setTarget] = useState("new");
  const transcript = useRef<HTMLDivElement>(null);
  const jump = (ms: number) => {
    const link = timestampLink(result.url, ms);
    if (link) window.open(link, "_blank", "noopener");
    // Also show the place in the transcript (for files the only way).
    // The nearest line: a chapter often starts a moment before its sentence.
    let idx = 0;
    result.transcript.forEach((s, i) => {
      if (Math.abs(s.startMs - ms) < Math.abs(result.transcript[idx]!.startMs - ms)) idx = i;
    });
    setFocus(result.transcript.length ? idx : null);
    setTimeout(() => transcript.current?.querySelector(".media-line.focus")?.scrollIntoView({ block: "center", behavior: "smooth" }), 0);
  };
  const use = async () => {
    if (!job.resultAttachmentId) return;
    const record = await hubApi.attachment(job.resultAttachmentId);
    handOver(target, record);
    location.hash = target === "new" ? pageHash("new") : sessionHash(target);
  };
  const Stamp = ({ ms }: { ms: number }) => (
    <button type="button" class="media-stamp" onClick={() => jump(ms)} title={result.url ? "Im Video öffnen" : "Im Transkript zeigen"}>
      {formatTimestamp(ms)}
    </button>
  );
  // Ein Bindestrich im Hostnamen (CI-Runner) ist kein fremder Host. Fremd ist,
  // was nicht dieser Hub ist — dieselbe Regel wie remoteHost().
  const local = sessions.filter((s) => remoteHost(s.hostId) === null);
  const focusFrame = focusFrameIndex !== null ? (result.frames[focusFrameIndex] ?? null) : null;
  return (
    <div class="media-result">
      <Card class="media-use">
        <label class="dim" for="media-target">
          {t("media.use_as_attachment")}
        </label>
        <div class="row" style="gap: 8px; flex-wrap: wrap">
          <select id="media-target" value={target} onChange={(e) => setTarget((e.target as HTMLSelectElement).value)} aria-label={t("media.target_session")}>
            <option value="new">{t("media.new_session")}</option>
            {local.slice(0, 20).map((s) => (
              <option key={s.id} value={s.id}>
                {(s.title ?? projectName(s.project) ?? s.id).slice(0, 50)} · {s.adapter}
              </option>
            ))}
          </select>
          <Button disabled={!job.resultAttachmentId} onClick={() => void use()} variant="primary">
            {t("media.use_in_session")}
          </Button>
        </div>
      </Card>
      {result.summary && (
        <section>
          <h3>{t("approvals.summary")}</h3>
          <p>{result.summary}</p>
          {result.keyPoints.length > 0 && (
            <ul>
              {result.keyPoints.map((k) => (
                <li key={k}>{k}</li>
              ))}
            </ul>
          )}
          <div class="dim">{t("common.word_of")} {result.summaryVia}</div>
        </section>
      )}
      {result.chapters.length > 0 && (
        <section>
          <h3>{t("media.chapters")}</h3>
          <ol class="media-chapters">
            {result.chapters.map((c) => (
              <li key={c.startMs}>
                <Stamp ms={c.startMs} /> <strong>{c.title}</strong> <span class="dim">{c.summary}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
      {result.frames.length > 0 && (
        <section>
          <h3>{t("media.keyframes")}{result.frames.length})</h3>
          <div class="media-frames">
            {result.frames.map((f, i) => (
              <figure key={f.file} class="media-frame">
                <button type="button" class="media-frame-open" aria-label={`Bild bei ${formatTimestamp(f.atMs)} Vollbild öffnen`} onClick={() => setFocusFrameIndex(i)}>
                  <Frame jobId={job.id} file={f.file} alt={`Bild bei ${formatTimestamp(f.atMs)}`} />
                </button>
                <figcaption>
                  <Stamp ms={f.atMs} />
                  {f.description && <div class="media-desc">{t("media.description_open")}{f.via ?? "Modell"}{t("media.may_err")} {f.description}</div>}
                  {f.ocr && <div class="media-ocr">{t("media.text_in_image")} {f.ocr.slice(0, 300)}</div>}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}
      {result.notes.length > 0 && (
        <section >
          {result.notes.map((n) => (
            <div key={n} class="dim">
              ⓘ {n}
            </div>
          ))}
        </section>
      )}
      <section>
        <h3>{t("media.transcript")} {result.transcriptVia ? <span class="dim">· {result.transcriptVia}</span> : null}</h3>
        <div class="media-transcript" ref={transcript}>
          {result.transcript.length === 0 && <div class="dim">{t("media.no_transcript")}</div>}
          {result.transcript.map((s, i) => (
            <div key={i} class={`media-line ${focus === i ? "focus" : ""}`}>
              <Stamp ms={s.startMs} /> {s.text}
            </div>
          ))}
        </div>
      </section>
    {focusFrame &&
      // Ins <body>, wie der Datei-Betrachter: das Overlay liegt über allen Flächebenen.
      createPortal(
        <div class="media-lightbox" data-testid="media-lightbox" onClick={() => setFocusFrameIndex(null)}>
          <figure onClick={(e) => e.stopPropagation()}>
            <Frame jobId={job.id} file={focusFrame.file} alt={`Bild bei ${formatTimestamp(focusFrame.atMs)}`} />
            <figcaption>{t("media.image_at")} {formatTimestamp(focusFrame.atMs)}</figcaption>
            <Button onClick={() => setFocusFrameIndex(null)}>
              {t("common.close")}
            </Button>
          </figure>
        </div>,
        document.body,
      )}
    </div>
  );
}

export function MediaPage({ sessions }: { sessions: SessionRecord[] }) {
  const [info, setInfo] = useState<MediaInfo | null>(null);
  const [jobs, setJobs] = useState<MediaJob[]>([]);
  const [url, setUrl] = useState("");
  const [allowCloud, setAllowCloud] = useState(false);
  const [language, setLanguage] = useState("auto");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(() => sessionStorage.getItem(SELECTED));
  const [result, setResult] = useState<MediaResult | null>(null);
  const [resultError, setResultError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void hubApi.media().then(setInfo).catch((err: unknown) => setError(err instanceof Error ? err.message : "Medien nicht verfügbar"));
  }, []);
  // Poll: steps move while a job runs; the list is small and local.
  useEffect(() => {
    let alive = true;
    const tick = () =>
      hubApi
        .mediaJobs()
        .then((list) => alive && setJobs(list))
        .catch(() => undefined);
    void tick();
    const timer = setInterval(() => void tick(), 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const current = jobs.find((j) => j.id === selected) ?? null;
  useEffect(() => {
    if (selected) sessionStorage.setItem(SELECTED, selected);
    setResult(null);
    setResultError("");
  }, [selected]);
  // Ein fehlgeschlagener Result-Fetch darf die Zusammenfassung des letzten
  // Steps nicht dauerhaft verschlucken: das 2-s-Poll liefert jedes Mal eine
  // frische current-Identität und retryt, bis das Resultat für den Job steht.
  useEffect(() => {
    if (!current || current.status !== "done") return;
    if (result?.jobId === current.id) return;
    void hubApi
      .mediaResult(current.id)
      .then((r) => {
        setResult(r);
        setResultError("");
      })
      .catch((err: unknown) => setResultError(err instanceof Error ? err.message : "Zusammenfassung nicht verfügbar"));
  }, [current, result]);

  const started = (job: MediaJob) => {
    setJobs((j) => [job, ...j.filter((x) => x.id !== job.id)]);
    setSelected(job.id);
    setUrl("");
  };
  const submitUrl = async (e: Event) => {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    setError("");
    try {
      started(await hubApi.createMediaJob({ url: url.trim(), allowCloud, language }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Start fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };
  const pickFile = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      started(await hubApi.uploadMedia(file, allowCloud, language));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload fehlgeschlagen");
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const can = (ok: boolean, text: string) => <span class={`chip ${ok ? "ok" : "subtle"}`}>{ok ? "✓" : "✗"} {text}</span>;
  return (
    <div class="media-page">
      <form class="ui-card media-form" onSubmit={(e) => void submitUrl(e)}>
        <h2>{t("media.analyze_video")}</h2>
        <div class="row" style="gap: 8px; flex-wrap: wrap">
          <input class="media-url" type="url" inputMode="url" placeholder={t("media.youtube_link")} aria-label={t("media.video_link")} value={url} onInput={(e) => setUrl((e.target as HTMLInputElement).value)} />
          <Button type="submit" disabled={busy || !url.trim() || info?.tools.ytDlp === false} variant="primary">
            {busy ? "…" : "Analysieren"}
          </Button>
          <input ref={fileInput} type="file" accept="video/*,audio/*" hidden aria-label={t("media.video_file")} onChange={(e) => void pickFile((e.target as HTMLInputElement).files)} />
          <Button disabled={busy} onClick={() => fileInput.current?.click()}>
            {t("media.choose_file")}
          </Button>
        </div>
        <div class="row" style="gap: 12px; flex-wrap: wrap; align-items: center">
          <label>
            <input type="checkbox" checked={allowCloud} disabled={!info?.gemini} onChange={(e) => setAllowCloud((e.target as HTMLInputElement).checked)} /> {t("media.allow_cloud")}
          </label>
          <label>
            {t("media.language")}{" "}
            <select value={language} onChange={(e) => setLanguage((e.target as HTMLSelectElement).value)} aria-label={t("media.language")}>
              <option value="auto">{t("media.automatic")}</option>
              <option value="de">{t("media.german")}</option>
              <option value="en">{t("media.english")}</option>
            </select>
          </label>
        </div>
        {info && (
          <div class="media-caps">
            {can(info.stt, "Transkript lokal")} {can(info.summary, "Zusammenfassung lokal")} {can(info.vision, "Bildbeschreibung lokal")} {can(info.gemini, "Gemini-Schlüssel")} {can(info.tools.ytDlp, "Links (yt-dlp)")}
          </div>
        )}
        {info && !info.gemini && <div class="dim">{t("media.no_gemini")}</div>}
        {error && <div class="reply-error">{error}</div>}
      </form>

      {jobs.length > 0 && (
        <div class="media-jobs">
          {jobs.map((j) => (
            <div key={j.id} class={`card media-job ${j.id === selected ? "selected" : ""}`}>
              <button type="button" class="media-job-head" onClick={() => setSelected(j.id)} aria-expanded={j.id === selected}>
                <strong>{j.title ?? j.source.name ?? j.source.url}</strong>
                <span class={`chip status-${j.status}`}>{STATUS_TEXT[j.status]}</span>
                {j.durationSec ? <span class="dim">{formatTimestamp(j.durationSec * 1000)}</span> : null}
              </button>
              {j.id === selected && (
                <>
                  <StepList job={j} />
                  {j.error && <div class="reply-error">{j.error}</div>}
                  <div class="dim media-egress">
                    {t("media.left_hub")}{" "}
                    {j.egress.length === 0 ? "nichts" : j.egress.map((e) => `${e.service} (${MEDIA_STEP_LABELS[e.step]}${e.own ? ", eigene Hardware" : ""})`).join(" · ")}
                  </div>
                  <div class="row" style="gap: 8px">
                    {(j.status === "running" || j.status === "queued") && (
                      <Button onClick={() => void hubApi.cancelMediaJob(j.id).then((x) => setJobs((all) => all.map((y) => (y.id === x.id ? x : y))))}>
                        {t("common.cancel")}
                      </Button>
                    )}
                    {j.status !== "running" && j.status !== "queued" && (
                      <Button
                        onClick={() =>
                          void hubApi.deleteMediaJob(j.id).then(() => {
                            setJobs((all) => all.filter((y) => y.id !== j.id));
                            setSelected(null);
                          })
                        }
                       class="subtle">
                        {t("common.delete")}
                      </Button>
                    )}
                  </div>
                  {j.status === "done" && result?.jobId !== j.id && resultError && (
                    <div class="reply-error" role="alert">
                      {t("media.summary_unloadable")} {resultError}
                    </div>
                  )}
                  {j.status === "done" && result?.jobId === j.id && <ResultView job={j} result={result} sessions={sessions} />}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
