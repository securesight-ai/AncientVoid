# Host-Monitoring einrichten (EPIC-P81)

**Art:** how-to

Jeder Hub misst seinen eigenen Rechner, ohne Konfiguration. Der Home-Hub führt die
gekoppelten Hubs ([fleet.md](fleet.md)) und Hosts ohne Hub zusammen. Entscheidungen und
Grenzen: [ADR-0117](adr/0117-host-metriken-vertrag-und-verlauf.md). Aufbau der Anzeige nach
[powermeter](https://github.com/KaiFelixBennett/powermeter) (MIT, © 2026 Kai Felix Bennett).

## Was ohne weiteres Zutun da ist

CPU, Speicher, Last, Platten, Netz, alle Sensoren unter `/sys/class/hwmon`, AMD- und
NVIDIA-GPU. Auf AMD-APUs ist auch die Leistung des CPU-Pakets ohne root lesbar.

## Mehr Sensoren freischalten

Alle Schritte nimmt `sudo scripts/host-monitoring-setup.sh undo` zurück.

| Ziel | Befehl |
|---|---|
| Temperatur von SATA-Platten | `sudo scripts/host-monitoring-setup.sh modules drivetemp` |
| Lüfter und Spannungen des Mainboards (meist Nuvoton) | `sudo scripts/host-monitoring-setup.sh modules nct6775` |
| CPU-Watt ohne APU (RAPL) | `sudo scripts/host-monitoring-setup.sh rapl <benutzer>`, danach neu anmelden |

Mehrere Module gehören in **einen** Aufruf (`modules drivetemp nct6775`); der letzte Aufruf
gilt. Passt ein Modul nicht zum Board, wird es ausgelassen.

Das RAPL-Recht gilt für alle Prozesse dieses Benutzers, also auch für Agenten
(PLATYPUS-Seitenkanal, ADR-0117 §8). Ohne das Recht steht „keine Berechtigung“ da.

## Host ohne Hub (NAS)

1. Eigener Schlüssel auf dem Home-Hub:
   `ssh-keygen -t ed25519 -N "" -C ancientvoid-hostmetrics -f ~/.ssh/ancientvoid_hostmetrics`
2. Skript auf das NAS legen:
   `ssh <nas> 'cat > ~/ancientvoid-probe.sh' < scripts/host-monitoring-probe.sh`
3. Schlüssel dort auf genau dieses Skript beschränken (eine Zeile in `~/.ssh/authorized_keys`):
   `restrict,command="/bin/sh ~/ancientvoid-probe.sh" ssh-ed25519 …`
4. Prüfen: `ssh -i ~/.ssh/ancientvoid_hostmetrics -o IdentitiesOnly=yes -o IdentityAgent=none <nas> | head -1` zeigt `@@ proc/stat`.
5. In `hub.config.json`, danach Hub neu starten:

```json
"hostMetrics": { "sshHosts": [{ "id": "nas", "label": "NAS", "target": "<benutzer>@<adresse>", "identityFile": "~/.ssh/ancientvoid_hostmetrics" }] }
```

## Verlauf

`hostmetrics.db` im Datenverzeichnis: Minuten 7 Tage, Viertelstunden 90 Tage, Tages-kWh
dauerhaft. Gemessen 45 Byte je Zeile, rund 57 MB je Host bei 70 Reihen. Eine defekte Datei
wird als `hostmetrics.db.defekt-…` beiseitegelegt und im Log gemeldet.
Abschalten: `"hostMetrics": { "enabled": false }`.
