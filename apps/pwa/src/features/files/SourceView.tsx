import { t } from "../../shared/i18n/index.ts";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { DiagnosticsResult, FileMeta } from "@ancientvoid/contracts";
import type { HubApi } from "../../shared/api.ts";
import { highlightLines } from "./highlight.ts";
import { basket } from "./feedback-basket.ts";
import { FEEDBACK_MAX_LINES, HIGHLIGHT_MAX_CHARS, HLJS_LANGUAGES } from "./render-model.ts";
import { TEXT_PAGE_BYTES } from "./files-model.ts";
import { Button, EmptyState } from "../../shared/ui/index.ts";

export interface Jump {
  line: number;
  column?: number;
  length?: number;
  nonce: number;
}

/**
 * EPIC-P46 T46.7 (ADR-0058 §7): Text mit Zeilennummern, Syntaxfarben (nur Darstellung), Zeilensprung und Suche über
 * die ganze Datei (hostseitig). Genau ein Abschnitt im DOM; jeder Abschnitt ist an die Revision gebunden.
 */
export function SourceView({ api, target, meta, onStale, diagnostics, jump, onFeedbackAdded }: { api: HubApi; target: string; meta: FileMeta; onStale: () => void; diagnostics: DiagnosticsResult | null; jump: Jump | null; onFeedbackAdded?: () => void }) {
  const [page, setPage] = useState<{ offset: number; length: number; text: string; nextOffset: number | null; startLine: number | null } | null>(null);
  const [trail, setTrail] = useState<number[]>([]);
  const [at, setAt] = useState(meta.bomBytes);
  const [error, setError] = useState("");
  const [wrap, setWrap] = useState(true);
  const [colored, setColored] = useState<string[] | null>(null);
  const [focus, setFocus] = useState<{ line: number; column?: number; length?: number } | null>(null);
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null);
  const [goto, setGoto] = useState("");
  const [query, setQuery] = useState("");
  const [cs, setCs] = useState(false);
  const [findNote, setFindNote] = useState("");
  const lastFind = useRef<{ line: number } | null>(null);
  const body = useRef<HTMLDivElement>(null);

  const fail = (err: unknown): string => {
    const message = err instanceof Error ? err.message : "Lesen fehlgeschlagen";
    if (/geändert/.test(message)) onStale();
    return message;
  };

  useEffect(() => {
    let alive = true;
    setError("");
    api
      .codeRange(target, meta.path, { offset: at, length: TEXT_PAGE_BYTES, rev: meta.revision, as: "text", encoding: meta.encoding })
      .then((r) => alive && setPage({ offset: r.offset, length: r.length, text: r.text ?? "", nextOffset: r.nextOffset, startLine: r.startLine }))
      .catch((err) => alive && setError(fail(err)));
    return () => {
      alive = false;
    };
  }, [target, meta.path, meta.revision, at]);

  const lines = useMemo(() => {
    if (!page) return [];
    const parts = page.text.split("\n");
    if (parts.length > 1 && parts[parts.length - 1] === "") parts.pop();
    return parts.map((l) => l.replace(/\r$/, ""));
  }, [page]);

  useEffect(() => {
    setColored(null);
    if (!page) return;
    let alive = true;
    highlightLines(page.text, meta.language).then((l) => alive && setColored(l));
    return () => {
      alive = false;
    };
  }, [page, meta.language]);

  const jumpTo = async (line: number, extra: { column?: number; length?: number } = {}) => {
    setFindNote("");
    try {
      const res = await api.codeLine(target, meta.path, line, meta.revision);
      setTrail((t) => [...t, at]);
      setAt(res.offset);
      setFocus({ line: res.line, ...extra });
    } catch (err) {
      setFindNote(fail(err));
    }
  };

  // Sprung aus dem Diagnose-Panel: Zeile liegt evtl. im geladenen Abschnitt, sonst nachladen.
  useEffect(() => {
    if (!jump) return;
    const inPage = page?.startLine != null && jump.line >= page.startLine && jump.line < page.startLine + lines.length;
    if (inPage) setFocus({ line: jump.line, ...(jump.column ? { column: jump.column } : {}), ...(jump.length ? { length: jump.length } : {}) });
    else void jumpTo(jump.line, { ...(jump.column ? { column: jump.column } : {}), ...(jump.length ? { length: jump.length } : {}) });
  }, [jump?.nonce]);

  useEffect(() => {
    if (!focus || !page) return;
    body.current?.querySelector(`[data-line="${focus.line}"]`)?.scrollIntoView({ block: "center" });
  }, [focus, page]);

  const find = async (from: "start" | "next") => {
    if (!query) return;
    setFindNote("sucht …");
    try {
      let startByte = meta.bomBytes;
      if (from === "next" && lastFind.current) {
        const nl = await api.codeLine(target, meta.path, lastFind.current.line + 1, meta.revision).catch(() => null);
        if (!nl) {
          setFindNote("Kein weiterer Treffer (Dateiende).");
          lastFind.current = null;
          return;
        }
        startByte = nl.offset;
      }
      const res = await api.codeFind(target, meta.path, query, startByte, meta.revision, cs);
      if (!res.found) {
        setFindNote(`Kein ${from === "next" ? "weiterer " : ""}Treffer in der ganzen Datei.`);
        lastFind.current = null;
        return;
      }
      lastFind.current = { line: res.line! };
      setFindNote(`Treffer in Zeile ${res.line}, Spalte ${res.column} (ein Treffer je Zeile angesteuert).`);
      setTrail((t) => [...t, at]);
      setAt(res.lineOffset!);
      setFocus({ line: res.line!, column: res.column!, length: res.length! });
    } catch (err) {
      setFindNote(fail(err));
    }
  };

  const perLine = useMemo(() => {
    const map = new Map<number, string>();
    if (diagnostics && diagnostics.revision === meta.revision) {
      for (const d of diagnostics.diagnostics) if (d.path === meta.path) map.set(d.line, `${d.severity}: ${d.message.split("\n")[0]}`);
    }
    return map;
  }, [diagnostics, meta.revision, meta.path]);

  if (error) return <div class="files-error" role="alert">{error}</div>;
  if (!page) return <EmptyState text={t("common.loading")} />;
  const first = page.startLine ?? 1;
  const selRange = sel ? { from: Math.min(sel.a, sel.b), to: Math.max(sel.a, sel.b) } : null;

  const addFeedback = (withDiagnostic?: boolean) => {
    if (!selRange) return;
    const diag = withDiagnostic ? diagnostics?.diagnostics.find((d) => d.path === meta.path && d.line >= selRange.from && d.line <= selRange.to) : undefined;
    basket.add({
      path: meta.path,
      revision: meta.revision,
      startLine: selRange.from,
      endLine: Math.min(selRange.to, selRange.from + FEEDBACK_MAX_LINES - 1),
      note: "",
      ...(diag ? { diagnostic: { code: diag.code, message: diag.message, source: diag.source } } : {}),
    }, lines.slice(selRange.from - first, Math.min(selRange.to, selRange.from + FEEDBACK_MAX_LINES - 1) - first + 1).join("\n"));
    setSel(null);
    onFeedbackAdded?.();
  };

  const rows = lines.map((text, i) => {
    const n = first + i;
    const inSel = selRange && n >= selRange.from && n <= selRange.to;
    const html = colored?.[i];
    const f = focus && focus.line === n ? focus : null;
    // Spaltenmarke: nur auf ungefärbtem Text exakt (UTF-16-Spalte = JS-Index + 1); gefärbt bleibt die Zeile markiert.
    let content;
    if (f?.column && colored === null) {
      const c = f.column - 1;
      content = <>{text.slice(0, c)}<mark class="file-col-mark">{text.slice(c, c + (f.length ?? 1)) || " "}</mark>{text.slice(c + (f.length ?? 1))}</>;
    } else if (html !== undefined) content = <span dangerouslySetInnerHTML={{ __html: html }} />;
    else content = text;
    return (
      <div key={n} data-line={n} class={`file-line${inSel ? " sel" : ""}${f ? " focus" : ""}${perLine.has(n) ? " has-diag" : ""}`} title={perLine.get(n)}>
        <button
          type="button"
          class="file-ln"
          aria-label={`Zeile ${n} auswählen`}
          onClick={(e) => setSel(e.shiftKey && sel ? { a: sel.a, b: n } : { a: n, b: n })}
        >
          {n}
        </button>
        <span class="file-lt">{content === "" ? " " : content}</span>
      </div>
    );
  });

  return (
    <>
      <div class="file-tools">
        <input class="file-pager-jump" inputMode="numeric" placeholder={t("files.line")} aria-label={t("files.jump_line")} value={goto} onInput={(e) => setGoto((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === "Enter" && /^\d+$/.test(goto) && Number(goto) > 0) void jumpTo(Number(goto)); }} />
        <input class="file-find" placeholder={t("files.search_whole")} aria-label={t("files.search_in_file")} value={query} onInput={(e) => { setQuery((e.target as HTMLInputElement).value); lastFind.current = null; }} onKeyDown={(e) => { if (e.key === "Enter") void find(lastFind.current ? "next" : "start"); }} />
        <Button onClick={() => void find(lastFind.current ? "next" : "start")} disabled={!query}>{lastFind.current ? "Weiter" : "Suchen"}</Button>
        <label class="dim"><input type="checkbox" checked={cs} onChange={(e) => { setCs((e.target as HTMLInputElement).checked); lastFind.current = null; }} /> {t("files.case")}</label>
        <label class="dim file-wrap"><input type="checkbox" checked={wrap} onChange={(e) => setWrap((e.target as HTMLInputElement).checked)} /> {t("files.word_wrap")}</label>
        {selRange && (
          <>
            <Button onClick={() => addFeedback(false)} data-testid="file-feedback-add">{t("files.line")}{selRange.from === selRange.to ? "" : "n"} {selRange.from === selRange.to ? selRange.from : `${selRange.from}–${selRange.to}`} {t("files.to_feedback")}</Button>
          </>
        )}
      </div>
      {colored === null && page.text.length > HIGHLIGHT_MAX_CHARS && HLJS_LANGUAGES[meta.language] && <div class="dim file-note" data-testid="file-nocolor">{t("files.syntax_off")} {HIGHLIGHT_MAX_CHARS.toLocaleString("de-DE")} {t("files.characters")}</div>}
      {findNote && <div class="dim file-find-note" role="status" data-testid="file-find-note">{findNote}</div>}
      <div class="file-pager">
        <Button disabled={trail.length === 0} aria-label={t("files.prev_section")} onClick={() => { const prev = trail[trail.length - 1]!; setTrail(trail.slice(0, -1)); setAt(prev); setFocus(null); }}>‹</Button>
        <span class="dim" data-testid="file-pager-range">
          {t("files.line")} {first.toLocaleString("de-DE")}–{(first + Math.max(lines.length - 1, 0)).toLocaleString("de-DE")} {t("files.bytes_frag")} {page.offset.toLocaleString("de-DE")}–{(page.offset + page.length).toLocaleString("de-DE")} {t("common.word_of")} {meta.bytes.toLocaleString("de-DE")}
          {page.nextOffset === null && " · Ende"}
        </span>
        <Button disabled={page.nextOffset === null} aria-label={t("files.next_section")} onClick={() => { setTrail([...trail, at]); setAt(page.nextOffset!); setFocus(null); }}>›</Button>
        <input class="file-pager-jump" inputMode="numeric" placeholder={t("files.byte_offset")} aria-label={t("files.jump_byte")} onKeyDown={(e) => { const v = (e.target as HTMLInputElement).value; if (e.key === "Enter" && /^\d+$/.test(v)) { setTrail([...trail, at]); setAt(Math.max(Math.min(Number(v), Math.max(meta.bytes - 1, 0)), meta.bomBytes)); setFocus(null); } }} />
      </div>
      <div ref={body} class={wrap ? "file-code wrap" : "file-code"} data-testid="file-text" tabIndex={0}>{rows}</div>
    </>
  );
}
