---
name: ancientvoid-hub-suche
description: Diagnose why AncientVoid hub search "finds nothing" for a term the user knows exists (session texts, tool names, repo docs). Covers the four real causes — hub-local corpus, role chips, term separators, project-bound docs — with the exact API probes and the index/DB queries that prove each one. Use for "warum finde ich X nicht", missing search hits, or search result counts that look wrong.
---

# Suche im AncientVoid-Hub: warum findet sie nichts?

Die Suche ist **hub-lokal**: Fundus sind die `events.jsonl` + Blobs im `dataDir`
dieses Hubs und das Markdown der Projekte unter `projectRoots`. Ein anderer Hub
(z. B. der verbündete Rechner) ist **nicht** durchsuchbar. Erster Verdacht bei
"das haben wir doch hier besprochen": lag diese Sitzung auf einem anderen Host?

## Reihenfolge der Prüfung (billig → teuer)

1. **Indexzustand** (lebt der Index, wie viele Zeilen, welche engine):

   ```bash
   TOK=$(node apps/hubctl/src/cli.ts token issue "scratch-suche" --db data/hub.db | tail -1 | tr -d ' ')
   curl -s -H "authorization: Bearer $TOK" --get --data-urlencode "q=BEGRIFF" \
     --data "scope=sessions&limit=3&roles=user,assistant,thinking,tool,system" \
     "http://127.0.0.1:7373/api/search/all" | python3 -m json.tool | head -30
   ```

   `index.lines` = 0 → Index nicht gebaut (Hub-Log: `search: Sessiontext-Index N
   Zeilen (fts5)`). `engine: "scan"` → FTS5 fehlt im `node:sqlite`-Build.

2. **Rollen-Chips.** Standardrollen sind **Frage + Antwort**. Bei
   Tool-/Denk-Spuren (Pfade, Befehle, Log-Auszüge) ist die Ergebnisliste leer,
   obwohl der Begriff oft tausendfach im Index steht. Beweis: Facetten ansehen
   (`facets` in der Antwort) oder dieselbe Suche mit `roles=...,tool,thinking`.
   Die UI zeigt dafür den Hinweis „N Fundstellen liegen in Denken, Werkzeug“ +
   Einschalt-Knopf.

3. **Trenner im Begriff.** FTS5 zerlegt `tokdeck.env.key`,
   `repos/tokdeck/README.md`, `EPIC-P75` in mehrere Tokens. Sucht man das als
   *ein* Wort, findet man nichts. Seit PR #302 zerlegt `buildFtsQuery`
   (`packages/core/src/modules/search/session-text-index.ts`) jeden Begriff an
   denselben Trennern zu einer Präfix-Phrase. Direkt am Index prüfen:

   ```bash
   node -e "const{DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('data/hub.db');
   for(const m of ['\"tokdeck env key\"*','\"tokdeck\"*']) console.log(m, db.prepare('SELECT count(*) c FROM transcript_fts WHERE transcript_fts MATCH ?').get(m).c)"
   ```

4. **Doku ist projektgebunden.** `scope=docs` braucht `project=`; ohne das Kreuz
   „Doku in allen Projekten“ (Parameter `allProjects=1`) ist nur das Projekt der
   laufenden Sitzung im Suchraum — das Repo des gesuchten Tools also nicht.
   Antwortfelder `docProjects` / `docTruncated` sagen, was tatsächlich scannte
   (Grenze: 12 Projekte, 2,5 s).

5. **Vertippung.** „tokdek“ findet „tokdeck“ weder als Präfix noch als Teilwort.
   Seit der vierten Stufe läuft dann die Wortliste des Index (`transcript_vocab`,
   `fts5vocab`) als Kandidatenquelle: Edit-Distanz 1 (ab 8 Zeichen 2) oder
   Teilfolge. Prüfen: `mode` in der Antwort ist `typo`, `corrected` listet das
   gesuchte Wort. Begriffe unter 5 Zeichen werden bewusst nicht geraten.

6. **Widerhall.** Der vertippte Begriff trifft genau die eigene Frage — die
   Liste ist „richtig“ und leer an Nutzen. Dagegen zählt die Vorschlagsstufe
   Fundstellen ähnlicher Indexwörter und liefert `suggest: [{term, count}]`
   (nur wenn `count > total`); die PWA zeigt den Chip „meintest du …?“.

7. **Anderer Rechner = anderer Fundus.** Seit PR #307 gibt es den Kreuz
   „andere Rechner einbeziehen" (`hubs=1`): der Hub fragt seine Fleet-Peers über
   `/api/search` und meldet pro Rechner `ok / offline / denied / unsupported /
   skipped`. Ohne diesen Kreuz bleibt die Antwort lokal — die Frage nach einem
   Tool, das auf dem anderen Rechner gebaut wurde, läuft dann ins Leere. Prüfen:
   `peers` und `hubs` in der Antwort; `sessionTotal` steigt nur mit `hubs=1`.

## Direct proof am Bestand (wenn API und Index sich widersprechen)

```bash
node -e "const{DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('data/hub.db');
console.log(db.prepare('SELECT role, count(*) c FROM transcript_lines GROUP BY role').all());
console.log(db.prepare(\"SELECT role, count(*) c FROM transcript_lines WHERE text LIKE ? GROUP BY role\").all('%tokdeck%'))"
```

`transcript_lines` hat eine Zeile pro Event-Text (`role` user/assistant/thinking/
tool/system). Sitzung ohne Zeile = ihre JSONL liegt nicht in diesem `dataDir`.

## Fallen, die hier schon Zeit gekostet haben

- **Leere Ergebnisliste ≠ leerer Hub.** Ohne Facetten in der leeren Antwort liest
  sich das wie „nichts vorhanden“ (vor PR #302 so geschehen).
- **`token issue` schreibt in `data/hub.db`.** Nach der Diagnose immer
  `hubctl token revoke <label> --db data/hub.db`, sonst häufen sich Gerätetoken.
- **Scratch-Hub mit kopiertem `data/`:** die kopierte
  `.ancientvoid-hub.pid` im Datenordner blockiert den Start („Ein Hub läuft
  bereits“) — Löschdatei entfernen, und die Konfiguration braucht `server.host` /
  `server.port`, sonst landet der Scratch-Hub auf Port 7373 (`EADDRINUSE`).
- **Der Nyx-Schwebeknopf** liegt auf Handybreite über den Fundkarten
  (`display:none` auf der Suchseite, `12-search.css`) — UI-Prüfungen auf der
  Suchseite immer bei ~430 px Breite machen.
