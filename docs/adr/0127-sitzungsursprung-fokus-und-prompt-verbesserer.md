# ADR-0127 — Sitzungsursprung, Fokus und Prompt-Verbesserer

- Status: angenommen für [P90](../../epics/EPIC-P90-namen-scroll-prompt-enhancer.md)
- Messlatten: K5, K7

## Sitzungsnamen

Der optionale Sitzungsvertrag ergänzt `originIntent`, `focus` und
`handoverFrom`. Der Ursprung ist eine auf 240 Zeichen begrenzte Fassung des
Startauftrags. Eine Sitzung ohne Initialauftrag bekommt ihn aus dem ersten
Textauftrag. Vorhandene Datensätze bleiben lesbar. Wo Altdaten keinen Ursprung
belegen, bleibt das Feld leer. Die SQLite-Projektion übernimmt den ersten
gespeicherten Wert. Das Journal enthält Startauftrag und Namensänderungen.

Der Fokus ergänzt das bisherige Titelfeld und übersteuert es in Übersicht und
Detail. Eine manuelle Umbenennung setzt den Fokus. Eine ausdrückliche
Modellanfrage nutzt den letzten Dialog und prüft beim Speichern, ob die
Person inzwischen selbst umbenannt hat. Eine angenommene Übergabe übernimmt
Ursprung und bisherigen Titel der Quelle. Eine neu formulierte erste Zeile
mit geringer Wortübereinstimmung setzt den Fokus im Ziel. Der Übergabelink
in den Metadaten macht das Badge unabhängig vom Titel.

## Prompt-Verbesserer

Der SettingsStore hält Engine und Scan-Schalter. Automatik verwendet die
P68-Kette. Eine gepinnte Adapter-Engine hat Vorrang und meldet einen
Ausfall in der Vorschau. Pi unterstützt eine Modell-ID aus dem eigenen
Modellkatalog. Der Pi-Aufruf ist flüchtig und schaltet Werkzeuge,
Extensions, MCP und native Kontextdateien ab. Der bestehende
Kontextblock und optional ein zweiter Datenblock liefern Informationen
aus dem Projekt. Der Scan hat ein eigenes Budget von 4.000 Zeichen und
bleibt bis zum Nutzennachweis standardmäßig ausgeschaltet.
