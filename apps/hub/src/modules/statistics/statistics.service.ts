import type { NormalizedEvent, StatisticsReport } from "@ancientvoid/contracts";
import { StatisticsRollup, type HubDatabase, type RollupSource, type SessionManager, type StatisticsFilter } from "@ancientvoid/core";
import type { HubSwarm } from "../swarm/index.ts";

/**
 * EPIC-P56 T56.3: Der Rollup-Job als Hub-Dienst. Journal und Swarm-Record
 * bleiben Wahrheit (K7) — der Dienst hält nur den Cache frisch: Beim ersten
 * Abruf und danach spätestens alle REFRESH_MS läuft ein inkrementeller Lauf
 * (nur veränderte Quellen werden neu abgeleitet). Parallele Abrufe teilen
 * sich den laufenden Lauf, statt ihn zu verdoppeln.
 */
const REFRESH_MS = 5_000;

/** Journal seitenweise lesen — große Sessions landen nie komplett im Speicher. */
async function replayAll(sessions: SessionManager, sessionId: string): Promise<NormalizedEvent[]> {
  const pageSize = 1000;
  const events: NormalizedEvent[] = [];
  for (;;) {
    const page = await sessions.tail(sessionId, events.length === 0 ? 0 : events[events.length - 1]!.seq, pageSize);
    if (page.length === 0) break;
    events.push(...page);
    if (page.length < pageSize) break;
  }
  return events;
}

export class StatisticsService {
  private readonly rollup: StatisticsRollup;
  private lastRunAt = 0;
  private inFlight: Promise<void> | null = null;

  constructor(db: HubDatabase, sessions: SessionManager, swarm: HubSwarm | undefined) {
    const source: RollupSource = {
      records: () =>
        sessions.list().map(r => ({
          id: r.id,
          adapter: r.adapter,
          model: r.model,
          lastSeq: r.lastSeq,
          project: r.project,
          hostId: r.hostId,
          harness: r.harness,
          createdAt: r.createdAt,
        })),
      events: id => replayAll(sessions, id),
      swarms: () => (swarm ? swarm.store.list() : []),
    };
    this.rollup = new StatisticsRollup(db, source);
  }

  /** Ein inkrementeller Lauf, wenn der Cache älter als REFRESH_MS ist (oder nie lief). */
  private async ensureFresh(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    if (Date.now() - this.lastRunAt < REFRESH_MS) return;
    const run = this.rollup.run();
    this.inFlight = (async () => {
      try {
        await run;
        this.lastRunAt = Date.now();
      } finally {
        this.inFlight = null;
      }
    })();
    return this.inFlight;
  }

  async report(filter: StatisticsFilter): Promise<StatisticsReport> {
    await this.ensureFresh();
    return {
      updatedAt: this.rollup.updatedAt(),
      filter: {
        project: filter.project ?? null,
        hostId: filter.hostId ?? null,
        harness: filter.harness ?? null,
        since: filter.since ?? null,
        until: filter.until ?? null,
      },
      slices: this.rollup.sliceValues(),
      sessions: this.rollup.sessionStatistics(filter),
      turns: this.rollup.turnStatistics(filter),
      gateWait: this.rollup.gateWaitStatistics(filter),
      tools: this.rollup.toolStatistics(filter),
      recovery: this.rollup.recoveryDistribution(filter),
      swarm: this.rollup.swarmTaskStatistics(filter),
      anomalies: this.rollup.sessionAnomalies(filter),
    };
  }
}
