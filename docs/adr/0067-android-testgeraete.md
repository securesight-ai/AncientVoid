# ADR-0067: Android-Testgeräte — AV-eigene Emulatoren mit Lease, Geometrie-Bindung und Standbild-Pfad

**Status:** angenommen · **Datum:** 2026-11-11 · **Epic:** [EPIC-P42](../../epics/EPIC-P42-android-testgeraete.md) · **Vorbild:** [ADR-0059 Browser-Arbeitsplatz](0059-browser-arbeitsplatz.md)

## Kontext

EPIC-P42 verlangt eine Android-Testumgebung, die in der PWA sichtbar ausgewählt, bedient und für reproduzierbare
App-/PWA-Tests genutzt werden kann — klar getrennt von der Viewport-Emulation aus P39 und von den realen
Handy-Abnahmen aus P12/P16. Der Host (Omarchy-Rechner) hat KVM (`/dev/kvm`, 16 Kerne); SDK und JDK liegen unter
`/mnt/data/toolchain/android-sdk` bzw. `…/jdk` (große Festplatte). Der Spike (T42.1, 2026-11-11) mit dem
AV-eigenen AVD `av-test` (Pixel-6-Profil, Android 15/API 35, google_apis/x86_64, RAM 2048 MB, AVD-Home
`/mnt/data/toolchain/av-avd`) ergab:

| Messung | Wert |
|---|---|
| Kaltboot bis `sys.boot_completed` | **45,4 s** (frühere Läufe: 26 s) |
| `screencap -p`-Roundtrip (1080×2400) | **1,1 s**, ~92 KB PNG |
| Tap-Roundtrip (`input tap`) | 0,26 s |
| `uiautomator dump /dev/tty` | 4,2 s, ~12 KB XML |
| `am start -a VIEW -d <url>` | 0,08 s |
| Emulator-RSS (Host) | **~3,9 GB** (Guest-RAM + SwiftShader) |
| Browser im Image | `com.android.chrome` vorhanden |

## Entscheidung

1. **Struktur wie der Browser-Arbeitsplatz:** Verträge `contracts/src/devices/devices.ts`, Dienst
   `core/modules/devices/device-service.ts`, Routen `apps/hub/src/modules/devices/device.routes.ts`,
   PWA `apps/pwa/src/features/devices/`. Alles Schreibende ist Menschen-Eingabe (Agent-Tokens → 403).
2. **Keine freie `adb shell`-Route.** Jede Operation ist eine feste argv-Vorlage (`adb.ts`) mit vorab
   validierten Insertions. Text/URLs werden auf eine ungefährliche ASCII-Zeichenmenge geprüft (Leerzeichen →
   `%s`; `%`, `$`, `;`, `&`, `|` u. a. werden abgewiesen, fail loud) — adb joins argv nämlich wieder zu einem
   Shell-String auf dem Gerät.
3. **Minimaler Frame-Pfad: PNG-Standbild** über `adb exec-out screencap -p`, vom PWA-Poll (700 ms) geholt,
   serverseitig rate-limitiert (400 ms). Kein scrcpy/H.264 (großer Abhängigkeitsbaum, Codec-Matrix) —
   messbar ausreichend: 1,1 s pro Frame, Geometrie (1080×2400) kommt aus dem PNG-IHDR selbst. MJPEG/H.264
   bleibt ein möglicher späterer Auftrag, sobald K1 unter Last das Limit reißt.
4. **Eigentum:** Emulator-Prozesse werden `detached` mit Umgebungsmarker `ANCIENTVOID_DEVICE_OWNER=<instanceId>`
   gestartet (Muster `WORKSPACE_OWNERSHIP_ENV`/ServiceSupervisor). Adoption nach Hub-Neustart nur mit Marker im
   `/proc/<pid>/environ`; Stop nur für nachweisbar eigene Prozesse (SIGTERM → 20 s Frist → SIGKILL). Physische
   Geräte und fremde Emulatoren werden angezeigt, aber nie gesteuert oder beendet (403).
5. **Eine Steuerungslease je Gerät** mit monotoner Generation (Journal). Konflikt → verweigert, nie übernommen.
   Lease endet nach 45 s ohne Lebenszeichen (Frame-/Status-Poll) — „Stream-Disconnect stoppt Eingaben“.
   Nach Hub-Neustart wird keine Lease wiederhergestellt: Eingaben werden nie wiederholt (K7), alte
   Generationen sind dauerhaft ungültig.
6. **Eingaben sind an Geometrie-Version gebunden:** Rotation/Neustart erhöhen `geometryVersion`; ein Tap mit
   alter Version wird 409 verweigert statt falsche Punkte zu treffen. Die Koordinaten-Abbildung in der PWA nutzt
   die natürliche Bildgröße des angezeigten PNG — rotierte Bilder werden über ihre echten Maße getroffen.
7. **K7:** Zustand faltet aus `data/devices/devices.jsonl` + `tests.jsonl` (kleine Records, kein Bild/Log-Blob).
   Ein `running`-Testlauf ohne lebenden Prozess wird `unknown` mit Hinweis „nichts wird wiederholt“.
   **K5:** Frames/Logs/Bäume/Artefakte sind Byte-Antworten mit harten Grenzen (Frame ≤ 2 MB, Logcat ≤ 128 KB,
   Baum ≤ 512 KB, maskiert) und landen nie im Eventstrom.
8. **Reproduzierbare Tests (T42.4):** `DeviceTestRun` hält AVD, API-Level, Build-Fingerprint, Auflösung und
   Orientierung am Lauf fest; registrierte Schritte (openUrl/tap/swipe/text/key/rotate/expectText/wait), kein
   freier Code. `expectText` prüft den Accessibility-Baum (uiautomator) — die Seiten-Wirklichkeit, nicht ein
   Pixelvergleich. APK-Installation nur aus Anhang-Artefakt (sha256-adressiert, vor Installation erneut gehasht).
9. **Ressourcen (K8):** standardmäßig maximal 1 AV-eigener Emulator gleichzeitig (`devices.maxEmulators` ≤ 2),
   Emulator mit `-no-snapshot` (reproduzierbarer Startzustand), `-gpu swiftshader_indirect`, Boot-Frist 180 s,
   RSS-Spike ~4 GB ist dokumentiert; Hub bleibt davon unberührt (Dienst ist optional, Prozesse getrennt).
10. **SDK-Installation (T42.1):** SDK/JDK/System-Image wohnen auf der großen Platte unter
    `/mnt/data/toolchain/` (Download nur auf ausdrücklichen Installationsauftrag, EPIC-P42 §2 Out für
    ungefragte Downloads). Der Hub erhält die Pfade per Config `devices.sdkRoot`/`devices.avdHome` (env-Fallback
    `ANDROID_SDK_ROOT`), AVD-Home ist AV-eigen (`av-avd`), Allowlist `devices.avdAllowlist` optional.

### Nachtrag 2026-11-24: In-App-Setup — der komplette Setup-Ablauf in der PWA

Der manuelle Installationsauftrag aus T42.1 wird durch einen geführten Ablauf in der PWA ersetzt
(Nutzerauftrag „Simulator-Setup ohne externe/manuelle Zwischenschritte“):

- **Phasen fest und sichtbar:** `jdk` (Temurin 21, angepinnt über Adoptium-API — nur wenn kein
  System-Java), `tools` (cmdline-tools, angepinnte Google-Zip), `licenses`, `packages`
  (`platform-tools`, `emulator`, `system-images;android-35;google_apis;x86_64`). Download-Quellen
  und Paketliste sind per Config `devices.setup.{jdkUrl,toolsUrl,packages}` übersteuerbar
  (Spiegel/Offline, `file://` unterstützt); Standard sind die angepinnten URLs — Downloads laufen
  ausschließlich auf ausdrücklichen Klick im Geräte-Panel (Menschen-only wie alles Schreibende).
- **K7:** Setup-Zustand faltet aus `data/devices/setup.jsonl`; ein `running` ohne lebenden Lauf wird
  nach Hub-Neustart `failed` (nie automatisch fortgesetzt). Die SDK-Wurzel des letzten erfolgreichen
  Setups gilt nach Neustart als Fallback hinter Config/env. **K5:** Status ist eine kleine
  Byte-Antwort mit gekapptem, maskiertem Log-Schwanz — nie ein Event.
- **AVD-Anlage in der PWA:** `avdmanager create avd` über feste argv-Vorlage (Name, installiertes
  System-Image, Geräteprofil; `no` auf die Hardware-Profil-Rückfrage über stdin). Installierte
  Images listet der Hub aus `<sdkRoot>/system-images`.
- **Verträge/Routen:** `DeviceSetupStatus`, `DeviceAvdCreateInput`, `DeviceImageList` in
  `contracts/src/devices/devices.ts`; Routen `GET/POST /api/devices/setup`, `GET /api/devices/images`,
  `POST /api/devices/avds` (alle schreibenden Menschen-only, Agent-Token 403).
- **E2E:** `e2e/specs/device-setup.spec.ts` fährt den ganzen Ablauf gegen Spiegel-Archive mit
  Fake-CLIs (kein Cloud-Egress); die echte AVD-Abnahme bleibt wie bisher env-ge-gated.

### Orca-Übernahme (Planungsgrundlage 2026-11-08)

Nach Review von [stablyai/orca](https://github.com/stablyai/orca) @ `bdeb388d75120b6e36dd619291286de0cc9aae02`
(MIT): Der `adb devices`-Parser (`src/main/emulator/android/adb-devices.ts`) ist als **Port** übernommen —
Zweitoken-Fall „no permissions“, `wm size` Override-vor-Physical. AV-Änderungen: unbekannte Zustände bleiben
als `unknown` + `rawState` sichtbar statt still, `transport_id` wird gelesen, `no-device` ergänzt; argv-Helfer
sind AV-eigen. `android-input-mapping.ts` (Koordinaten) wurde **nicht** übernommen (AV bindet Koordinaten an
PNG-Geometrie statt Emulator-Teleport-API); `emulator-backend.ts` (freie exec-Methode) bewusst nicht;
`scrcpy-stream-session.ts` bewusst nicht (Abhängigkeitsbaum, s. o.). Tests eigen nach AV-Negativfällen.

## Konsequenzen

- PWA-Panel (Geräte-Knopf, Popout `#/geraete`) startet/stoppt AVDs, holt Lease, tappt/swiped/tippt/rotiert,
  öffnet URLs (`10.0.2.2` = Host-Loopback aus Emulatorsicht), lädt begrenzte Logs/Baum, installiert APK aus
  Anhängen und läuft registrierte Tests — jeweils mit sichtbarem Grund, wenn SDK/KVM fehlen (Skip ≠ Pass).
- hubctl: `hubctl devices` / `hubctl devices tests <serial>` (nur lesend, wie P39).
- E2E `e2e/specs/android-device.spec.ts` prüft den blockierten Zustand immer; die echte AVD-Abnahme läuft nur
  mit `ANCIENTVOID_E2E_ANDROID=1` + SDK — getrennt von P12/P16-Abnahmen (AC-P42-6).
- iOS-Simulator auf Linux bleibt Out-of-Scope (EPIC-P42 §2); möglich späterer Mac-Backend-Auftrag.
