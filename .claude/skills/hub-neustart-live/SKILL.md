---
name: hub-neustart-live
description: Den laufenden AncientVoid-Hub gefahrlos heben und Auslieferung belegen: Wachhund mit Rückfall-Stand, version.json gegen HEAD, K7-Rekonstruktion aus JSONL, PWA-Cache beim Blick, Token widerrufen. Bei „neuen Stand live nehmen“ oder Hub-Neustart.
---

# Live-Hub heben, ohne den Handy-Zugang zu verlieren

Der Hub hält den Handy-Zugang auf den Agenten. Ein Neustart, der nicht hochkommt,
schnittte die eigene Arbeitsverbindung ab. Deshalb: nie `systemctl --user restart`
ohne Rückfallpfad, und „gemerged“ ist kein Auslieferungsnachweis.

## 1. Vor dem Neustart: Zustand festhalten

- `systemctl --user is-active ancientvoid-hub.service` und
  `curl -s http://127.0.0.1:7373/version.json` — der **aktuelle** Stand ist der
  Rückfall-Stand. Diese SHA in den Wachhund schreiben.
- `PROGRESS.md` aktualisieren, bevor irgendetwas Riskantes läuft: bricht die eigene
  Session ab, muss der nächste Schritt daraus hervorgehen (Wiederaufnahme-Abschnitte).

## 2. Wachhund statt Neustart

Ein detached gestartetes Skript (`setsid nohup … &`), das
`systemctl --user restart ancientvoid-hub.service` ausführt und danach zählt:

1. `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:7373/api/health` — 200
   innerhalb weniger Sekunden (der Dienst hat `Restart=always`).
2. ausgelieferte `version.json`: `sha` **muss** der eigenen HEAD entsprechen und
   `dirty:false` sein. Weicht sie ab, wurde nicht ausgeliefert, egal was `git log` sagt.
3. Bleibt die Health aus: zurück auf den gespeicherten Rückfall-Stand schalten, aber
   **nicht** auf einen gelöschten Zweig — nach einem Merge heißt Wiederherstellung
   `git checkout main`.

## 3. Auslieferung belegen, nicht vermuten

- Health 200 + `version.json` == HEAD + routes antworten (authentifizierungslose
  Wege liefern 401, das ist richtig so, kein Fehler).
- `journalctl --user -u ancientvoid-hub.service --since '-4 min'` nach den Start-
  zeilen des neuen Moduls absuchen (z. B. `inference: 1 Engine-Quellen (…)`,
  `… Requests rekonstruiert`) — die JSONL-Rekonstruktion ist der K7-Nachweis.
- Datenstrom lebend beweisen: Zähler-Datei zweimal lesen (`wc -l` im Abstand von
  Sekunden) und das Wachstum zeigen.

## 4. PWA-Blick: der Browser sieht oft den alten Stand

Der Service-Worker hält das vorige Bundle. Ein Screenshot des alten Bundles ist kein
Beweis für die neue Version. Vor der Prüfung:

```js
for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
for (const k of await caches.keys()) await caches.delete(k);
```

dann neu laden und **Maschinenwerte** lesen (Kacheltexte, Feldwerte, Breiten), nicht
nur staunen. Token in `localStorage` wirkt erst nach Reload — erst setzen, dann laden.

## 5. Zugang hygiene

Review-Token mit `apps/hubctl` ausstellen, nach der Prüfung **widerrufen**, Datei
mit `shred -u` entfernen, und ohne Token erneut 401 verlangen. Browser danach
schließen (`close --all`): der Browser belegt GPU-Speicher, der dem Modell fehlt.
