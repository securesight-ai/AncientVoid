import { EvalResult } from "@ancientvoid/contracts";
import { jobKey } from "./protocol.mjs";

const metrics = {
  failure: "Fehlerquote",
  wall: "ms",
  in: "Input-Tokens",
  out: "Output-Tokens",
  cost: "USD gesamt",
  cloudCost: "Cloud USD",
  energyCost: "P81 USD",
  rework: "Fehler tool_result",
};
const total = (rows, value) => rows.reduce((sum, row, index) => sum + value(row, index), 0);

export function summarise(values) {
  if (values.length < 5) throw new Error("Five observations are required for each result");
  const ordered = [...values].sort((a, b) => a - b);
  const median = (ordered[Math.floor((ordered.length - 1) / 2)] + ordered[Math.floor(ordered.length / 2)]) / 2;
  return { n: ordered.length, median, mean: total(ordered, (value) => value) / ordered.length, min: ordered[0], max: ordered.at(-1) };
}

function values({ input, phases }) {
  return {
    failure: Number(!(input.acceptance && input.lint && input.typecheck && phases.every((phase) => phase.turnErrors === 0))),
    wall: total(input.phases, (phase) => phase.wallMs),
    in: total(phases, (phase) => phase.inputTokens),
    out: total(phases, (phase) => phase.outputTokens),
    cost: total(phases, (phase) => phase.costUsd),
    cloudCost: total(phases, (phase, index) => input.phases[index].billing.kind === "cloud" ? phase.costUsd : 0),
    energyCost: total(phases, (phase, index) => input.phases[index].billing.kind === "local" ? phase.costUsd : 0),
    rework: total(phases, (phase) => phase.toolErrors),
  };
}

export function validateSeries(raw, plan) {
  const expected = new Map(plan.jobs.map((job) => [jobKey(job), job]));
  const found = new Map();
  const sessions = new Set();
  const rules = new Map();
  const versions = new Map();
  const skillHashes = new Map();
  let series;
  for (const value of raw) {
    const result = EvalResult.parse(value);
    const { input, phases } = result;
    const key = `${input.arm}/${input.task}/${input.repetition}`;
    const job = expected.get(key);
    if (!job || found.has(key)) throw new Error(`Unexpected or duplicate measurement ${key}`);
    series ??= input.series;
    if (input.series !== series || input.corpusHash !== plan.corpus.hash || input.protocolHash !== plan.protocolHash ||
        input.skills !== job.arm.skills || phases.length !== input.phases.length ||
        (rules.has(input.task) && rules.get(input.task) !== input.rulesHash) ||
        (skillHashes.has(input.task) && input.skills && skillHashes.get(input.task) !== input.skillHash)) {
      throw new Error(`Inconsistent measurement ${key}`);
    }
    const candidates = job.arm.plan ? [job.arm.plan, job.arm.build] : [job.arm.build];
    if (phases.length !== candidates.length) throw new Error(`Wrong number of phases in ${key}`);
    candidates.forEach((candidate, index) => {
      const phase = phases[index];
      const info = input.phases[index];
      const { kwh: _kwh, source: _source, ...tariff } = info.billing;
      const rate = info.billing.kind === "local" ? tariff : info.billing;
      if (phase.adapter !== candidate.adapter || phase.model !== candidate.model ||
          info.modelFingerprint !== candidate.fingerprint || info.harnessVersion !== candidate.harnessVersion ||
          JSON.stringify(rate) !== JSON.stringify(candidate.billing) || sessions.has(info.sessionId) ||
          (versions.has(phase.adapter) && versions.get(phase.adapter) !== phase.adapterVersion)) {
        throw new Error(`Phase mismatch or version drift in ${key}`);
      }
      sessions.add(info.sessionId);
      versions.set(phase.adapter, phase.adapterVersion);
    });
    rules.set(input.task, input.rulesHash);
    if (input.skills) skillHashes.set(input.task, input.skillHash);
    found.set(key, { ...result, values: values(result) });
  }
  if (found.size !== expected.size) throw new Error(`Incomplete series: ${found.size}/${expected.size} results`);
  return { series, rows: [...found.values()], rules, versions, skillHashes };
}

const show = (num) => Number(num.toPrecision(5)).toString();
const format = (s) => `${show(s.median)} (${show(s.mean)}; ${show(s.min)}–${show(s.max)})`;
const stats = (rows) => Object.fromEntries(Object.keys(metrics).map((metric) => [metric, summarise(rows.map((row) => row.values[metric]))]));
const rank = (groups, metric) => {
  const key = metric === "failure" ? "mean" : "median";
  const items = Object.keys(groups).sort((a, b) => groups[a][metric][key] - groups[b][metric][key] || a.localeCompare(b, "en"));
  return items.map((id, idx) => (idx ? groups[id][metric][key] === groups[items[idx - 1]][metric][key] ? " = " : " < " : "") + id).join("");
};

function rankingGroups(rows, plan, group) {
  return Object.fromEntries(plan.arms.filter((arm) => arm.group === group).map((arm) =>
    [arm.id, stats(rows.filter((row) => row.input.arm === arm.id))]));
}

function compareArms(arm, other) {
  if (arm.group !== "core" || other.group !== "core") return null;
  const harness = arm.build.harnessId !== other.build.harnessId;
  const model = arm.build.fingerprint !== other.build.fingerprint;
  const skills = arm.skills !== other.skills;
  const billingKind = arm.build.billing.kind !== other.build.billing.kind;
  if (skills && !harness && !model && !billingKind) return "Skills";
  if (model && !harness && !skills) return "Modell";
  if (harness && !model && !skills && !billingKind) return "Harness";
  return "Mehrere Faktoren";
}

export function renderReport(primary, repeat, plan, { date, commit, runtime, skillRuns = [] }) {
  const a = validateSeries(primary, plan);
  const b = validateSeries(repeat, plan);
  const aSessions = new Set(a.rows.flatMap((row) => row.input.phases.map((phase) => phase.sessionId)));
  if (a.series === b.series || b.rows.some((row) => row.input.phases.some((phase) => aSessions.has(phase.sessionId))) ||
      [...a.rules].some(([task, hash]) => b.rules.get(task) !== hash) ||
      [...a.skillHashes].some(([task, hash]) => b.skillHashes.get(task) !== hash) ||
      [...a.versions].some(([adapter, version]) => b.versions.get(adapter) !== version)) {
    throw new Error("Reproduction requires independent sessions with the same rules and versions");
  }
  const lines = [
    `# P84 — Evaluations-Kernserie (${date})`, "",
    `- Serien: ${a.series}, ${b.series}`, `- Prüfstand und Runtime: ${plan.config.setup}; ${runtime}`,
    `- Commit: ${commit}`, `- Messwerkzeug: npm run messlauf:eval (K7/K8)`,
    `- Korpus SHA-256: ${plan.corpus.hash}`, `- Protokoll SHA-256: ${plan.protocolHash}`, "",
    "Zellen zeigen Median (Mittelwert; Minimum–Maximum). Fehlerquote als Anteil 0–1. Nachbesserungen sind gemeldete Werkzeugfehler als Näherungswert.", "",
  ];
  let reproduced = true;
  for (const group of ["core", "split"]) {
    const first = rankingGroups(a.rows, plan, group);
    const second = rankingGroups(b.rows, plan, group);
    lines.push(`## Rangfolge ${group}`, "");
    for (const metric of Object.keys(metrics)) {
      const one = rank(first, metric);
      const two = rank(second, metric);
      reproduced &&= one === two;
      lines.push(`- ${metrics[metric]}: ${one === two ? "reproduziert" : "abweichend"}. ${a.series}: ${one}. ${b.series}: ${two}.`);
    }
    lines.push("");
  }
  lines.push("## Ergebnisse pro Aufgabe und Arm", "",
    "| Serie | Arm | Aufgabe | n | " + Object.values(metrics).join(" | ") + " |",
    "| --- | --- | --- | ---: |" + " ---: |".repeat(Object.keys(metrics).length));
  for (const series of [a, b]) {
    for (const arm of plan.arms) {
      const rows = series.rows.filter((row) => row.input.arm === arm.id);
      for (const task of [...new Set(rows.map((row) => row.input.task)), "gesamt"]) {
        const group = task === "gesamt" ? rows : rows.filter((row) => row.input.task === task);
        const result = stats(group);
        lines.push(`| ${series.series} | ${arm.id} | ${task} | ${group.length} | ${Object.values(result).map(format).join(" | ")} |`);
      }
    }
  }
  lines.push("", "## Vergleichbarkeit und Prüfstand", "");
  for (const [i, arm] of plan.arms.entries()) {
    for (const other of plan.arms.slice(i + 1)) {
      const factor = compareArms(arm, other);
      if (!factor) continue;
      let evidence = factor;
      if (factor === "Skills") {
        const observed = [a, b].map(({ rows }) => {
          const left = stats(rows.filter((row) => row.input.arm === arm.id));
          const right = stats(rows.filter((row) => row.input.arm === other.id));
          return Object.keys(metrics).map((metric) => left[metric].max < right[metric].min ? -1 : right[metric].max < left[metric].min ? 1 : 0);
        });
        const measurable = Object.keys(metrics).filter((_metric, index) => observed[0][index] && observed[0][index] === observed[1][index]);
        evidence = measurable.length ? `Skills trennbar bei ${measurable.map((metric) => metrics[metric]).join(", ")}` : "Skills nicht messbar getrennt vom Rauschen";
      }
      lines.push(`- ${arm.id} ↔ ${other.id} · ${evidence}`);
    }
  }
  lines.push("", "### Preis- und Energiesnapshots", "",
    "Cloud-Kosten sind Listenpreisäquivalente. Lokale Kosten basieren auf den P81-Komponenten und enthalten deren Grundlast. Fehlende Komponenten sind im P81-Prüfstand festzuhalten.", "");
  for (const [harness, config] of Object.entries(plan.config.harnesses)) {
    lines.push(`- ${harness} · CLI ${config.version}, Adapter ${a.versions.get(config.adapter)}, Konfiguration ${config.configurationFingerprint}`);
    for (const candidate of [config.cloud, config.local]) {
      const bill = candidate.billing;
      lines.push(bill.kind === "cloud"
        ? `  - ${candidate.model} (${candidate.fingerprint}) · Cloud ${bill.date}, ${bill.inputUsdPerMillion}/${bill.outputUsdPerMillion} USD pro Mio. Input/Output. [Preisquelle](${bill.source})`
        : `  - ${candidate.model} (${candidate.fingerprint}) · P81 ${bill.host}, ${bill.date}, ${bill.usdPerKwh} USD/kWh`);
    }
  }
  const dates = new Set(Object.values(plan.config.harnesses).map((entry) => entry.cloud.billing.date));
  if (dates.size > 1) lines.push("", "Cloud-Vergleiche umfassen unterschiedliche Preisstände.");
  for (const series of [a, b]) {
    const electricity = series.rows.flatMap((row) => row.input.phases).filter((phase) => phase.billing.kind === "local");
    lines.push(`- ${series.series} · lokale Energie gesamt ${show(total(electricity, (phase) => phase.billing.kwh))} kWh`);
  }
  lines.push("", "### Regel-Last und Skill-Zuordnung", "");
  for (const [task, hash] of a.rules) {
    lines.push(`- ${task} · Regel-SHA-256 ${hash}, Skill-SHA-256 ${a.skillHashes.get(task)}`);
  }
  const invoked = new Map(skillRuns.map((run) => [run.sessionId, run.skills]));
  for (const series of [a, b]) {
    for (const arm of plan.arms) {
      const phases = series.rows.filter((row) => row.input.arm === arm.id).flatMap((row) => row.input.phases);
      const matches = phases.map((phase) => invoked.get(phase.sessionId)).filter(Boolean);
      const found = new Set(matches.flatMap((skill) => [...skill.chain, ...skill.invoked]));
      lines.push(`- ${series.series}/${arm.id} · ${matches.length}/${phases.length} Journale ausgewertet · beobachtet ${[...found].join(", ") || "keine Zuordnung"}`);
    }
  }
  const clean = plan.corpus.tasks.filter((task) => !task.contaminationRisk);
  lines.push("", "## Sensitivitätsanalyse", "");
  if (!clean.length) lines.push("Alle Korpus-Aufgaben stammen aus öffentlicher Historie und sind als potenziell kontaminiert markiert. Nach Ausschluss bleibt keine Stichprobe.");
  else {
    const ids = new Set(clean.map((task) => task.id));
    for (const series of [a, b]) for (const group of ["core", "split"]) {
      if (group === "split" && !clean.some((task) => task.split)) continue;
      const groups = rankingGroups(series.rows.filter((row) => ids.has(row.input.task)), plan, group);
      lines.push(`- ${series.series}/${group} · Fehlerquote ${rank(groups, "failure")}`);
    }
  }
  lines.push("", "## Anhang · Entscheidungsvorlage", "");
  const compare = (rows, group) => rank(rankingGroups(rows, plan, group), "failure");
  lines.push(`- Mechanische Zuverlässigkeit der drei Split-Arme, ${a.series}: ${compare(a.rows, "split")}; ${b.series}: ${compare(b.rows, "split")}.`);
  if (reproduced) {
    const groups = rankingGroups(a.rows, plan, "core");
    const best = Object.keys(groups).sort((x, y) => groups[x].failure.mean - groups[y].failure.mean || groups[x].cost.median - groups[y].cost.median || groups[x].wall.median - groups[y].wall.median)[0];
    lines.push(`- Empfehlung für diesen Korpus: ${best}. Fehlerquote hat Vorrang, bei Gleichstand folgen Median der USD-Kosten und Wandzeit.`);
  } else {
    lines.push("- Die Rangfolge wechselt bei mindestens einer aggregierten Metrik. Für eine stabile Kombinations-Empfehlung reicht diese Stichprobe nicht.");
  }
  return { markdown: lines.join("\n") + "\n", reproduced };
}
