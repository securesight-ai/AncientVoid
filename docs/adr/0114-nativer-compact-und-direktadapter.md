# ADR-0114 · Native Compaction und kompakter Kontext für Direktadapter

- Status: angenommen
- Datum: 2026-11-23
- Bezug: [EPIC-P55](../../epics/EPIC-P55-plugin-toggles-token-ersparnis.md), K5, K7

## Entscheidung

Der Hub führt `/compact` als reservierten Adapterbefehl. Er prüft den
deklarierten Geltungsbereich, stellt den Befehl bei laufenden Zügen zurück
und reicht ihn ohne Skill-Präfix weiter. Die vorhandene Freigabe für
Schreiboperationen gilt weiter.

Codex App Server nutzt `thread/compact/start`. Die Rückgabe bestätigt die
Annahme. Start, Abschluss und Fehler kommen über die Thread-/Turn-Events.
Bei unbekanntem Ergebnis wartet der Adapter auf das Ende des Zugs oder
einen Neustart des Providers. Codex Exec behält seine eigene Capability-Liste.
Pi nutzt einen einmaligen Worker im RPC-Modus. Der Worker prüft die exakte
Session-Datei über `get_state`, bevor er `compact` aufruft. Eine erfolgreiche
Antwort gilt für diese Datei, die der nächste Prompt gezielt öffnet.
Der OpenCode-ACP-Adapter übernimmt die in BUG-0192 belegten Start- und
Abschlussereignisse in den Session-Verlauf.

Unter **Einstellungen → Dienste → AncientVoid-Compaction** lässt sich
die automatische lokale Kürzung ein- und ausschalten. `GET/PUT
/api/settings/compaction` verwendet die bestehende `settings.manage`-Policy
und speichert den booleschen Wert in SQLite. Der Default ist aus.
`AdapterContext.automaticCompaction` ist ein optionaler Live-Wert für
Adapter, die ihre Requests selbst aufbauen. Native Provider-Compaction
läuft mit ihren eigenen Einstellungen.

Der OpenAI-kompatible Direktadapter kürzt ausschließlich alte, exakt
identische Assistentenantworten ab 512 Zeichen. Jede Gruppe behält eine
wortgetreue Referenz. Benutzertexte und die letzten sechs Nachrichten
bleiben vollständig im Payload. Der Adapter berechnet die Projektion beim
Absenden und protokolliert die eingesparten serialisierten Bytes. Ein lokales
`/compact` gilt für die nächste Antwort der laufenden Direktadapter-Session
und benötigt keinen Modellaufruf. Beim Abschalten gehen weitere reguläre
Requests wieder mit dem vollständigen Verlauf raus. Die Lebensdauer der
Direktadapter-Historie entspricht der Lebensdauer des Handles.

## Nachweis

Der deterministische Vergleich verwendet identische Anfragen mit aktivierter
und deaktivierter Projektion. Im Testfall sinken die JSON-Nachrichten von
8.634 auf 6.652 Bytes (−23 %). Der `o200k_base`-Tokenizer zählt 2.058
bzw. 1.562 Inhaltstokens (−24 %, ohne Nachrichtenrahmen). Der Test prüft Referenztext, benachbarte Nutzertexte,
jüngste Nachrichten und die Rückkehr zum vollständigen Payload. Reale
Token- und Cache-Kosten hängen vom Provider und der Anfrage ab. Eine
Qualitätsmessung mit Modellen erfordert einen separaten Live-Vergleich.

Pi 1.6.0 hat mit einer synthetischen Session und einem lokalen
Testendpunkt einen Compaction-Eintrag in genau dieser JSONL-Datei
persistiert. Der Codex-Browser-Test verwendet die App-Server-Attrappe
und prüft auch den nächsten normalen Prompt.

Claude, ACP-Copilot und ACP-OMP behalten ihre nativen Befehle. Weitere
Transportvarianten brauchen einen Nachweis im vom Hub getriebenen Modus.
Das betrifft insbesondere Codex Exec, OpenCode und Copilot im CLI-Modus,
Cursor im Print-Modus, Hermes im Query-Modus und Maki über ACP.
Beobachtende Clips und der Aider-Einzelzug besitzen im Hub keinen
steuerbaren Folgekontext. Die [Harness-Matrix](../harness-matrix.md)
dokumentiert die angebotenen Session-Fähigkeiten.
