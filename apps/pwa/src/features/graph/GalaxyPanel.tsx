import { t } from "../../shared/i18n/index.ts";
import type { GraphGroup, GraphNode } from "@ancientvoid/contracts";
import type { GalaxyCategory, GalaxyNeighbor } from "./galaxy-query.ts";
import { systemLabel, type GalaxySystem } from "./galaxy-layout.ts";
import { Button } from "../../shared/ui/index.ts";

const GROUP_LABEL: Record<GraphGroup, string> = { doc: "Doc", code: "Code", config: "Config", other: "Sonstiges" };
const KIND_LABEL = { import: "Import", link: "Verweis", asset: "Asset", pyimport: "Python" } as const;

export function GalaxyPanel(props: {
  narrow: boolean;
  sheet: "line" | "open";
  onSheet: (sheet: "line" | "open") => void;
  systems: GalaxySystem[];
  systemId: string | null;
  onEnterSystem: (id: string) => void;
  selected: GraphNode | null;
  neighbors: GalaxyNeighbor[];
  twoHop: boolean;
  onTwoHop: (on: boolean) => void;
  groups: GraphGroup[];
  onToggleGroup: (group: GraphGroup) => void;
  /** BUG-0232: dynamisch erkannte Kategorie-Bereiche des Repos (epics, bugs, …). */
  categories: GalaxyCategory[];
  cats: string[];
  onToggleCategory: (cat: string) => void;
  deadOnly: boolean;
  onDeadOnly: (on: boolean) => void;
  errorOnly: boolean;
  onErrorOnly: (on: boolean) => void;
  onSelect: (path: string) => void;
  onOpen: (path: string) => void;
}) {
  const { selected } = props;
  const incoming = props.neighbors.filter((n) => n.dir === "in" && (props.twoHop || n.hop === 1));
  const outgoing = props.neighbors.filter((n) => n.dir === "out" && (props.twoHop || n.hop === 1));
  const showLists = !props.narrow || props.sheet === "open";
  return (
    <aside class="graph-side" data-sheet={props.narrow ? props.sheet : "open"} aria-label={t("graph.galaxy")}>
      <div class="graph-filters" role="group" aria-label={t("graph.filter")}>
        {(Object.keys(GROUP_LABEL) as GraphGroup[]).map((g) => (
          <button
            key={g}
            type="button"
            class="graph-chip graph-chip-btn"
            aria-pressed={props.groups.includes(g)}
            onClick={() => props.onToggleGroup(g)}
          >
            {GROUP_LABEL[g]}
          </button>
        ))}
        <button type="button" class="graph-chip graph-chip-btn" aria-pressed={props.deadOnly} onClick={() => props.onDeadOnly(!props.deadOnly)}>
          {t("graph.dead_only")}
        </button>
        <button type="button" class="graph-chip graph-chip-btn" aria-pressed={props.errorOnly} onClick={() => props.onErrorOnly(!props.errorOnly)}>
          {t("graph.errors_only")}
        </button>
      </div>
      {props.categories.length > 1 && (
        <div class="graph-filters graph-cat-filters" role="group" aria-label={t("graph.categories")}>
          {props.categories.map((c) => (
            <button
              key={c.name}
              type="button"
              class="graph-chip graph-chip-btn"
              aria-pressed={props.cats.includes(c.name)}
              onClick={() => props.onToggleCategory(c.name)}
            >
              {c.name} {c.count}
            </button>
          ))}
        </div>
      )}
      {!props.systemId && props.systems.length > 0 && (
        <ul class="graph-systems-list">
          {props.systems.map((s) => (
            <li key={s.id}>
              <button type="button" aria-label={`Bereich ${systemLabel(s.id)}`} onClick={() => props.onEnterSystem(s.id)}>
                {systemLabel(s.id)} ({s.files.length})
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && (
        <section data-testid="graph-selection" aria-label={t("graph.selection")}>
          {props.narrow && props.sheet === "line" && (
            <div class="graph-sheet-line">
              <button type="button" class="graph-sheet-handle" aria-label={t("graph.expand_list")} onClick={() => props.onSheet("open")}>
                {selected.path}
              </button>
              <Button aria-label={t("graph.open_file")} onClick={() => props.onOpen(selected.path)}>
                {t("graph.open")}
              </Button>
            </div>
          )}
          {showLists && (
            <>
              <p class="graph-selection-path">{selected.path}</p>
              <p class="dim">
                {GROUP_LABEL[selected.group]}
                {selected.in === 0 && !selected.entry ? " · tot" : ""}
              </p>
              <Button aria-label={t("graph.open_file")} onClick={() => props.onOpen(selected.path)}>
                {t("graph.open")}
              </Button>
              <Button aria-pressed={props.twoHop} onClick={() => props.onTwoHop(!props.twoHop)}>
                {t("graph.two_steps")}
              </Button>
              <p class="graph-direction">
                <span class="graph-dir-in">{t("graph.incoming_arrow")}</span>
                {" · "}
                <span class="graph-dir-out">{t("graph.outgoing_arrow")}</span>
              </p>
              <NeighborList title={t("graph.used_by")} count={selected.in} items={incoming} onSelect={props.onSelect} />
              <NeighborList title={t("graph.used")} count={selected.out} items={outgoing} onSelect={props.onSelect} />
            </>
          )}
        </section>
      )}
    </aside>
  );
}

function NeighborList(props: { title: string; count: number; items: GalaxyNeighbor[]; onSelect: (path: string) => void }) {
  return (
    <div>
      <h3 class="graph-neighbor-title">
        {props.title} ({props.count})
      </h3>
      {props.items.length === 0 ? (
        <p class="dim">{t("graph.none")}</p>
      ) : (
        <ul class="graph-neighbors">
          {props.items.map((n, i) => (
            <li key={`${n.dir}:${n.hop}:${n.path}:${i}`}>
              <button type="button" onClick={() => props.onSelect(n.path)}>
                {n.path}
                {n.hop === 2 ? " · 2" : ""} · {KIND_LABEL[n.kind]}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
