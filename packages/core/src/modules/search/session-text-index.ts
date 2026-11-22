import { join } from "node:path";
import { open, readdir, stat } from "node:fs/promises";
import {
  DEFAULT_TRANSCRIPT_ROLES,
  SNIPPET_MARK_CLOSE,
  SNIPPET_MARK_OPEN,
  TranscriptQueryLimits,
  type SearchIndexState,
  type SessionSearchMode,
  type SessionTextHit,
  type TranscriptRole,
} from "@ancientvoid/contracts";
import type { HubDatabase } from "../../platform/db.ts";

/**
 * Suche (Nachschärfe 2026-11-22): Volltextindex über die **Sessiontexte** —
 * Fragen, Antworten, Denk- und Werkzeitspuren aller Sessions, die der Hub
 * sowieso schon hält (`sessions/<id>/events.jsonl` + ihre Blobs, ADR-P0-2).
 *
 * Warum ein eigener Index und kein qmd: qmd erfasst nachweislich nur
 * `**\/*.md` (siehe `apps/hub/src/modules/search/search.ts`), Sessiontexte
 * sind JSONL. Und die Suche darf nicht davon abhängen, ob ein Fremdkli
 * installiert ist — die Gespräche sind der Kern des Fundus.
 *
 * K7: der Index ist **ableitbar**. `transcript_state.byte_offset` pro Session
 * macht ihn zum fortgeschriebenen Schwanz der JSONL; löschen + nächster
 * Refresh stellt ihn vollständig wieder her. Ein Neustart verliert nichts,
 * was nicht auch das Protokoll verloren hätte.
 *
 * K5: indexiert wird pro Ereignis höchstens {@link MAX_TEXT_CHARS} Zeichen;
 * ausgelagerte Großpayloads (`blobRef`) werden gelesen, weil genau dort die
 * langen Antworten liegen — ohne sie wäre jede zweite Antwort unauffindbar.
 */

/** Obergrenze pro indexierter Zeile. Snippets brauchen keinen Volltext-Kolon;
 * alles darüber wäre Index-Balon, den kein Suchender liest. */
const MAX_TEXT_CHARS = 20_000;
/** Lesefenster pro Nachziehen (groß genug, dass ein Zug mit hunderten
 * Ereignissen in einem Durchlauf hereinkommt). */
const READ_CHUNK_BYTES = 128 * 1024;

const ROLES: readonly TranscriptRole[] = ["user", "assistant", "thinking", "tool", "system"];

/** bm25 liefert negative Werte: kleiner (also negativer) = besser. Ein Factor
 * > 1 zieht eine Rolle nach oben, < 1 drückt sie. Der Abstand ist bewusst
 * groß: Werkzeugzeilen sind kurz und termreich und würden eine reine
 * bm25-Liste sonst komplett unter sich begraben — Fragen und Antworten sind
 * aber die Unterhaltung, nach der hier gesucht wird. */
const ROLE_BOOST: Record<TranscriptRole, number> = {
  user: 3.0,
  assistant: 2.6,
  thinking: 1.0,
  tool: 0.5,
  system: 0.3,
};

function roleFor(type: string): TranscriptRole | null {
  switch (type) {
    case "user":
      return "user";
    case "assistant":
      return "assistant";
    case "thinking":
      return "thinking";
    case "tool_use":
    case "tool_result":
      return "tool";
    case "system":
      return "system";
    default:
      return null;
  }
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

/** Stringwerte eines Werkzeug-Eingabeobjekts (Befehl, Pfad, Muster …), geordnet
 * nach Schlüssel, gekappt — so findet die Suche einen `git push`-Lauf, ohne den
 * ganzen JSON-Balon zu indexieren. */
function inputStrings(input: unknown, cap: number): string {
  if (!input || typeof input !== "object") return "";
  const out: string[] = [];
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === "string" && value.trim()) out.push(`${key}: ${value.trim()}`);
    else if (typeof value === "number" || typeof value === "boolean") out.push(`${key}: ${value}`);
  }
  return out.join("\n").slice(0, cap);
}

/** Der durchsuchbare Text eines Ereignisses — `null` = nichts Sinnvolles.
 * Die Reihenfolge folgt dem, was ein Mensch wiederfinden will: zuerst der
 * eigene Wortlaut (payload.text), dann die Kurzfassung (summary). */
export function eventText(ev: Record<string, unknown>, payload: Record<string, unknown>): string | null {
  const role = roleFor(String(ev.type ?? ""));
  if (!role) return null;
  const summary = str(ev.summary) ?? "";
  const parts: string[] = [];
  const text = str(payload.text);
  if (text) parts.push(text);
  if (role === "tool") {
    const name = str(payload.name);
    if (name) parts.push(name);
    const command = inputStrings(payload.input, 2_000);
    if (command) parts.push(command);
    const content = str(payload.content) ?? (payload.content === undefined ? "" : JSON.stringify(payload.content));
    if (content.trim()) parts.push(content.slice(0, 4_000));
  }
  if (role === "system") {
    const reason = str(payload.reason);
    if (reason) parts.push(reason);
  }
  if (summary) {
    // Die Kurzzeile wiederholt bei Fragen und Antworten oft genau den Wortlaut.
    // Zweimal indexiert verdoppelt sie die Fundstelle derselben Nachricht und
    // bläht das Snippet — genommen wird nur, was nicht schon drinsteht.
    const already = parts.join(" ").toLowerCase();
    const low = summary.trim().toLowerCase();
    if (low && !already.includes(low)) parts.push(summary);
  }
  const joined = parts.join("\n").trim();
  if (!joined) return null;
  return joined.length > MAX_TEXT_CHARS ? joined.slice(0, MAX_TEXT_CHARS) : joined;
}

interface IndexedLine {
  seq: number;
  ts: string;
  role: TranscriptRole;
  text: string;
}

/** Zeile, wie der FTS5-Durchlauf sie liefert. */
interface FtsRow {
  session_id: string;
  seq: number;
  ts: string;
  role: TranscriptRole;
  snippet: string;
  rank: number;
  title: string | null;
  project: string;
  archived: number;
}

function rowsToHits(rows: readonly FtsRow[], perSession: ReadonlyMap<string, number>): SessionTextHit[] {
  return rows.map((r) => ({
    sessionId: r.session_id,
    seq: r.seq,
    ts: r.ts,
    role: r.role,
    snippet: r.snippet,
    score: Number((-r.rank).toFixed(4)),
    sessionTitle: r.title,
    project: r.project,
    archived: r.archived === 1,
    sessionHits: perSession.get(r.session_id) ?? 0,
  }));
}

/** `LIKE`-Wertung abschalten, ohne Buchstaben zu schlucken: `%`, `_` und `\`
 * sind in Mustern Metazeichen, in Projektpfaden normal. */
function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** FTS5 ist kein Muss: nicht jeder `node:sqlite`-Build hat es einkompiliert.
 * Der Scanner ist die ehrliche Rückfallstufe — gleiche Treffer, andere Reihenfolge. */

/** Suchanfrage → FTS5-Ausdruck. Jeder Begriff wird als Präfix gesucht
 * („suche“ findet „Suche“ und „suchend“); was nach FTS5-Syntax aussieht
 * (`OR`, `NOT`, Klammern, Doppelpunkt) ist vorher auf Wörter zurückgeschnitten.
 * Ein einzelner `"Phrasen"`-Begriff bleibt eine Phrase. */
export function buildFtsQuery(q: string): { match: string; terms: string[] } | null {
  const trimmed = q.trim();
  if (!trimmed) return null;
  const phrase = /^"(.+)"$/.exec(trimmed);
  if (phrase?.[1]?.trim()) {
    const inner = phrase[1].trim().replace(/"/g, '""');
    return { match: `"${inner}"`, terms: [inner.replace(/""/g, '"')] };
  }
  const terms = trimmed
    .split(/[\s,;]+/)
    .map((t) => t.replace(/[^\p{L}\p{N}'_-]/gu, "").replace(/-+/g, "-"))
    .filter((t) => t.length > 0);
  if (!terms.length) return null;
  // Zitiert + Präfix: die Anführungszeichen halten alles, was nach FTS5-Syntax
  // aussieht (or, NOT, Klammern, Doppelpunkt), sauber als Wort.
  return { match: terms.map((t) => `"${t.replace(/"/g, '""')}"*`).join(" "), terms };
}

/** Snippet für den Scan-Fallback: Fenster um den ersten Fund, alle Fundwörter
 * darin markiert — dasselbe Markerpaar wie FTS5, die PWA unterscheidet nicht. */
export function scanSnippet(text: string, terms: string[]): string {
  const lower = text.toLowerCase();
  const found: { at: number; len: number }[] = [];
  for (const term of terms) {
    const needle = term.toLowerCase();
    if (!needle) continue;
    for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, at + needle.length)) {
      found.push({ at, len: needle.length });
    }
  }
  if (!found.length) return text.replace(/\s+/g, " ").trim().slice(0, 220);
  found.sort((a, b) => a.at - b.at);
  const first = found[0]!;
  const start = Math.max(0, first.at - 140);
  const end = Math.min(text.length, first.at + 320);
  // Fenster erst markieren (Positionen gelten in `text`), dann Whitespace
  // glätten — umgekehrt würden die Markierungen an der Stelle vorbeirutschen.
  let out = "";
  let cursor = start;
  for (const f of found) {
    if (f.at >= end) break;
    if (f.at < cursor) continue; // überlappende Funde nicht doppelt einrahmen
    out += text.slice(cursor, f.at) + SNIPPET_MARK_OPEN + text.slice(f.at, f.at + f.len) + SNIPPET_MARK_CLOSE;
    cursor = f.at + f.len;
  }
  out += text.slice(cursor, end);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return (prefix + out.replace(/\s+/g, " ").trim() + suffix).slice(0, TranscriptQueryLimits.snippetMaxChars);
}

export interface SessionTextSearchOptions {
  q: string;
  limit?: number;
  offset?: number;
  roles?: readonly TranscriptRole[];
  /** exakte Projektpfad der Session */
  project?: string;
  /** jede Session, deren Projekt unter diesem Wurzelverzeichnis liegt */
  projectRoot?: string;
  sessionId?: string;
  sinceHours?: number;
}

export interface SessionTextSearchResult {
  hits: SessionTextHit[];
  total: number;
  /** Auf welcher Stufe gefunden wurde (`and` / `teil` / `or`) — die Oberfläche
   * sagt es dazu, sonst hält man eine Teilwort- oder ODER-Liste für Wortfunde. */
  mode: SessionSearchMode;
  facets: { role: TranscriptRole; count: number }[];
  index: SearchIndexState;
}

interface StateRow {
  session_id: string;
  byte_offset: number;
  size: number;
  mtime_ms: number;
}

export class SessionTextIndex {
  private readonly db: HubDatabase;
  private readonly dataDir: string;
  private useFts: boolean;
  private schemaReady = false;
  private lastRefreshMs = 0;

  constructor(db: HubDatabase, dataDir: string, opts: { fts?: boolean } = {}) {
    this.db = db;
    this.dataDir = dataDir;
    // `fts:false` ist der Haken, um den Rückfall zu prüfen (und der Ehrlich-
    // keitspfad, wenn der SQLite-Build kein FTS5 hat): selber Bestand, eigener
    // Durchlauf, eigene Reihenfolge.
    this.useFts = opts.fts ?? true;
  }

  engine(): SearchIndexState["engine"] {
    return this.useFts ? "fts5" : "scan";
  }

  /** FTS-Tabelle + Trigger liegen bewusst hier und nicht in der Migration:
   * fehlt FTS5 im SQLite-Build, wirft nur dieser Schritt — der Hub läuft und
   * sucht im Durchlauf, statt beim Start zu sterben. */
  ensureSchema(): void {
    if (this.schemaReady) return;
    this.db.prepare("SELECT 1 FROM transcript_lines LIMIT 1").get();
    if (this.useFts) {
      try {
        this.db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS transcript_fts USING fts5(
            text,
            content='transcript_lines',
            content_rowid='id',
            tokenize='unicode61 remove_diacritics 2'
          );
          CREATE TRIGGER IF NOT EXISTS transcript_lines_ai AFTER INSERT ON transcript_lines BEGIN
            INSERT INTO transcript_fts(rowid, text) VALUES (new.id, new.text);
          END;
          CREATE TRIGGER IF NOT EXISTS transcript_lines_ad AFTER DELETE ON transcript_lines BEGIN
            INSERT INTO transcript_fts(transcript_fts, rowid, text) VALUES ('delete', old.id, old.text);
          END;
        `);
      } catch {
        // Doch kein FTS5 im Build: der Durchlauf übernimmt, der Hub bleibt
        // handlungsfähig und meldet `engine: "scan"` statt zu sterben.
        this.useFts = false;
      }
    }
    this.schemaReady = true;
  }

  private sessionsRoot(): string {
    return join(this.dataDir, "sessions");
  }

  private blobPath(sessionId: string, hash: string): string {
    return join(this.sessionsRoot(), sessionId, "blobs", hash);
  }

  /** Liest ab `offset` bis zum Ende und liefert nur vollständige Zeilen zurück;
   * der zurückgegebene Offset zeigt hinter die letzte `\n`. Ein angebrochener
   * Schwanz (der Hub schreibt gerade) wird beim nächsten Mal gelesen. */
  private async readNewLines(path: string, offset: number): Promise<{ lines: string[]; offset: number; size: number; mtimeMs: number }> {
    const handle = await open(path, "r");
    try {
      const info = await handle.stat();
      const chunks: Buffer[] = [];
      let pos = offset;
      const buf = Buffer.allocUnsafe(READ_CHUNK_BYTES);
      while (pos < info.size) {
        const { bytesRead } = await handle.read(buf, 0, Math.min(buf.length, info.size - pos), pos);
        if (bytesRead === 0) break;
        chunks.push(Buffer.from(buf.subarray(0, bytesRead)));
        pos += bytesRead;
      }
      const raw = Buffer.concat(chunks).toString("utf8");
      const lastBreak = raw.lastIndexOf("\n");
      if (lastBreak < 0) return { lines: [], offset, size: info.size, mtimeMs: info.mtimeMs };
      const consumed = raw.slice(0, lastBreak);
      return {
        lines: consumed.split("\n").filter((l) => l.trim()),
        offset: offset + Buffer.byteLength(consumed) + 1,
        size: info.size,
        mtimeMs: info.mtimeMs,
      };
    } finally {
      await handle.close();
    }
  }

  /** Lädt den ausgelagerten Payload eines Ereignisses (K5-Blob). Fehlt die
   * Datei (bereits aufgeräumt), reicht die Zeilen-Vorschau — ein Fund in der
   * Vorschau ist besser als ein fehlender Treffer, und mehr gibt der Bestand
   * ehrlich nicht her. */
  private async payloadOf(ev: Record<string, unknown>, sessionId: string, cache: Map<string, Record<string, unknown>>): Promise<Record<string, unknown>> {
    const payload = (ev.payload && typeof ev.payload === "object" ? ev.payload : {}) as Record<string, unknown>;
    const ref = str(ev.blobRef);
    if (!ref) return payload;
    const hash = ref.replace(/^sha256:/, "");
    const hit = cache.get(hash);
    if (hit) return hit;
    try {
      const handle = await open(this.blobPath(sessionId, hash), "r");
      try {
        const info = await handle.stat();
        const buf = Buffer.alloc(Math.min(info.size, MAX_TEXT_CHARS * 2));
        const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
        const parsed = JSON.parse(buf.subarray(0, bytesRead).toString("utf8")) as unknown;
        const full = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : payload;
        cache.set(hash, full);
        return full;
      } finally {
        await handle.close();
      }
    } catch {
      return payload;
    }
  }

  private dropSessionRows(sessionId: string): void {
    this.db.prepare("DELETE FROM transcript_lines WHERE session_id = ?").run(sessionId);
    this.db.prepare("DELETE FROM transcript_state WHERE session_id = ?").run(sessionId);
  }

  /** Zieht die JSONL-Schwänze nach. `sessionIds` begrenzt auf Einzelfälle
   * (z. B. direkt nach einem Zug); ohne Angabe alle Sessions auf der Platte.
   * Kostet im Normalbetrieb das Nachlesen weniger Kilobyte. */
  async refresh(sessionIds?: string[]): Promise<{ sessions: number; lines: number }> {
    this.ensureSchema();
    const ids = sessionIds ?? ((await readdir(this.sessionsRoot(), { withFileTypes: true }).catch(() => []))
      .filter((e) => e.isDirectory())
      .map((e) => e.name));
    const stateRows = this.db.prepare("SELECT session_id, byte_offset, size, mtime_ms FROM transcript_state").all() as unknown as StateRow[];
    const state = new Map(stateRows.map((r) => [r.session_id, r]));
    let touched = 0;
    let inserted = 0;

    for (const sessionId of ids) {
      const path = join(this.sessionsRoot(), sessionId, "events.jsonl");
      const info = await stat(path).catch(() => null);
      const before = state.get(sessionId);
      if (!info) {
        // Session aufgeräumt: Indexzeilen mitnehmen, sonst wirbt ein Löschum
        // weiter in jeder Trefferliste.
        if (before) this.dropSessionRows(sessionId);
        continue;
      }
      let offset = before?.byte_offset ?? 0;
      if (info.size < offset) {
        // Datei neu geschrieben (K7-Restore, Konversion): von vorn.
        this.dropSessionRows(sessionId);
        offset = 0;
      }
      const { lines, offset: newOffset, size, mtimeMs } = await this.readNewLines(path, offset);
      if (!lines.length && offset === newOffset) {
        if (before && (before.size !== size || before.mtime_ms !== mtimeMs)) {
          this.db
            .prepare("INSERT INTO transcript_state (session_id, byte_offset, size, mtime_ms, indexed_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET size = excluded.size, mtime_ms = excluded.mtime_ms")
            .run(sessionId, newOffset, size, mtimeMs, new Date().toISOString());
        }
        continue;
      }
      const blobCache = new Map<string, Record<string, unknown>>();
      const records: IndexedLine[] = [];
      for (const line of lines) {
        let ev: Record<string, unknown>;
        try {
          const parsed = JSON.parse(line) as unknown;
          if (!parsed || typeof parsed !== "object") continue;
          ev = parsed as Record<string, unknown>;
        } catch {
          continue; // angebrochene Zeile — beim nächsten Mal vollständig
        }
        const payload = await this.payloadOf(ev, sessionId, blobCache);
        const text = eventText(ev, payload);
        const role = roleFor(String(ev.type ?? ""));
        if (!text || !role) continue;
        records.push({
          seq: typeof ev.seq === "number" ? ev.seq : 0,
          ts: str(ev.ts) ?? "",
          role,
          text,
        });
      }
      this.db.exec("BEGIN");
      try {
        const ins = this.db.prepare("INSERT INTO transcript_lines (session_id, seq, ts, role, text) VALUES (?, ?, ?, ?, ?)");
        for (const r of records) ins.run(sessionId, r.seq, r.ts, r.role, r.text);
        this.db
          .prepare(
            `INSERT INTO transcript_state (session_id, byte_offset, size, mtime_ms, events, indexed_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(session_id) DO UPDATE SET byte_offset = excluded.byte_offset, size = excluded.size,
               mtime_ms = excluded.mtime_ms, events = transcript_state.events + excluded.events, indexed_at = excluded.indexed_at`,
          )
          .run(sessionId, newOffset, size, mtimeMs, records.length, new Date().toISOString());
        this.db.exec("COMMIT");
      } catch (err) {
        this.db.exec("ROLLBACK");
        throw err;
      }
      touched += 1;
      inserted += records.length;
    }

    // Sessions, die es auf der Platte nicht mehr gibt, fallen aus dem Index.
    const onDisk = new Set(
      (await readdir(this.sessionsRoot(), { withFileTypes: true }).catch(() => []))
        .filter((e) => e.isDirectory())
        .map((e) => e.name),
    );
    for (const row of stateRows) if (!onDisk.has(row.session_id)) this.dropSessionRows(row.session_id);

    if (touched) this.lastRefreshMs = Date.now();
    else if (!this.lastRefreshMs) this.lastRefreshMs = Date.now();
    return { sessions: touched, lines: inserted };
  }

  /** Nur bei Bedarf nachziehen — eine Suche soll nicht jedes Mal das halbe
   * dataDir antippen, aber auch nie gegen einen Stand von gestern fragen. */
  async refreshIfStale(maxAgeMs = 2_000): Promise<void> {
    if (Date.now() - this.lastRefreshMs <= maxAgeMs) return;
    await this.refresh();
  }

  async state(): Promise<SearchIndexState> {
    this.ensureSchema();
    const rows = this.db.prepare("SELECT COUNT(*) AS lines, COUNT(DISTINCT session_id) AS sessions FROM transcript_lines").all() as unknown as { lines: number; sessions: number }[];
    const at = this.db.prepare("SELECT MAX(indexed_at) AS at FROM transcript_state").all() as unknown as { at: string | null }[];
    return {
      engine: this.engine(),
      sessions: rows[0]?.sessions ?? 0,
      lines: rows[0]?.lines ?? 0,
      indexedAt: at[0]?.at ?? null,
    };
  }

  async dropSession(sessionId: string): Promise<void> {
    this.ensureSchema();
    this.dropSessionRows(sessionId);
  }

  private where(opts: SessionTextSearchOptions, roles: readonly TranscriptRole[]): { sql: string; params: (string | number)[] } {
    const parts: string[] = [];
    const params: (string | number)[] = [];
    if (roles.length && roles.length < ROLES.length) {
      parts.push(`l.role IN (${roles.map(() => "?").join(",")})`);
      params.push(...roles);
    }
    if (opts.project) {
      parts.push("s.project = ?");
      params.push(opts.project);
    }
    if (opts.projectRoot) {
      const root = opts.projectRoot.replace(/\/+$/, "");
      parts.push("(s.project = ? OR s.project LIKE ? ESCAPE '\\')");
      params.push(root, `${likeEscape(root)}/%`);
    }
    if (opts.sessionId) {
      parts.push("l.session_id = ?");
      params.push(opts.sessionId);
    }
    if (opts.sinceHours && opts.sinceHours > 0) {
      const from = new Date(Date.now() - opts.sinceHours * 3_600_000).toISOString();
      parts.push("l.ts >= ?");
      params.push(from);
    }
    return { sql: parts.length ? ` AND ${parts.join(" AND ")}` : "", params };
  }

  /** Volltextsuche über die Sessiontexte in drei Stufen, und die gewählte Stufe
   * steht in der Antwort (`mode`):
   *  1. `and`  — jeder Begriff als (Präfix-)Wort.
   *  2. `teil` — jeder Begriff als Teilwort. Deutsch hängt Begriffe ans Ende von
   *     Zusammensetzungen: „Angebot“ steckt in „Sonderangebot“, und ein
   *     FTS5-Präfix (`"angebot"*`) findet das nicht. Diese Stufe ist kein
   *     Nice-to-have, sie ist der häufigste deutsche Suchfall.
   *  3. `or`   — Begriffe einzeln, nur wenn beides leer blieb.
   * Eine Liste, die nur einen Begriff trifft oder nur Teilwörter zeigt, darf
   * nicht wie ein Wortfund aussehen. */
  async search(opts: SessionTextSearchOptions): Promise<SessionTextSearchResult> {
    this.ensureSchema();
    const limit = Math.max(1, Math.min(opts.limit ?? TranscriptQueryLimits.defaultLimit, TranscriptQueryLimits.maxLimit));
    const offset = Math.max(0, opts.offset ?? 0);
    const roles = opts.roles ?? DEFAULT_TRANSCRIPT_ROLES;
    const index = await this.state();

    // Ohne FTS5 (oder ohne verwertbare Begriffe) ist der Durchlauf der einzige Weg.
    const built = this.useFts ? buildFtsQuery(opts.q) : null;
    if (!built) return this.searchScan(opts, limit, offset, roles, index);

    // Die Stufen werden vor dem Ausliefern entschieden, nicht seitengeweise:
    // dieselbe Anfrage muss auf Seite 1 und Seite 2 dieselbe Stufe benutzen,
    // sonst vermischt „mehr laden“ Wortfunde mit Teilwortfunden.
    const andMatch = built.terms.map((t) => `"${t.replace(/"/g, '""')}"*`).join(" ");
    if (this.probeFts(andMatch, opts, roles)) {
      return { ...this.runFts(andMatch, opts, limit, offset, roles), mode: "and", index };
    }
    const part = this.searchScan(opts, limit, offset, roles, index);
    if (part.total > 0) return part;
    if (built.terms.length > 1) {
      const orMatch = built.terms.map((t) => `"${t.replace(/"/g, '""')}"*`).join(" OR ");
      if (this.probeFts(orMatch, opts, roles)) {
        return { ...this.runFts(orMatch, opts, limit, offset, roles), mode: "or", index };
      }
    }
    return { hits: [], total: 0, mode: "and", facets: [], index };
  }

  /** Kostet eine Zeile: gibt es überhaupt einen Treffer für diesen Ausdruck?
   * Die Stufenentscheidung braucht keine Snippets und keine Rangliste. */
  private probeFts(
    match: string,
    opts: SessionTextSearchOptions,
    roles: readonly TranscriptRole[],
  ): boolean {
    const filter = this.where(opts, roles);
    const row = this.db
      .prepare(
        `SELECT 1 AS hit
         FROM transcript_fts
         CROSS JOIN transcript_lines l ON l.id = transcript_fts.rowid
         LEFT JOIN sessions s ON s.id = l.session_id
         WHERE transcript_fts MATCH ?${filter.sql}
         LIMIT 1`,
      )
      .get(match, ...filter.params) as unknown as { hit: number } | undefined;
    return !!row;
  }

  /** Ein FTS5-Durchlauf: Trefferzeilen, Gesamtzahl, Rollen-Facetten.
   *
   * Zwei Dinge sind hier nicht beliebig (beides an dieser SQLite-Version
   * gemessen, nicht erraten):
   *  - `CROSS JOIN` statt `JOIN` — `snippet()` und die `rank`-Spalte von FTS5
   *    sind nur benutzbar, solange die Volltexttabelle im Abfrageplan links
   *    oben steht; sonst stellt SQLite um und wirft „unable to use function
   *    snippet in the requested context“.
   *  - keine Fensterfunktion — dieselbe Grenze. Die Zahl der Funde pro
   *    Sitzung kommt deshalb als eigene GROUP-Abfrage.
   * Die Rollen-Gewichtung sitzt im `ORDER BY` auf der `rank`-Spalte (die
   * standardmäßig bm25 ist: negativ, kleiner = besser). */
  private runFts(
    match: string,
    opts: SessionTextSearchOptions,
    limit: number,
    offset: number,
    roles: readonly TranscriptRole[],
  ): { hits: SessionTextHit[]; total: number; facets: { role: TranscriptRole; count: number }[] } {
    const filter = this.where(opts, roles);
    const scope = this.where(opts, []);
    const boost = Object.entries(ROLE_BOOST)
      .map(([role, w]) => `WHEN '${role}' THEN ${w}`)
      .join(" ");
    const body = `FROM transcript_fts
         CROSS JOIN transcript_lines l ON l.id = transcript_fts.rowid
         LEFT JOIN sessions s ON s.id = l.session_id
         WHERE transcript_fts MATCH ?${filter.sql}`;
    const rows = this.db
      .prepare(
        `SELECT l.session_id, l.seq, l.ts, l.role,
                snippet(transcript_fts, 0, ?, ?, '…', ${TranscriptQueryLimits.snippetWords}) AS snippet,
                transcript_fts.rank AS rank,
                s.title AS title, COALESCE(s.project, '') AS project, COALESCE(s.archived, 0) AS archived
         ${body}
         ORDER BY transcript_fts.rank * CASE l.role ${boost} ELSE 1 END ASC, l.ts DESC
         LIMIT ? OFFSET ?`,
      )
      .all(SNIPPET_MARK_OPEN, SNIPPET_MARK_CLOSE, match, ...filter.params, limit, offset) as unknown as FtsRow[];
    const total = (this.db.prepare(`SELECT count(*) AS n ${body}`).get(match, ...filter.params) as unknown as { n: number }).n;
    const perSession = new Map(
      (
        this.db.prepare(`SELECT l.session_id AS id, count(*) AS c ${body} GROUP BY l.session_id`).all(match, ...filter.params) as unknown as { id: string; c: number }[]
      ).map((r) => [r.id, r.c]),
    );
    // Facetten ohne Rollenfilter, aber mit Projekt-/Sitzungsfilter: die Chips
    // zeigen, was es gäbe, auch wenn gerade nur Fragen und Antworten an sind.
    const facets = (
      this.db
        .prepare(
          `SELECT l.role AS role, count(*) AS c
           FROM transcript_fts
           CROSS JOIN transcript_lines l ON l.id = transcript_fts.rowid
           LEFT JOIN sessions s ON s.id = l.session_id
           WHERE transcript_fts MATCH ?${scope.sql}
           GROUP BY l.role`,
        )
        .all(match, ...scope.params) as unknown as { role: TranscriptRole; c: number }[]
    ).map((r) => ({ role: r.role, count: r.c }));
    return { hits: rowsToHits(rows, perSession), total, facets };
  }

  /** Teilwort-Stufe (und Rückfall ohne FTS5): alle Begriffe müssen als Teil des
   * Textes vorkommen, Reihenfolge nach Zeit (neueste zuerst). Weniger klug als
   * bm25, aber wahr — die Stufe heißt in der Antwort `teil`, der Indexzustand
   * nennt die Engine (`scan`), wenn gar kein Volltextindex da ist. */
  private searchScan(
    opts: SessionTextSearchOptions,
    limit: number,
    offset: number,
    roles: readonly TranscriptRole[],
    index: SearchIndexState,
  ): SessionTextSearchResult {
    const terms = opts
      .q.trim()
      .replace(/^"|"$/g, "")
      .split(/[\s,;]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (!terms.length) return { hits: [], total: 0, mode: "and", facets: [], index };
    const like = terms.map(() => "lower(l.text) LIKE ? ESCAPE '\\'").join(" AND ");
    const likeParams = terms.map((t) => `%${t.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    const filter = this.where(opts, roles);
    const where = `WHERE ${like}${filter.sql}`;
    const rows = this.db
      .prepare(
        `SELECT l.session_id, l.seq, l.ts, l.role, l.text,
                count(*) OVER (PARTITION BY l.session_id) AS session_hits,
                s.title AS title, COALESCE(s.project,'') AS project, COALESCE(s.archived,0) AS archived
         FROM transcript_lines l
         LEFT JOIN sessions s ON s.id = l.session_id
         ${where}
         ORDER BY l.ts DESC, l.seq DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...likeParams, ...filter.params, limit, offset) as unknown as {
      session_id: string;
      seq: number;
      ts: string;
      role: TranscriptRole;
      text: string;
      session_hits: number;
      title: string | null;
      project: string;
      archived: number;
    }[];
    const total = (this.db.prepare(`SELECT count(*) AS n FROM transcript_lines l LEFT JOIN sessions s ON s.id = l.session_id ${where}`).get(...likeParams, ...filter.params) as unknown as { n: number }).n;
    const scope = this.where(opts, []);
    const facetRows = this.db
      .prepare(
        `SELECT l.role AS role, count(*) AS c
         FROM transcript_lines l LEFT JOIN sessions s ON s.id = l.session_id
         WHERE ${terms.map(() => "lower(l.text) LIKE ? ESCAPE '\\'").join(" AND ")}${scope.sql}
         GROUP BY l.role`,
      )
      .all(...likeParams, ...scope.params) as unknown as { role: TranscriptRole; c: number }[];
    return {
      hits: rows.map((r) => ({
        sessionId: r.session_id,
        seq: r.seq,
        ts: r.ts,
        role: r.role,
        snippet: scanSnippet(r.text, terms),
        score: 0,
        sessionTitle: r.title,
        project: r.project,
        archived: r.archived === 1,
        sessionHits: r.session_hits,
      })),
      total,
      mode: "teil",
      facets: facetRows.map((r) => ({ role: r.role, count: r.c })),
      index,
    };
  }
}
