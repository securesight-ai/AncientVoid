#!/usr/bin/env bash
# EPIC-P81 T81.5: Sensoren und RAPL-Leserecht für die Host-Metriken freischalten.
#
#   sudo scripts/host-monitoring-setup.sh modules <modul>…   Sensor-Treiber laden, auch nach Neustart
#   sudo scripts/host-monitoring-setup.sh rapl <benutzer>    CPU-Watt für die Gruppe hostmetrics
#   sudo scripts/host-monitoring-setup.sh undo               alles zurücknehmen
#
# Nur `rapl` ändert Rechte; Restrisiko (PLATYPUS) steht in ADR-0117 §8.
set -euo pipefail
modules_conf=/etc/modules-load.d/ancientvoid-sensors.conf
rule=/etc/udev/rules.d/70-ancientvoid-rapl.rules
[ "$(id -u)" = 0 ] || { echo "bitte mit sudo starten" >&2; exit 1; }

case "${1:-}" in
  modules)
    shift
    [ $# -gt 0 ] || { echo "welche Module? z. B. drivetemp nct6775" >&2; exit 1; }
    for m in "$@"; do
      case "$m" in drivetemp | nct6775 | nct6683 | it87) ;; *) echo "unbekanntes Sensor-Modul: $m" >&2; exit 1 ;; esac
    done
    loaded=()
    for m in "$@"; do
      if modprobe "$m"; then loaded+=("$m"); else echo "$m: passt nicht zu diesem Board, wird ausgelassen" >&2; fi
    done
    [ ${#loaded[@]} -eq 0 ] || printf '%s\n' "${loaded[@]}" > "$modules_conf"
    echo "geladen: ${loaded[*]:-keine}"
    ;;
  rapl)
    user="${2:?Benutzer des Hubs, z. B. $SUDO_USER}"
    id "$user" > /dev/null
    groupadd --system --force hostmetrics
    usermod -aG hostmetrics "$user"
    # Nur Pakete (intel-rapl:N), keine Unterdomänen.
    cat > "$rule" <<'RULE'
ACTION=="add|change", SUBSYSTEM=="powercap", KERNEL=="intel-rapl:[0-9]", RUN+="/bin/chgrp hostmetrics /sys%p/energy_uj", RUN+="/bin/chmod 0440 /sys%p/energy_uj"
RULE
    udevadm control --reload
    udevadm trigger --action=change --subsystem-match=powercap
    udevadm settle
    ls -l /sys/class/powercap/intel-rapl:[0-9]/energy_uj
    echo "$user muss sich einmal neu anmelden (am einfachsten: Neustart), damit die Gruppe gilt."
    ;;
  undo)
    rm -f "$modules_conf" "$rule"
    udevadm control --reload
    for f in /sys/class/powercap/intel-rapl:[0-9]/energy_uj; do
      [ -e "$f" ] && chgrp root "$f" && chmod 0400 "$f"
    done
    ! getent group hostmetrics > /dev/null || groupdel hostmetrics
    echo "zurückgenommen; geladene Module verschwinden beim nächsten Neustart"
    ;;
  *)
    sed -n '2,8p' "$0"
    exit 1
    ;;
esac
