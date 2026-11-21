# Referenz: hubctl

**Art:** referenz

> Generiert von `scripts/gen-reference.mjs` (`npm run docs:reference`) aus der `usage()`-Ausgabe von `apps/hubctl/src/cli.ts`.
> Nicht von Hand bearbeiten — `npm run check:context` scheitert bei veraltetem Stand.

```text
hubctl — AncientVoid reference client

Usage:
  hubctl --lang de|en                       Sets the output language (AV_LANG, LANG; default: en)
  hubctl health
  hubctl adapters
  hubctl sessions                         includes interrupted/unknown status as text
  hubctl activity <sessionId> <id> running|completed|failed
  hubctl activity <sessionId> <id> run -- <command> [args...]  registers a job with heartbeat
  hubctl discover
  hubctl inventory
  hubctl show <sessionId>
  hubctl events <sessionId> [afterSeq]
  hubctl tail <sessionId> [-f]             includes session.interrupted and its reason
  hubctl token issue <label> [--agent|--display [--answer-questions]] [--db <hub.db>]   (--agent: label agent:<label>, writes need approval; --display: label display:<label>, reads and decides write approvals only)
  hubctl token list [--db <hub.db>]
  hubctl token revoke <label> [--db <hub.db>]
  hubctl fleet invite [--db <hub.db>]     one-time code for another hub to pair (10 min)
  hubctl fleet peers [--db <hub.db>]      hubs this one is paired with
  hubctl workers list                     show orphaned ancientvoid workers (local, BUG-0034)
  hubctl workers prune                    remove orphaned ancientvoid workers (local)
  hubctl worktrees [--db <hub.db>]        session worktrees with state and size (local, EPIC-P14)
  hubctl worktrees prune [--apply] [--db <hub.db>]   clean worktrees of ended/archived sessions; dry run without --apply
  hubctl workspace <sessionId>                      workspace phase/services (EPIC-P29)
  hubctl workspace logs <sessionId> <serviceId>     service logs (truncated tail)
  hubctl workspace retry <sessionId>                manual retry after failed setup
  hubctl workspace preview <sessionId> <serviceId>  preview URL with 5-minute ticket
  hubctl main-sync <sessionId> [--check|--apply]    measurement/dry run or merge origin/main (EPIC-P67)
  hubctl main-sync --project <path> [--check|--apply]   all worktree sessions of the project
  hubctl main-sync --settings                       main-sync settings (global + overrides)
  hubctl browser <sessionId>                        browser status/targets/console (EPIC-P39, read-only)
  hubctl browser tests <sessionId>                  test runs with status (EPIC-P39)
  hubctl devices                                    Android devices: SDK/KVM, inventory, AVDs, leases (EPIC-P42, read-only)
  hubctl devices tests <serial>                     device test runs with status (EPIC-P42)
  hubctl automations list                           scheduled runs with next occurrence and last result (EPIC-P41)
  hubctl automations show <id>                      definition and history (claims, session/team references)
  hubctl automations create <definition.json> [prompt.txt]   creates disabled; session targets need the prompt
  hubctl automations update <id> <patch.json> [prompt.txt]  save changes, new approval needed
  hubctl automations preview <id>                    next occurrences with local time and UTC
  hubctl automations enable <id>                    activation = human approval (generation stays)
  hubctl automations disable <id>                   stops future occurrences, running work unchanged
  hubctl automations run-now <id>                   own run now; the result comes from the referenced execution
  hubctl automations resolve <id> <claimKey> --note <text>  abandon an unclear start without a reference, releases the plan (ADR-0072)
  hubctl backup create --config <hub.config.json> --out <file> --key-file <file>
  hubctl backup restore --archive <file> --data-dir <empty-dir> --config-out <file> --key-file <file>
  hubctl backup prune --dir <archive-dir> --keep <count> [--apply]   preview unless --apply

Env:
  ANCIENTVOID_URL   hub base url (default http://127.0.0.1:7373)
  ANCIENTVOID_TOKEN device token
```
