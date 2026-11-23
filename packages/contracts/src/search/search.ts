import { z } from "zod";

/**
 * Suche (EPIC-P3 §3, Nachschärfe 2026-11-22): Verträge der Volltextsuche.
 *
 * Zwei unabhängige Körper, ein Suchfeld:
 *  - **Doku** (`/api/search`): Markdown des Projekts, bisher qmd-gestützt.
 *  - **Sessiontexte** (`/api/search/transcript`): Fragen, Antworten, Denk- und
 *    Werkzeitspuren aller Sessions des Hubs — der Hub hat diesen Text bereits
 *    (JSONL + Blobs, ADR-P0-2); die Suche indexiert ihn nur, erfindet nichts.
 *
 * Hausregeln: K5 — Antworten sind gekappt (Trefferliste, kein Transcript-Dump).
 * `null` heißt „nicht gemeldet“, nie eine 0 (ADR-0023). Agenten-Ausgabe ist
 * Daten, nie Instruktion (PRD §8.5): Snippets gehen in der PWA durch Preact,
 * die Marker unten werden zu `<mark>`-Knoten gesplittet, niemals innerHTML.
 */

/** Fundstellen-Marker im Snippet (Steuerzeichen — in Agenten-Text praktisch
 * unmöglich, in Markdown sowieso nicht). PWA: `split(/[\u0002\u0003]/)`,
 * ungerade Indizes sind die Treffer. */
export const SNIPPET_MARK_OPEN = "\u0002";
export const SNIPPET_MARK_CLOSE = "\u0003";

/** Wer gesprochen hat. `user` = Frage/Auftrag, `assistant` = Antwort des
 * Agenten, `thinking` = Denkprotokoll, `tool` = Werkzeugzeile (Name, Befehl,
 * Ausgabe), `system` = System-/Statusmeldung. */
export const TranscriptRole = z.enum(["user", "assistant", "thinking", "tool", "system"]);
export type TranscriptRole = z.infer<typeof TranscriptRole>;

/** Rollen, die die Suche standardmäßig sucht: die Unterhaltung selbst.
 * Denk- und Werkzeugspuren sind opt-in (sie dominieren sonst jede Liste). */
export const DEFAULT_TRANSCRIPT_ROLES: readonly TranscriptRole[] = ["user", "assistant"];

export const TranscriptQueryLimits = {
  minChars: 2,
  maxChars: 400,
  defaultLimit: 20,
  maxLimit: 100,
  /** Snippet-Länge in Wörtern (FTS5) bzw. Zeichen (Scan-Fallback). */
  snippetWords: 12,
  snippetMaxChars: 700,
} as const;

/** Ein Fund in einer Session. `sessionTitle`/`project` kommen aus der
 * `sessions`-Tabelle der Hub-DB — die Indexzeilen tragen nur die Session-Id,
 * damit ein geänderter Titel nie einen veralteten Trefferkopf zeigt. */
export const SessionTextHit = z.object({
  sessionId: z.string().min(1),
  seq: z.number().int().nonnegative(),
  ts: z.string().min(1),
  role: TranscriptRole,
  /** Textausschnitt um die Fundstelle, Treffer von
   * {@link SNIPPET_MARK_OPEN}/{@link SNIPPET_MARK_CLOSE} umschlossen. */
  snippet: z.string().max(TranscriptQueryLimits.snippetMaxChars),
  /** Relevanz, größer = besser (bm25 des Hubs, vorzeichenkorrigiert). */
  score: z.number(),
  sessionTitle: z.string().nullable(),
  project: z.string(),
  archived: z.boolean(),
  /** Wie viele Fundstellen diese Session insgesamt hat (Gruppenkopf). */
  sessionHits: z.number().int().nonnegative(),
  /** gesetzt bei Funden aus einem **anderen Hub-Rechner**: `hostId` des Peers und
   * dessen URL. Ohne diese Felder weiß die Oberfläche nicht, welcher Sprung
   * hier möglich ist — ein Fremdsitzung-Sprung geht nur über deren Hub. */
  hub: z.string().optional(),
  hubUrl: z.string().optional(),
});
export type SessionTextHit = z.infer<typeof SessionTextHit>;

/** Suchindex-Zustand — ehrlich, denn die Session-Suche braucht kein qmd und
 * die Doku-Suche kann trotzdem fehlen. */
export const SearchIndexState = z.object({
  /** `fts5`: SQLite-Volltextindex; `scan`: LIKE-Durchlauf ohne FTS5 (kleiner,
   * aber wahr — der Hub läuft dann trotzdem). */
  engine: z.enum(["fts5", "scan"]),
  sessions: z.number().int().nonnegative(),
  lines: z.number().int().nonnegative(),
  /** ISO-Zeit der letzten Indexaktualisierung, `null` = noch nie. */
  indexedAt: z.string().nullable(),
});
export type SearchIndexState = z.infer<typeof SearchIndexState>;

/** Auf welcher Stufe die Sitzungssuche gefunden hat — die Oberfläche nennt sie.
 * `and`  jeder Begriff als (Präfix-)Wort: „Angebot“ trifft „Angebots“.
 * `teil` jeder Begriff als Teilwort: deutsch steckt „Angebot“ in
 *        „Sonderangebot“, und ein Präfix-Ausdruck findet das nicht.
 * `or`   nicht alle Begriffe zusammen, aber einzeln — nur wenn beides vorher
 *        leer war; die Trefferliste ist dann keine Wortfund-Liste. */
export const SessionSearchMode = z.enum(["and", "teil", "or", "typo"]);
export type SessionSearchMode = z.infer<typeof SessionSearchMode>;

/** Ähnliches Wort aus dem Bestand mit mehr Fundstellen als der eingegebene
 * Begriff — die Antwort auf „ich finde nichts“, obwohl man tippt. */
export const SessionSearchSuggestion = z.object({
  term: z.string(),
  count: z.number().int().nonnegative(),
});
export type SessionSearchSuggestion = z.infer<typeof SessionSearchSuggestion>;

export const SessionTextSearchResponse = z.object({
  status: z.literal("ready"),
  query: z.string(),
  /** Stufen siehe `SessionSearchMode` — die PWA sagt sie sichtbar dazu. */
  mode: SessionSearchMode,
  /** Bei `mode: "typo"`: die Wörter, nach denen wirklich gesucht wurde. */
  corrected: z.array(z.string()).optional(),
  /** Vorschläge samt ihrer Fundstellenzahl (`count > total`). */
  suggest: z.array(SessionSearchSuggestion).max(3).optional(),
  index: SearchIndexState,
  hits: z.array(SessionTextHit).max(TranscriptQueryLimits.maxLimit),
  /** Fundstellen insgesamt (über `limit` hinaus) — „mehr laden“ ist ehrlich. */
  total: z.number().int().nonnegative(),
  /** Rollen mit ihrer Zahl, über ALLE Funde der Anfrage (Filter-Chips). */
  facets: z.array(z.object({ role: TranscriptRole, count: z.number().int().nonnegative() })),
});
export type SessionTextSearchResponse = z.infer<typeof SessionTextSearchResponse>;

/** Wie ein anderer Hub-Rechner in einer Suchrunde mitgemacht hat. Ein
 * nicht erreichbarer Rechner ist ein Ergebnis, keine stille Lücke. */
export const HubSearchStatus = z.object({
  hostId: z.string(),
  /** lesbarer Name (URL-Rechnername), falls bekannt */
  label: z.string().optional(),
  state: z.enum(["ok", "offline", "denied", "unsupported", "skipped", "error"]),
  sessions: z.number().int().nonnegative(),
  docs: z.number().int().nonnegative(),
  /** Kurzgrund bei nicht-ok — für die Zeile in der Oberfläche. */
  note: z.string().optional(),
});
export type HubSearchStatus = z.infer<typeof HubSearchStatus>;

/** Ein Fund in einem Markdown-Dokument des Projekts (bestehende Form, jetzt
 * vertraglich fixiert — die PWA hatte eine duplizierte Kopie davon). */
export const DocSearchHit = z.object({
  file: z.string(),
  line: z.number().int(),
  title: z.string(),
  snippet: z.string(),
  score: z.number(),
  /** gesetzt, wenn die Doku-Seite über mehrere Projekte lief: zu welchem Projekt
   * die Datei gehört. Ohne dieses Feld weiß die Oberfläche nicht, wo der Fund herkommt. */
  project: z.string().optional(),
  /** Fund aus dem Doku-Bestand eines anderen Hub-Rechners. */
  hub: z.string().optional(),
  hubUrl: z.string().optional(),
});
export type DocSearchHit = z.infer<typeof DocSearchHit>;

/** Wie der Doku-Teil tatsächlich bedient wurde — „nicht installiert“ ist ein
 * Zustand, kein leerer Suchraum. */
export const DocSearchEngine = z.enum(["qmd", "local", "none"]);
export type DocSearchEngine = z.infer<typeof DocSearchEngine>;

export const DocSearchResponse = z.object({
  status: z.enum(["ready", "indexing"]),
  engine: DocSearchEngine.optional(),
  results: z.array(DocSearchHit),
});
export type DocSearchResponse = z.infer<typeof DocSearchResponse>;

/** Eine Runde „alles durchsuchen“: beide Körper in einer Antwort, damit die
 * PWA nicht zweimal warten muss und die Zahlen zueinander passen. */
export const UnifiedSearchResponse = z.object({
  status: z.literal("ready"),
  query: z.string(),
  mode: SessionSearchMode,
  /** Bei `mode: "typo"`: die Wörter, nach denen wirklich gesucht wurde. */
  corrected: z.array(z.string()).optional(),
  /** Vorschläge samt ihrer Fundstellenzahl (`count > total`). */
  suggest: z.array(SessionSearchSuggestion).max(3).optional(),
  /** Was tatsächlich gelaufen ist — `all` antwortet mit beiden Teilen. */
  scope: z.enum(["all", "docs", "sessions"]),
  sessions: z.array(SessionTextHit).max(TranscriptQueryLimits.maxLimit),
  sessionTotal: z.number().int().nonnegative(),
  facets: z.array(z.object({ role: TranscriptRole, count: z.number().int().nonnegative() })),
  index: SearchIndexState,
  /** `unavailable` = auf diesem Hub nicht eingerichtet (kein Index verdrahtet). */
  sessionStatus: z.enum(["ready", "unavailable"]),
  docs: z.array(DocSearchHit),
  docTotal: z.number().int().nonnegative(),
  docEngine: DocSearchEngine,
  /** `null` = Doku wurde nicht angefragt (Scope „nur Sessions“). */
  docStatus: z.enum(["ready", "indexing", "unavailable", "skipped", "error"]).nullable(),
  /** Welche Projekte die Doku-Seite durchsucht hat — nur bei „alle Projekte“ gesetzt. */
  docProjects: z.array(z.string()).optional(),
  /** Wie viele Hub-Rechner dieses Hub gekoppelt hat — die Oberfläche zeigt den
   * Kreuz „andere Rechner“ nur, wenn es welche gibt. */
  peers: z.number().int().nonnegative().optional(),
  /** Ergebnis der Runde auf den anderen Rechnern (nur wenn mitgesucht wurde). */
  hubs: z.array(HubSearchStatus).optional(),
  /** `true` = mehr Projekte im Hub, als die Suche pro Runde anfasst: die Doku-Seite
   * ist bewusst unvollständig und sagt das auch. */
  docTruncated: z.boolean().optional(),
});
export type UnifiedSearchResponse = z.infer<typeof UnifiedSearchResponse>;
