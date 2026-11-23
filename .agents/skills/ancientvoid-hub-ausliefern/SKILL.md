---
name: ancientvoid-hub-ausliefern
description: Ausliefern von AncientVoid-Änderungen auf Kais Hub (systemd-User-Service ancientvoid-hub.service) — main zuerst ziehen, PWA bauen, Neustart nur ohne laufenden Zug (Wächter-Muster), danach deployment-Identität und eine Feature-Route prüfen. Nutzen bei „Hub aktualisieren“, „ist das live?“, wenn eine Route 404 liefert, die in main existiert, oder wenn ein laufender Prozess hinter main zurückfällt.
---

# AncientVoid-Hub ausliefern und nachweisen

## Ablauf (in dieser Reihenfolge)

```bash
cd /home/kaib/repos/AncientVoid
git checkout main && git pull --ff-only      # NICHT aus einem alten Zweig neu starten
npm -w @ancientvoid/pwa run build            # PWA muss zum Zweig passen (pwaSha!)
grep -oE "assets/index-[A-Za-z0-9_-]+\.js" apps/pwa/dist/index.html   # Merker für die Auslieferung
systemctl --user restart ancientvoid-hub.service
sleep 3
curl -s -o /dev/null -w "health=%{http_code}\n" http://127.0.0.1:7373/api/health
curl -s http://127.0.0.1:7373/api/health | python3 -c "import json,sys; d=json.load(sys.stdin)['deployment']; print(d['runtimeSha'][:8], d['checkoutSha'][:8], d['pwaSha'][:8], d['runtimeDirty'])"
```

Drei Shas müssen gleich sein (`runtimeSha == checkoutSha == pwaSha`) und
`runtimeDirty` false. Nur eine gleiche Zahl ist kein Nachweis: `checkoutSha`
allein beschreibt den Arbeitsbaum, nicht den Prozess.

## Nach jedem Merge: Prozess kann hinter main stehen

Gemessen 23.11.2026: `GET /api/inference/gate` lieferte **404**, obwohl die Route
in main existierte (`apps/hub/src/modules/inference/inference.routes.ts`) — der
laufende Prozess stammte von `83d57105`, der Pforte-Merge `5e71d1e0` war **jünger**.
Die Bug-Akte beskrieb die Pforte als „live“, wirksam war sie nicht. Also:

- Nach jedem Merge an main: neu starten **und** eine Route der neuen Funktion
  abfragen (404 = der Prozess ist zu alt, nicht die Route fehlt).
- `git merge-base --is-ancestor <feature-commit> <runtimeSha>` zeigt in 2 Sekunden,
  ob der laufende Stand die Funktion überhaupt hat.

## Neustart nur, wenn kein Zug läuft

Der Hub spawnen den Adapterprozess pro Zug als Kindprozess. Ein Neustart mitten im
Zug tötet die laufende Antwort — auch die eigene Sitzung, wenn man selbst aus einer
Hub-Sitzung heraus arbeitet. Wächter-Muster (detacht, damit er den eigenen Tod überlebt):

```bash
HUB=$(systemctl --user show ancientvoid-hub.service -p MainPID --value)
leer=0
while :; do
  [ "$(pgrep -P "$HUB" | wc -l)" -eq 0 ] && leer=$((leer+1)) || leer=0
  [ "$leer" -ge 6 ] && break        # 30 s ohne Kindprozess = kein Zug
  sleep 5
done
systemctl --user restart ancientvoid-hub.service
```

Mit `setsid nohup <skript> >/dev/null 2>&1 &` starten, Protokoll mit
`health`, den drei Shas und einer Feature-Route nach `/tmp/hub-neustart-watch.log`
schreiben — sonst ist nach dem Neustart unklar, wer was warum getan hat.

## Was hier verboten ist

- `pkill node` / `killall node`: der Pi-Prozess läuft auf Node — man schießt sich selbst ab.
  Nur `systemctl --user restart ancientvoid-hub.service`, oder die PID aus
  `ss -ltnp 'sport = :7373'` gezielt beenden.
- Neustart aus einem feature-Zweig oder mit schmutzigem Arbeitsbaum: danach ist
  `runtimeDirty` true und die Auslieferung nicht belegbar. Erst PR mergen, dann main.
- PWA nicht gebaut lassen: der Hub liefert `apps/pwa/dist` aus, der Browser merkt
  sich die Bundle-Datei — ohne Neubau bleibt die alte Oberfläche trotz Neustart.
