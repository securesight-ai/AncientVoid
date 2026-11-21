import { t } from "../../shared/i18n/index.ts";
import { useEffect, useState } from "preact/hooks";
import type { FileMeta } from "@ancientvoid/contracts";
import type { HubApi } from "../../shared/api.ts";
import { formatBytes } from "./files-model.ts";
import { CSV_MAX_BYTES, guessDelimiter, jsonNodes, parseDelimited, parseMarkdown, parseNotebook, type JsonNode, type MdBlock, type MdInline } from "./render-model.ts";
import { Chip, EmptyState } from "../../shared/ui/index.ts";

/**
 * EPIC-P46 T46.6 (ADR-0058 §8): strukturierte Ansichten. Dateiinhalt wird nie als HTML interpretiert — Preact
 * erzeugt nur Text-Knoten; SVG läuft passiv als <img>, HTML in einem Sandbox-iframe ohne Rechte.
 */
export type RenderKind = "markdown" | "mermaid" | "json" | "yaml" | "table" | "notebook" | "svg" | "html" | "archive" | "office";

const OFFICE = new Set(["docx", "xlsx", "pptx", "odt", "ods", "odp"]);
const ARCHIVE = new Set(["zip", "jar", "whl", "apk"]);

export function renderKindOf(meta: FileMeta): RenderKind | null {
  const ext = meta.path.toLowerCase().split(".").pop() ?? "";
  if (meta.family === "text") {
    if (ext === "md" || ext === "markdown") return "markdown";
    if (ext === "mmd" || ext === "mermaid") return "mermaid";
    if (ext === "json") return "json";
    if (ext === "yaml" || ext === "yml") return "yaml";
    if (ext === "csv" || ext === "tsv") return "table";
    if (ext === "ipynb") return "notebook";
    if (ext === "svg") return "svg";
    if (ext === "html" || ext === "htm") return "html";
    return null;
  }
  if (OFFICE.has(ext)) return "office";
  if (ARCHIVE.has(ext)) return "archive";
  return null;
}

/** Ganze Textdatei laden (Abschnitt für Abschnitt), mit Obergrenze — sonst ehrliche Meldung statt Teil-Ansicht. */
function useWholeText(api: HubApi, target: string, meta: FileMeta, maxBytes: number, onStale: () => void) {
  const [state, setState] = useState<{ text: string } | { error: string } | null>(null);
  useEffect(() => {
    let alive = true;
    setState(null);
    if (meta.bytes > maxBytes) {
      setState({ error: `${formatBytes(meta.bytes)} sind für diese Ansicht zu groß (Grenze ${formatBytes(maxBytes)}). „Text“ liest die Datei abschnittsweise.` });
      return;
    }
    (async () => {
      let text = "";
      let offset = meta.bomBytes;
      for (let guard = 0; guard < 100; guard++) {
        const r = await api.codeRange(target, meta.path, { offset, rev: meta.revision, as: "text", encoding: meta.encoding });
        text += r.text ?? "";
        if (r.nextOffset === null) break;
        offset = r.nextOffset;
      }
      if (alive) setState({ text });
    })().catch((err) => {
      const message = err instanceof Error ? err.message : "Lesen fehlgeschlagen";
      if (/geändert/.test(message)) onStale();
      if (alive) setState({ error: message });
    });
    return () => {
      alive = false;
    };
  }, [target, meta.path, meta.revision]);
  return state;
}

const Inline = ({ items }: { items: MdInline[] }) => (
  <>
    {items.map((i, k) =>
      i.t === "code" ? <code key={k}>{i.text}</code> : i.t === "strong" ? <strong key={k}>{i.text}</strong> : i.t === "em" ? <em key={k}>{i.text}</em> : i.t === "link" ? <a key={k} href={i.href} rel="noopener noreferrer nofollow" target="_blank">{i.text}</a> : <span key={k}>{i.text}</span>,
    )}
  </>
);

function MdBlockView({ block }: { block: MdBlock }) {
  switch (block.t) {
    case "heading": {
      const H = `h${Math.min(block.level + 1, 6)}` as "h2";
      return <H><Inline items={block.inline} /></H>;
    }
    case "para": return <p><Inline items={block.inline} /></p>;
    case "quote": return <blockquote><Inline items={block.inline} /></blockquote>;
    case "rule": return <hr />;
    case "code":
      return (
        block.lang === "mermaid" ? (
          <MermaidBlock source={block.text} />
        ) : (
          <figure class="md-code"><pre><code>{block.text}</code></pre></figure>
        )
      );
    case "list": {
      const L = block.ordered ? "ol" : "ul";
      return <L>{block.items.map((it, k) => <li key={k}><Inline items={it} /></li>)}</L>;
    }
    case "table":
      return (
        <table class="file-table"><thead><tr>{block.head.map((h, k) => <th key={k}>{h}</th>)}</tr></thead><tbody>{block.rows.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table>
      );
  }
}

function JsonTree({ node, open }: { node: JsonNode; open: boolean }) {
  const [expanded, setExpanded] = useState(open);
  if (!node.children) return <div class="json-leaf"><span class="json-key">{node.key}</span>: <span class={`json-${node.kind}`}>{node.preview}</span></div>;
  return (
    <div class="json-branch">
      <button type="button" class="json-toggle" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        {expanded ? "▾" : "▸"} <span class="json-key">{node.key}</span> <span class="dim">{node.preview}</span>
      </button>
      {expanded && <div class="json-children">{node.children.map((c, k) => <JsonTree key={k} node={c} open={false} />)}</div>}
    </div>
  );
}

const MAX_TEXT_VIEW = 4 * 1024 * 1024;

export function RenderedView({ api, target, meta, kind, onStale }: { api: HubApi; target: string; meta: FileMeta; kind: RenderKind; onStale: () => void }) {
  if (kind === "archive") return <ArchiveView api={api} target={target} meta={meta} />;
  if (kind === "office") return <OfficeView api={api} target={target} meta={meta} />;
  if (kind === "svg") return <SvgView api={api} target={target} meta={meta} />;
  return <TextRendered api={api} target={target} meta={meta} kind={kind} onStale={onStale} />;
}

function TextRendered({ api, target, meta, kind, onStale }: { api: HubApi; target: string; meta: FileMeta; kind: Exclude<RenderKind, "archive" | "office" | "svg">; onStale: () => void }) {
  const state = useWholeText(api, target, meta, kind === "table" ? CSV_MAX_BYTES : MAX_TEXT_VIEW, onStale);
  if (!state) return <EmptyState text={t("common.loading")} />;
  if ("error" in state) return <div class="files-error" role="status">{state.error}</div>;
  const { text } = state;
  if (kind === "markdown") return <div class="md-view" data-testid="md-view">{parseMarkdown(text).map((b, k) => <MdBlockView key={k} block={b} />)}</div>;
  if (kind === "json") {
    try {
      return <div class="json-view" data-testid="json-view"><JsonTree node={jsonNodes(JSON.parse(text), "$")} open /></div>;
    } catch (err) {
      return <div class="files-error" role="status">{t("files.no_valid_json")} {err instanceof Error ? err.message : "Syntaxfehler"}{t("files.text_unchanged")}</div>;
    }
  }
  if (kind === "yaml") return <YamlTree text={text} />;
  if (kind === "mermaid") return <MermaidBlock source={text} />;
  if (kind === "table") {
    const rows = parseDelimited(text, guessDelimiter(meta.path, text.slice(0, 2000)));
    const shown = rows.slice(0, 2001);
    return (
      <div class="file-table-wrap" data-testid="csv-view">
        <table class="file-table"><tbody>{shown.map((r, k) => <tr key={k}>{r.map((c, j) => (k === 0 ? <th key={j}>{c}</th> : <td key={j}>{c}</td>))}</tr>)}</tbody></table>
        {rows.length > shown.length && <div class="dim">{rows.length - shown.length} {t("files.more_lines")}</div>}
      </div>
    );
  }
  if (kind === "html") {
    const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">`;
    return (
      <>
        <div class="dim file-note">{t("files.secured_preview")}</div>
        <iframe class="file-html" title={meta.path} sandbox="" referrerPolicy="no-referrer" srcDoc={`${csp}${text}`} />
      </>
    );
  }
  const nb = parseNotebook(text);
  if (!nb.ok) return <div class="files-error" role="status">{nb.reason}</div>;
  return (
    <div class="nb-view" data-testid="notebook-view">
      <div class="dim file-note">{t("files.read_only")}</div>
      {nb.cells.map((c, k) => (
        <section key={k} class={`nb-cell nb-${c.kind}`}>
          {c.kind === "markdown" ? <div class="md-view">{parseMarkdown(c.source).map((b, j) => <MdBlockView key={j} block={b} />)}</div> : <pre class="nb-src">{c.source}</pre>}
          {c.outputs.map((o, j) => (o.kind === "image" ? <img key={j} class="nb-img" src={o.dataUri} alt={`Ausgabe ${j + 1} von Zelle ${k + 1}`} /> : o.kind === "text" ? <pre key={j} class="nb-out">{o.text}</pre> : <div key={j} class="dim">{o.label}</div>))}
        </section>
      ))}
    </div>
  );
}

function SvgView({ api, target, meta }: { api: HubApi; target: string; meta: FileMeta }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    let made: string | null = null;
    api.codeRawUrl(target, meta.path, meta.revision).then((u) => { made = u; if (alive) setUrl(u); else URL.revokeObjectURL(u); }).catch((e) => alive && setError(e instanceof Error ? e.message : "Vorschau fehlgeschlagen"));
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [target, meta.path, meta.revision]);
  if (error) return <div class="files-error" role="alert">{error}</div>;
  // <img> führt keine Skripte aus, auch nicht in SVG.
  return url ? <img class="file-media" src={url} alt={meta.path} data-testid="svg-view" /> : <EmptyState text={t("common.loading")} />;
}

function ArchiveView({ api, target, meta }: { api: HubApi; target: string; meta: FileMeta }) {
  const [res, setRes] = useState<Awaited<ReturnType<HubApi["codeArchive"]>> | { error: string } | null>(null);
  useEffect(() => {
    let alive = true;
    api.codeArchive(target, meta.path).then((r) => alive && setRes(r)).catch((e) => alive && setRes({ error: e instanceof Error ? e.message : "Archiv nicht lesbar" }));
    return () => { alive = false; };
  }, [target, meta.path, meta.revision]);
  if (!res) return <EmptyState text={t("common.loading")} />;
  if ("error" in res) return <div class="files-error" role="status">{res.error} {t("files.hex_original_quote")}</div>;
  return (
    <div class="archive-view" data-testid="archive-view">
      <div class="dim file-note">{t("files.toc_no_unpacking")} {res.total} {t("files.entries")}{res.truncated ? " (Liste gekürzt)" : ""}.</div>
      <table class="file-table"><thead><tr><th>{t("composer.name")}</th><th>{t("files.size")}</th><th>{t("files.packed")}</th></tr></thead><tbody>
        {res.entries.map((e, k) => <tr key={k}><td class="mono">{e.name}{e.encrypted ? " 🔒" : ""}</td><td>{e.directory ? "" : formatBytes(e.size)}</td><td>{e.directory ? "" : formatBytes(e.compressedSize)}</td></tr>)}
      </tbody></table>
    </div>
  );
}

function OfficeView({ api, target, meta }: { api: HubApi; target: string; meta: FileMeta }) {
  const [res, setRes] = useState<Awaited<ReturnType<HubApi["codeOffice"]>> | { error: string } | null>(null);
  useEffect(() => {
    let alive = true;
    api.codeOffice(target, meta.path).then((r) => alive && setRes(r)).catch((e) => alive && setRes({ error: e instanceof Error ? e.message : "Dokument nicht lesbar" }));
    return () => { alive = false; };
  }, [target, meta.path, meta.revision]);
  if (!res) return <EmptyState text={t("common.loading")} />;
  if ("error" in res) return <div class="files-error" role="status">{res.error} {t("files.hex_original_quote")}</div>;
  return (
    <div class="office-view" data-testid="office-view">
      <div class="dim file-note">{res.note}</div>
      {res.sections.map((s, k) => <section key={k}><h3>{s.title}</h3><pre class="nb-out">{s.text}</pre></section>)}
    </div>
  );
}

/** YAML-Struktur: js-yaml lazy, Standard-Schema (keine Konstruktoren/Tags); Fehler werden benannt, nie geraten. */
function YamlTree({ text }: { text: string }) {
  const [state, setState] = useState<{ node: JsonNode } | { error: string } | null>(null);
  useEffect(() => {
    let alive = true;
    import("js-yaml")
      .then((y) => {
        const docs: unknown[] = [];
        y.loadAll(text, (d: unknown) => docs.push(d));
        if (alive) setState({ node: jsonNodes(docs.length === 1 ? docs[0] : docs, docs.length === 1 ? "$" : `$ (${docs.length} Dokumente)`) });
      })
      .catch((err) => alive && setState({ error: err instanceof Error ? err.message.split("\n")[0]! : "YAML-Syntaxfehler" }));
    return () => { alive = false; };
  }, [text]);
  if (!state) return <EmptyState text={t("common.loading")} />;
  if ("error" in state) return <div class="files-error" role="status">{t("files.no_valid_yaml")} {state.error}{t("files.text_unchanged")}</div>;
  return <div class="json-view" data-testid="yaml-view"><JsonTree node={state.node} open /></div>;
}

let mermaidSeq = 0;
/**
 * Mermaid lazy (großer Chunk, nur bei Bedarf), securityLevel „strict“; das SVG wird nie ins DOM gehängt, sondern als
 * passives <img> (Blob) gezeigt — keine Skripte, keine Event-Handler. Fehler/Ablehnung → Quelltext mit Grund.
 */
function MermaidBlock({ source }: { source: string }) {
  const [state, setState] = useState<{ url: string } | { error: string } | null>(null);
  const [showSource, setShowSource] = useState(false);
  useEffect(() => {
    let alive = true;
    let made: string | null = null;
    setState(null);
    if (source.length > 100_000) {
      setState({ error: "Diagramm-Quelltext größer als 100 000 Zeichen — nicht gerendert." });
      return;
    }
    import("mermaid")
      .then(async (m) => {
        m.default.initialize({ startOnLoad: false, securityLevel: "strict", theme: "dark" });
        const { svg } = await m.default.render(`mmd-${++mermaidSeq}`, source);
        made = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
        if (alive) setState({ url: made });
      })
      .catch((err) => alive && setState({ error: err instanceof Error ? err.message.split("\n")[0]! : "Diagramm nicht renderbar" }));
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [source]);
  return (
    <figure class="md-code" data-testid="mermaid-block">
      {state && "error" in state && <div class="dim" role="status">{t("files.mermaid_not_rendered")} {state.error} {t("files.source_code")}</div>}
      {!state && <figcaption class="dim">{t("files.mermaid_rendering")}</figcaption>}
      {state && "url" in state && !showSource && <img class="file-media" data-testid="mermaid-img" src={state.url} alt={t("files.mermaid_diagram")} />}
      {(showSource || !state || "error" in state) && <pre><code>{source}</code></pre>}
      {state && "url" in state && <Chip onClick={() => setShowSource(!showSource)}>{showSource ? "Diagramm" : "Quelltext"}</Chip>}
    </figure>
  );
}
