---
id: BUG-0227
slug: stt-konvertierung-stirbt-am-tmp-quota
status: done
severity: S2
area: hub
instance: dev
forge: "https://github.com/securesight-ai/AncientVoid/issues/205"
epic: ""
created: 2026-11-20
reporter: "Kai (Nutzerreport: längere Diktate schlagen fehl, „Fehler … unknown, nicht lesbar")"
---

# BUG-0227 — längere Diktate sterben mit 422 „Aufnahme nicht lesbar (UNKNOWN: unknown error)": Test-Temp-Verzeichnisse füllen /tmp-Quota

## Gesehen

Längere Diktate schlagen auf dem Handy fehl, kürzere gehen durch. Der Hub
antwortet auf `POST /api/stt` mit **422** statt zu transkribieren; die PWA
zeigt rot „Aufnahme nicht lesbar (UNKNOWN: unknown error, write)" — im
Nutzerreport als „unknown, nicht lesbar" angekommen.

Live-Journal des produktiven Hubs (<Unit ancientvoid-hub>, 19.–20.11.2026,
13 POSTs vom Handy): kurze Clips → 200 in 378–3787 ms; längere Clips →
**8× 422** in 1–10 s:

```text
2026-11-19T22:32:07Z req-p7n → 422 1345ms
2026-11-20T07:14:50Z req-28ft → 422 4336ms
2026-11-20T07:16:07Z req-28pz → 422 2579ms
2026-11-20T07:16:42Z req-28ue → 422 1083ms
2026-11-20T07:17:53Z req-296y → 422 3794ms
2026-11-20T07:22:01Z req-2a99 → 422 10356ms
2026-11-20T08:09:32Z req-2h8j → 422 4168ms
2026-11-20T08:10:39Z req-2hh2 → 422 1555ms
```

## Ursache

`toWav()` (`apps/hub/src/modules/voice/stt.routes.ts:40-46`) legt Eingabe und
16-kHz-WAV in `os.tmpdir()` ab — hier ein tmpfs mit `usrquota` und
`nr_inodes=1048576`. Dasselbe /tmp haben Jahre von Vitest-Läufen mit geleakten
`mkdtemp`-Verzeichnissen gefüllt (**live: 43 604 Verzeichnisse >24 h alt,
91 % Inodes, 80 % von 16G**; Top-Flops: `av-p48*` 3518×, `av-automations-test*`
3286×, `ancientvoid-p38-*` 3×2766). Längere Aufnahmen brauchen mehr Quota
beim Schreiben → `EDQUOT`, das sich als `UNKNOWN: unknown error, write`
meldet → `writeFile`/ffmpeg scheitern → 422. Kurze Clips passen in den Rest.
Nicht das Handy, nicht der Telefonspeicher.

## Erwartet

- Vitest-Läufe lassen /tmp nicht über Monate zulaufen: verwaiste
  Test-Temp-Verzeichnisse werden beim Laufstart weggeräumt.
- Die Gegenprobe (5-Minuten-Clip konvertieren) geht nach dem Aufräumen
  wieder durch — ohne Hub-Neustart, da `toWav` pro Request frisch mkdtempt.

## Repro

Am produktiven Rechner (gesehen 2026-11-20):

```text
node -e '…writeFileSync(tmp/av-repro/big.bin, 3MB)…'
→ UNKNOWN: unknown error, write            # EDQUOT am vollen /tmp
```

Und im Journal wie oben: `POST /api/stt` längerer Clip → 422.

Nach `find /tmp -maxdepth 1 -type d ( -name av-\* -o -name ancientvoid-\* ) -mtime +0`:
Inodes 91 %→17 %, und dasselbe Node-Snippet schreibt 3 MB problemlos;
`toWav`-Nachbau (1,6 MB webm → 9,6 MB WAV) läuft in 1,7 s durch.

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal produktiv (systemd-Unit `ancientvoid-hub.service`) |
| Commit | Code-Prüfung `42de8052`; laufender Hub `6ec37473` |
| Node-Version | 26.7.0 |
| Adapter | unabhängig (STT-Konvertierung) |
| Repro-Weg | Journal + Node-/ffmpeg-Snippet |

## Logs

Auszug siehe „Gesehen" (Journal `journalctl --user -u ancientvoid-hub`).
Keine Secrets.

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `scripts/sweep-test-temp.test.mjs` | nicht vorhanden |

Rot ohne Fix: Der Sweeper existiert nicht — geleakte Verzeichnisse bleiben
stehen. Grün mit Fix: älter als 24 h wird entfernt, Jüngeres (laufende
Suiten, Hub-Konvertierung) bleibt unangetastet.

## Eingrenzung

- `apps/hub/src/modules/voice/stt.routes.ts:40-46` — Konvertierung in
  `os.tmpdir()` (tmpfs + usrquota; bis 28 MB WAV für 15 min Diktat).
- 145 Test-Dateien mkdtempten ohne zentrale Abriumphase in dasselbe /tmp
  (Präfixe `av-*`, `ancientvoid-*`); abgebrochene Läufe leaken dauerhaft.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitHub-Issue angelegt (`gh issue create`, URL in `forge:`)
- [x] `bugfix` — /tmp live leergeräumt (Inodes 91 %→17 %, toWav für 5-Minuten-Clip bewiesen), Sweeper `scripts/sweep-test-temp.mjs` im Vitest-Global-Setup, Regressionstest grün
