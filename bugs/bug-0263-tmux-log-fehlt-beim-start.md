---
id: BUG-0263
slug: tmux-log-fehlt-beim-start
status: fixed
severity: S2
area: workers
instance: dev
commit: ""
forge: "https://github.com/securesight-ai/AncientVoid/issues/104"
epic: P17
created: 2026-11-23
reporter: Codex
---

# BUG-0263 — tmux-Worker startet ohne lesbares Log

Im vollen Vitest-Lauf meldete `FileTailer.start` für den Nachfolger eines
Workers `ENOENT`. Der Watcher startete, bevor die asynchrone tmux-Pipe ihre
Logdatei geöffnet hatte. Ein Logverzeichnis mit Leerzeichen reproduzierte
denselben Fehler im vorhandenen Stdout-Test, weil die Shell den Pfad trennte.

Der Runner legt das Generationslog vor der Pipe an und übergibt den Pfad als
ein Shell-Argument. `packages/workers/test/tmux.test.ts` prüft den Logstart
mit Leerzeichen, die vollständige Ausgabe und aufeinanderfolgende Worker.
