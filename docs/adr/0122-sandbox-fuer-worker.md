# ADR-0122 — Sandbox für Worker mit Team-Inhalt

**Status:** angenommen (Nutzerentscheid E11/E5b, 24.11.2026); Umsetzung mit T83.8 · **Betrifft:**
EPIC-P83, künftig `packages/contracts/src/harness/` (WorkerSpec), `packages/workers/`,
`packages/core/src/modules/sandbox/`, Adapter-Testkit · **Bezug:** ADR-0014, ADR-0018, ADR-0024,
ADR-0119, ADR-0121

## Kontext

In einer Team-Session wirken Texte und Eingaben anderer Menschen und Agenten. Rückfragen je Werkzeug
sind nicht bei jedem Harness gleich verfügbar. Die Grenze soll deshalb das Betriebssystem ziehen und
für jeden Adapter gleich gelten.

## Entscheidung

1. **Pflicht.** Jede Session mit `teamTaint` läuft in der Sandbox. Fehlt sie oder besteht ihr
   Selbsttest nicht, startet die Session nicht (422 mit Grund). Kein Rückfall ohne Sandbox, kein
   Schalter „trotzdem“. Für andere Sessions ist sie wählbar, Standard unverändert.
2. **Werkzeug:** bubblewrap über `packages/workers`, als Hülle um das Kommando für tmux- und
   Prozess-Runner. Adapter bleiben unverändert und rufen weiter `ctx.spawnWorker`; der Vertrag erhält
   additiv `sandbox: { profile } | null`, gesetzt nur vom Hub. Argumente als argv, nie als Shelltext.
3. **Dateien:** Systemverzeichnisse nur lesbar; beschreibbar sind ein eigener **Klon**, ein eigenes
   Home und `/tmp`. Kein Host-Home, kein Datenordner des Hubs, keine Agent-, D-Bus-, Wayland- oder
   Docker-Sockets. Umgebung leer plus feste Liste.
4. **Kein Worktree.** Ein Worktree verweist in das gemeinsame `.git`; dort schreibbare Hooks oder
   Konfig wären ein Weg nach draußen. Daher Klon ohne Alternates und Hardlinks. Ergebnisse kommen als
   `git bundle` über die Quarantäne aus ADR-0119 §8. Der Hub führt im Klon selbst kein Git aus; Status
   und Diff laufen in der Sandbox und sind Daten.
5. **Netz:** eigener Netzwerk-Namensraum ohne Schnittstelle. Einziger Weg ist ein Unix-Socket zum
   Egress-Proxy des Hubs: nur CONNECT, Port 443, exakte Hostliste je Adapter (Anbieter-API), keine
   privaten, Loopback- oder Overlay-Ziele, Prüfung nach der Namensauflösung, Mengenlimit, Protokoll.
   Paketquellen und Git-Hosts nur mit Freigabe je Session durch einen Menschen.
6. **Hub-Zugang:** ein zweiter Unix-Socket reicht ausschließlich die Werkzeug-Rückfrage und `team.say`
   dieser Session weiter. Kein allgemeiner API-Zugang.
7. **Anmeldung:** eigene, je Adapter getrennte Anmeldung für die Sandbox; die des Host-Homes wird nie
   eingehängt. Restrisiko: diese eine Anmeldung ist für den Agenten lesbar, kann aber nur zu
   freigegebenen Hosts gelangen und ist einzeln widerrufbar.
8. **Härtung:** alle Namensräume getrennt, neue Terminal-Sitzung (`--new-session`), Ende mit dem
   Elternprozess, keine Rechte, seccomp-Filter, Prozess-, Speicher- und Plattenlimit über eine
   systemd-Scope, wo vorhanden. Pflichtfilter und Limits gehören zum Selbsttest.
9. **Werkzeug-Rückfragen** bleiben zusätzlich aktiv, wo der Adapter sie bietet. `toolApprovals: auto`
   gilt innerhalb der Sandbox, nie für Netzfreigaben oder die Übernahme von Ergebnissen.
10. **Plattformen:** Linux in v1. macOS und Windows: Verfolgen geht, Steuern und Ausführen nicht, mit
    sichtbarem Grund. Adapter, deren Arbeit außerhalb des Workers läuft, sind ausgeschlossen; sie
    melden das über eine neue Fähigkeit `sandbox: "worker" | "none"` (Standard `none`).
11. **Adapter-Umfang:** Pi zuerst, danach Claude und Codex; jeder erst nach Testkit-Nachweis.
12. **K7:** Profil und Klonpfad stehen im Session-Record; nach Neustart wird der Worker nur
    übernommen, wenn sein Profil nachweisbar ist, sonst geparkt.

## Verworfen

Container-Dienst (Betriebslast, privilegierter Socket); VM je Session (Start, Speicher);
`@anthropic-ai/sandbox-runtime` als Pflichtabhängigkeit (laut README Beta Research Preview, API kann
sich ändern) – bei Reife und für macOS neu bewerten; nur Werkzeug-Rückfragen (nicht einheitlich).

## Beleg

Probe am 24.11.2026 mit bubblewrap 0.13.1 auf Linux: Host-Home und Testgeheimnis unsichtbar,
Systemordner schreibgeschützt, Internet und Hub-Port nicht erreichbar, nur eigene Prozesse sichtbar,
Unix-Socket nutzbar, Startaufwand 4–5 ms. Nicht geprüft: seccomp, Limits, echte Harnesses, tmux-Hülle,
andere Distributionen. bubblewrap ist laut eigener README keine fertige Richtlinie; Schutz entsteht
allein aus den Argumenten, daher der Selbsttest.

Quellen: <https://github.com/containers/bubblewrap>, <https://github.com/anthropics/sandbox-runtime>,
<https://git-scm.com/docs/git-upload-pack> (Abruf 24.11.2026).
