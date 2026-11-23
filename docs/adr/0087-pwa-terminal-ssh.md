# ADR-0087 — PWA-Terminal: SSH über den Hub, Allowlist in der Config

**Status:** akzeptiert · **Betrifft:** `packages/contracts/src/terminal/`,
`packages/core` (`terminals` in HubConfig), `apps/hub/src/modules/terminal/`,
`apps/pwa/src/features/terminal/`.

## Kontext

Operatoren brauchen vom Handy/PC aus eine Shell auf erlaubten Hosts
(z. B. evox2), ohne Cursor/Plan-Umwege — etwa um Peer-`hub.config` zu
pflegen. Native PTY-Module sind ausgeschlossen (AGENTS.md: kein natives
Addon neben `node:sqlite`).

## Entscheidung

1. **Allowlist** `terminals[]` in `hub.config.json`: jedes Ziel hat `id`,
   `label` und entweder `ssh` (OpenSSH-Ziel/`Host`-Alias) oder `local: true`
   (Hub-Host via `script -qfc 'bash -l'`). Keine freien Hostnamen vom Client.
2. **API:** `GET /api/terminals`, Ticket `POST /api/terminals/:id/ticket`,
   Stream `GET /api/terminals/:id/stream?ticket=` (WebSocket, Auth wie STT).
3. **Transport:** JSON-Frames `{t:"i"|"o"|"r"|"x"|"e",…}` — stdin/out als
   Text, Resize als Hinweis (Start-`COLUMNS`/`LINES`; ohne node-pty kein
   zuverlässiges Live-Resize).
4. **PWA:** Tab „Terminal“ (Mehr-Menü), xterm.js, nur konfigurierte Ziele.
5. **K5:** kein EventBus — nur REST/WS. Secrets bleiben in SSH-Agent/Keyfiles
   des Hub-Prozesses, nie in der PWA.

## Konsequenzen

- Contracts + Config + Route-Tests; Inventar-Eintrag.
- Ohne `terminals[]`: leere Liste, Seite erklärt die Config.
- Fail loud: SSH-Fehler / Exit als Stream-Ereignis sichtbar.

## Nachtrag 2026-11-20 — Sitzung überlebt das Trennen

Nutzerwunsch: Die letzte Terminal-Sitzung bleibt offen, auch wenn man den
Tab oder die App verlässt.

- Die Shell gehört einer **Hub-Sitzung** (id per Frame `{t:"s",id}`), nicht
  der WebSocket. Schließt der Browser normal oder bricht die Verbindung ab,
  läuft die Shell weiter; nach `TERMINAL_DETACH_TTL_MS` (60 min) ohne
  Verbindung beendet der Hub sie.
- Wiederanhängen: `…/stream?ticket=…&session=<id>` (Ticket bleibt Pflicht).
  Der Hub sendet zuerst `{t:"s"}`, dann den Ausgabe-Puffer
  (`TERMINAL_BACKLOG_CHARS`). Ein zweiter Client übernimmt, der alte bekommt
  Close-Code 4409.
- Beenden: Der Client schließt mit `TERMINAL_CLOSE_END` (4000), dann endet
  die Shell sofort. In der PWA heißt der Knopf „Beenden“.
- Grenze: `TERMINAL_MAX_ACTIVE` zählt laufende Sitzungen. Ist sie erreicht,
  weicht die am längsten getrennte Sitzung.
- PWA: `localStorage["ancientvoid.terminal.last"]` merkt sich `{target, session}`.
  Beim Öffnen des Tabs und bei `visibilitychange → visible` wird automatisch
  wieder angehängt.
- K7: Sitzungen sind flüchtig. Ein Hub-Neustart beendet sie, und der Client
  startet dann eine neue Shell. Wer Sitzungen über Hub-Neustarts hinweg
  braucht, nutzt tmux auf dem Ziel.

## Nachtrag 2026-11-23 — Shell-Auswahl, Auto-Erkennung, Farben, Copy/Paste

Nutzerreport nach dem ersten Arbeiten im Terminal-Tab: Farben passten nicht
zur App, die Shell war starr bash, und Einfügen (Strg+V) war unmöglich.

- **Shell pro Ziel:** lokale Ziele bekommen optionales `shell` (Pfad oder
  Name, Default bash) in `hub.config.json`. Login-Flag (`-l`) nur für
  bash/zsh. Die API (`TerminalTarget`) ändert sich nicht — `shell` bleibt
  Hub-intern, kein Contract-Bruch.
- **Auto-Erkennung:** `terminalAutodetect` (Default an) hängt die auf dem
  Hub-Host installierten Login-Shells (`/etc/shells`, Fallback-Sonde) als
  Ziele `local-<name>` an die Allowlist — config first, Duplikate und
  belegte ids übersprungen. Damit ist „ohne Config: leere Liste“ nur noch
  mit `terminalAutodetect: false` erreichbar.
- **Farben:** das xterm-Theme entsteht aus den App-Tokens
  (`terminal-theme.ts`), komplette ANSI-16-Palette; Cursor, Markierung und
  ANSI-Magenta laufen auf `--accent`. Die Fläche bleibt dunkel
  (`--content-terminal`, dokumenteneigen — auch im hellen App-Thema), weil
  Shell-Ausgaben auf Dunkel getunt sind.
- **Copy/Paste:** `attachCustomKeyEventHandler` + Klassifikator
  (`terminal-clipboard.ts`). Paste (Strg/Cmd+V ± Shift, Shift+Einfg) wird
  nur aus xterms Tastenlogik genommen — das native paste-Event der
  xterm-Textarea fügt ein (Bracketed Paste, kein Berechtigungsdialog).
  Copy: Strg/Cmd+Shift+C, Strg+Einfg, Strg+C mit Markierung (ohne bleibt
  es SIGINT), über den einen Kopierweg (ADR-0090). Toolbar-Buttons decken
  das Handy ohne Tastatur ab. OS-Kürzel außerhalb der Seite (z. B. Win+V
  der Windows-Zwischenablagenhistorie) bleiben außer Reichweite der App.
