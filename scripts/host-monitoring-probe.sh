#!/bin/sh
# EPIC-P81 (ADR-0117 §7): rein lesender Abzug für Hosts ohne Hub, z. B. ein NAS.
# Läuft dort hinter command= in authorized_keys; nimmt keine Eingaben an.
for f in /proc/stat /proc/loadavg /proc/uptime /proc/meminfo /proc/pressure/* /proc/mounts /proc/diskstats /proc/net/dev \
  /sys/class/thermal/thermal_zone*/type /sys/class/thermal/thermal_zone*/temp \
  /run/synostorage/disks/*/temperature /run/synostorage/disks/*/smart /run/synostorage/disks/*/remain_life; do
  [ -r "$f" ] && { echo "@@ ${f#/}"; cat "$f"; echo; }
done
for d in /sys/block/*; do echo "@@ ${d#/}/present"; echo 1; done
for n in /sys/class/net/*; do [ -e "$n/device" ] && { echo "@@ ${n#/}/device"; readlink -f "$n/device"; }; done
echo "@@ df"
df -Pk
