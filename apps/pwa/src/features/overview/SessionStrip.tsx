import { t } from "../../shared/i18n/index.ts";
import { useEffect, useState } from "preact/hooks";
import { hubApi, remoteHost, type SessionRecord } from "../../shared/api.ts";
import { StatusDot } from "../../shared/StatusDot.tsx";
import { TabIcon } from "../../shared/TabIcon.tsx";
import { getHubStatus, useHubStatus } from "../shell/hub-status.ts";
import { pageHash, sessionHash } from "../../app/route.ts";
import { SECTION_ORDER, sectionOf } from "./queue.ts";
import { projectName } from "../../shared/project-name.ts";

/** Reihenfolge der Warteschlange (T43.3): wer dran ist zuerst, innerhalb der Gruppe zuletzt bewegt zuerst. */
function stripOrder(sessions: readonly SessionRecord[]): SessionRecord[] {
  const rank = (s: SessionRecord) => SECTION_ORDER.indexOf(sectionOf(s));
  return sessions.filter((s) => !s.archived).sort((a, b) => rank(a) - rank(b) || b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * EPIC-P43 T43.6: Tablet-Zweispalter (700–1279 px) — die Sessions neben der offenen Session, im Hochformat
 * als Streifen darüber. Die Übersicht selbst ist dann nicht geladen; der Streifen holt die Liste selbst
 * (gleicher Takt wie App.tsx) und nutzt sonst den zuletzt veröffentlichten Stand.
 */
export function SessionStrip({ currentId }: { currentId: string }) {
  const hub = useHubStatus(3000);
  const [sessions, setSessions] = useState<SessionRecord[]>(() => getHubStatus().sessions);
  useEffect(() => {
    let alive = true;
    const tick = () =>
      void hubApi
        .fleet()
        .then((f) => f.sessions)
        .catch(() => hubApi.sessions())
        .then((list) => alive && setSessions(list))
        .catch(() => undefined);
    tick();
    const timer = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  const questions = new Set(hub.questionSessions);
  return (
    <nav class="session-strip" aria-label={t("common.sessions_cap")}>
      {stripOrder(sessions).map((s) => {
        const name = s.title ?? projectName(s.project) ?? s.project;
        const here = s.id === currentId;
        return (
          <button
            key={s.id}
            type="button"
            class={`strip-item${here ? " active" : ""}`}
            aria-current={here ? "page" : undefined}
            title={name}
            onClick={() => {
              if (!here) location.hash = sessionHash(s.id, remoteHost(s.hostId));
            }}
          >
            <StatusDot status={s.status} question={questions.has(s.id)} label={false} />
            <span class="strip-name">{name}</span>
          </button>
        );
      })}
      <button type="button" class="strip-item strip-new" aria-label={t("common.new_session")} title={t("common.new_session")} onClick={() => (location.hash = pageHash("new"))}>
        <TabIcon name={"neu"} />
      </button>
    </nav>
  );
}
