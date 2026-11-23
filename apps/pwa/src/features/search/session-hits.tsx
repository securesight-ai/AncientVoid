import { SNIPPET_MARK_CLOSE, SNIPPET_MARK_OPEN, type SessionTextHit, type TranscriptRole } from "@ancientvoid/contracts";
import { t } from "../../shared/i18n/index.ts";
import { ago } from "../../shared/status.ts";
import { projectName } from "../../shared/project-name.ts";

/**
 * Suche (Nachschärfe 2026-11-22): Fundstellen aus den **Sessiontexten** —
 * Fragen, Antworten, Denk- und Werkzeugspuren. Der Fundus ist der echte
 * Gesprächsbestand des Hubs; diese Datei ordnet ihn für ein Handy: Gruppen pro
 * Sitzung, Rollen als Chip, Fundwort im Snippet hervorgehoben.
 *
 * PRD §8.5: Agenten-Text ist Daten, nie Instruktion. Die Marker des Hubs
 * (`\u0002`/`\u0003`) werden zu `<mark>`-Knoten zerlegt — niemals innerHTML.
 */

/** Rollen → Katalogschlüssel. Eigene Worte für die Unterhaltung: „Frage“ und
 * „Antwort“, nicht das technische `user`/`assistant` des Eventvertrags. */
export const ROLE_KEYS: Record<TranscriptRole, string> = {
  user: "search.role_question",
  assistant: "search.role_answer",
  thinking: "search.role_thinking",
  tool: "search.role_tool",
  system: "search.role_system",
};

/** Reihenfolge der Chips ist fest — eine Leiste, die je nach Suche umspringt,
 * lässt sich nicht bedienen. */
export const ROLE_ORDER: readonly TranscriptRole[] = ["user", "assistant", "thinking", "tool", "system"];

/** Standard: die Unterhaltung. Denk- und Werkzeugmassen sind opt-in — sie
 * füllen sonst jede Liste, weil sie in einem Zug am zahlreichsten sind. */
export const DEFAULT_ROLES: readonly TranscriptRole[] = ["user", "assistant"];

/** Fundzahl in Worten — Deutsch hat zwei Formen, der Katalog keine Pluralregel. */
export function hitsLabel(n: number): string {
  return t(n === 1 ? "search.hits_one" : "search.hits_many", { n });
}

export function roleLabel(role: TranscriptRole): string {
  return t(ROLE_KEYS[role]);
}

/** Rollen zu- oder abschalten. Eine Leiste ohne einzigen aktiven Chip ist keine
 * Suche: der letzte Chip bleibt stehen (sonst schickt die Oberfläche eine leere
 * Rollenauswahl, die der Hub still mit seiner Standardwahl füllt). */
export function toggleRole(roles: readonly TranscriptRole[], role: TranscriptRole): TranscriptRole[] {
  if (!roles.includes(role)) return ROLE_ORDER.filter((r) => roles.includes(r) || r === role);
  if (roles.length === 1) return [...roles];
  return roles.filter((r) => r !== role);
}

/** Facetten, die Treffer haben, aber abgeschaltet sind. Ohne diese Zahl
 * behauptet eine leere Ergebnisliste, der Hub wisse nichts — dabei liegen die
 * Funde in Denk- und Werkzeugspuren, die standardmäßig aus sind. */
export function hiddenFacetRoles(
  facets: readonly { role: TranscriptRole; count: number }[],
  roles: readonly TranscriptRole[],
): { roles: TranscriptRole[]; count: number } {
  const off = facets.filter((f) => f.count > 0 && !roles.includes(f.role));
  return { roles: off.map((f) => f.role), count: off.reduce((sum, f) => sum + f.count, 0) };
}

export interface SnippetPiece {
  text: string;
  hit: boolean;
}

/** Snippet in Text- und Fundstücke zerlegen (ungerade Indizes = Funde). */
export function splitSnippet(snippet: string): SnippetPiece[] {
  const parts = snippet.split(/[\u0002\u0003]/);
  const marked = snippet.includes(SNIPPET_MARK_OPEN) && snippet.includes(SNIPPET_MARK_CLOSE);
  if (!marked) return [{ text: snippet, hit: false }];
  return parts
    .filter((piece, i) => piece.length > 0 || (i > 0 && i < parts.length - 1))
    .map((text, i) => ({ text, hit: i % 2 === 1 }));
}

export interface HitGroup {
  sessionId: string;
  title: string;
  project: string;
  archived: boolean;
  total: number;
  hits: SessionTextHit[];
}

/** hoch N pro Sitzung, Rest einklappbar — eine Sitzung, die zwanzig Mal
 * denselben Begriff streift, darf nicht die halbe Ergebnisliste füllen. */
export const GROUP_VISIBLE = 3;

/** Funde nach Sitzung gruppieren, in der Reihenfolge ihrer besten Fundstelle. */
export function groupHits(hits: readonly SessionTextHit[], limit = GROUP_VISIBLE): HitGroup[] {
  const order: HitGroup[] = [];
  const byId = new Map<string, HitGroup>();
  for (const hit of hits) {
    let group = byId.get(hit.sessionId);
    if (!group) {
      group = {
        sessionId: hit.sessionId,
        title: hit.sessionTitle ?? "",
        project: hit.project,
        archived: hit.archived,
        total: hit.sessionHits,
        hits: [],
      };
      byId.set(hit.sessionId, group);
      order.push(group);
    }
    if (group.hits.length < limit) group.hits.push(hit);
  }
  return order;
}

export function Snippet({ snippet }: { snippet: string }) {
  return (
    <p class="hit-snippet">
      {splitSnippet(snippet).map((piece, i) =>
        piece.hit ? <mark key={i}>{piece.text}</mark> : <span key={i}>{piece.text}</span>,
      )}
    </p>
  );
}

export interface SessionHitsProps {
  groups: HitGroup[];
  /** Die Sitzung, in der die Suche gerade geöffnet ist — ihre Funde springen
   * im Chat zur Stelle, andere öffnen die Sitzung. */
  currentSessionId: string;
  onOpenSession: (sessionId: string) => void;
  onJumpToSeq?: (seq: number) => void;
}

export function SessionHits({ groups, currentSessionId, onOpenSession, onJumpToSeq }: SessionHitsProps) {
  return (
    <div class="hit-groups">
      {groups.map((group) => {
        const same = group.sessionId === currentSessionId;
        return (
          <section key={group.sessionId} class="hit-group">
            <header class="hit-group-head">
              <button type="button" class="hit-group-title" onClick={() => (same ? undefined : onOpenSession(group.sessionId))} disabled={same}>
                <span class="hit-title">{group.title || group.sessionId.slice(0, 8)}</span>
                <span class="hit-group-meta dim mono">
                  {projectName(group.project)}
                  {group.archived ? ` · ${t("search.archived")}` : ""}
                </span>
              </button>
              {/* Die Zahl pro Sitzung gibt es nur, wo sie etwasagt: bei
                  mehreren Sitzungen oder wenn unter der Liste weitere Funde
                  warten. Sonst wiederholt sie nur die Zahl des Überschrift. */}
              {(groups.length > 1 || group.total > group.hits.length) && (
                <span class="hit-group-count dim">{hitsLabel(group.total)}</span>
              )}
            </header>
            {group.hits.map((hit) => (
              <article key={`${hit.sessionId}:${hit.seq}`} class="hit-card">
                <div class="hit-head">
                  <span class={`hit-role hit-role--${hit.role}`}>{roleLabel(hit.role)}</span>
                  <span class="hit-when dim">{ago(hit.ts)}</span>
                  <span class="hit-seq dim mono">#{hit.seq}</span>
                  {same && onJumpToSeq ? (
                    <button type="button" class="hit-jump" onClick={() => onJumpToSeq(hit.seq)}>
                      {t("search.jump_to_hit")}
                    </button>
                  ) : !same ? (
                    <button type="button" class="hit-jump" onClick={() => onOpenSession(group.sessionId)}>
                      {t("search.open_session")}
                    </button>
                  ) : null}
                </div>
                <Snippet snippet={hit.snippet} />
              </article>
            ))}
          </section>
        );
      })}
    </div>
  );
}
