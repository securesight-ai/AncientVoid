import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, openFromOverview, openLayer } from "../support/fixtures.ts";

/**
 * In-App-Setup (2026-11-24): der komplette Simulator-Setup-Ablauf läuft in der PWA —
 * Einrichtung (SDK über lokale Spiegel-Archive, kein Cloud-Egress), AVD anlegen,
 * Emulator starten, Lease holen, bedienen, Schließen-Knopf. Die Archive enthalten
 * Fake-CLIs mit denselben Datei-Ergebnissen wie die echten Werkzeuge; die echte
 * AVD-Abnahme bleibt in android-device.spec.ts (ANCIENTVOID_E2E_ANDROID=1, Skip ≠ Pass).
 */

const dir = mkdtempSync(join(tmpdir(), "av-device-mirror-"));

// Fake-JDK: Tarball mit einem java-Skript, das -version behauptet.
mkdirSync(join(dir, "jdk-21", "bin"), { recursive: true });
writeFileSync(join(dir, "jdk-21", "bin", "java"), "#!/usr/bin/env bash\nexit 0\n");
spawnSync("chmod", ["+x", join(dir, "jdk-21", "bin", "java")]);
run("tar", ["-czf", join(dir, "jdk.tar.gz"), "-C", dir, "jdk-21"], dir);

// Fake-cmdline-tools: sdkmanager richtet Plattform-Tools/Emulator/System-Image ein,
// avdmanager legt den AVD im ANDROID_AVD_HOME an.
mkdirSync(join(dir, "cmdline-tools", "bin"), { recursive: true });
writeFileSync(
  join(dir, "cmdline-tools", "bin", "sdkmanager"),
  `#!/usr/bin/env bash
set -e
ROOT=""
for a in "$@"; do
  case "$a" in
    --sdk_root=*) ROOT="\${a#--sdk_root=}" ;;
    platform-tools) mkdir -p "$ROOT/platform-tools"; printf '#!/usr/bin/env bash\nif [ "$1" = "devices" ]; then :; fi\nexec sleep 3600\n' > "$ROOT/platform-tools/adb"; chmod +x "$ROOT/platform-tools/adb" ;;
    emulator) mkdir -p "$ROOT/emulator"; printf '#!/usr/bin/env bash\nPORT=""; AVD=""\nwhile [ $# -gt 0 ]; do\n  case "$1" in\n    -port) PORT="$2"; shift 2 ;;\n    -avd) AVD="$2"; shift 2 ;;\n    *) shift ;;\n  esac\ndone\nif [ "$1" = "-list-avds" ] || [ -z "$PORT" ]; then ls -1 "$ANDROID_AVD_HOME" 2>/dev/null | grep -v .fake-live | sed s/.avd$//; exit 0; fi\nmkdir -p "$ANDROID_AVD_HOME/.fake-live"\nprintf %%s "$AVD" > "$ANDROID_AVD_HOME/.fake-live/emulator-$PORT"\nexec sleep 3600\n' > "$ROOT/emulator/emulator"; chmod +x "$ROOT/emulator/emulator" ;;
    system-images*) SAFE=$(printf %s "$1" | tr ';' '/'); mkdir -p "$ROOT/$SAFE" ;;
  esac
done
exit 0
`,
);
writeFileSync(
  join(dir, "cmdline-tools", "bin", "avdmanager"),
  `#!/usr/bin/env bash
set -e
NAME=""; PROFILE="pixel_6"
while [ $# -gt 0 ]; do
  case "$1" in
    -n) NAME="$2"; shift 2 ;;
    -k) shift 2 ;;
    --device) PROFILE="$2"; shift 2 ;;
    *) shift ;;
  esac
done
mkdir -p "$ANDROID_AVD_HOME/$NAME.avd"
printf 'hw.device.name=%s\nhw.lcd.density=420\nhw.ramSize=2048\n' "$PROFILE" > "$ANDROID_AVD_HOME/$NAME.avd/config.ini"
exit 0
`,
);
spawnSync("chmod", ["+x", join(dir, "cmdline-tools", "bin", "sdkmanager"), join(dir, "cmdline-tools", "bin", "avdmanager")]);
run("zip", ["-qr", join(dir, "tools.zip"), "cmdline-tools"], dir);

function run(cmd: string, args: string[], cwd: string): void {
  const res = spawnSync(cmd, args, { cwd });
  if (res.status !== 0) throw new Error(`${cmd} fehlgeschlagen: ${res.stderr.toString().slice(0, 400)}`);
}

// 1×1-PNG für den Standbild-Pfad (Geometrie aus dem IHDR).
const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
// Fake-adb: beantwortet Inventar, Boot-Marker, AVD-Name, Standbild — genug für Start → bereit → Frame.
function installAnsweringAdb(sdkRoot: string): void {
  const path = join(sdkRoot, "platform-tools", "adb");
  writeFileSync(
    path,
`#!/usr/bin/env bash
if [ "$1" = "devices" ]; then printf 'List of devices attached\\n'; for f in "$ANDROID_AVD_HOME/.fake-live"/emulator-*; do [ -f "$f" ] && printf '%s\\tdevice product:fake model:Fake transport_id:1\\n' "$(basename "$f")"; done; exit 0; fi
[ "$1" = "-s" ] || exit 0
SERIAL="$2"; CMD="$3"; shift 3
case "$CMD" in
  emu) cat "$ANDROID_AVD_HOME/.fake-live/$SERIAL" 2>/dev/null ;;
  exec-out) printf '%s' "${PNG_1X1}" | base64 -d ;;
  shell)
    case "$*" in
      *sys.boot_completed*) echo "1" ;;
      *"wm size"*) echo "Physical size: 1080x2400" ;;
      *) echo "" ;;
    esac ;;
  logcat) echo "01-01 00:00:00.000 1 1 I fake: zeile" ;;
  *) echo "" ;;
esac
exit 0
`,
  );
  spawnSync("chmod", ["+x", path]);
}

test.use({ hubOptions: { devices: { setup: { jdkUrl: `file://${join(dir, "jdk.tar.gz")}`, toolsUrl: `file://${join(dir, "tools.zip")}` } } } });

test.describe("Simulator-Setup in der App (In-App-Setup 2026-11-24)", () => {
  test("Einrichtung → AVD anlegen → Start → Lease → Schließen — ganz ohne CLI", async ({ app, hub }) => {
    test.setTimeout(240_000);
    const id = await hub.createSession({ adapter: "dummy", prompt: "simulator-setup", project: hub.alpha });
    await openFromOverview(app, "dummy");
    await openLayer(app, "Geräte");
    await expect(app.getByTestId("device-panel")).toBeVisible();
    // Ohne SDK ehrlich blockiert — mit Weg in der Fläche (fail loud).
    await expect(app.getByTestId("device-unavailable")).toBeVisible();
    await expect(app.getByTestId("device-unavailable")).toContainText(/SDK/);

    // Einrichtung: Zielordner steht fest (AV-eigenes Verzeichnis), Klick startet JDK+Tools+Lizenzen+Pakete.
    const sdkRoot = join(hub.dataDir, "devices", "android-sdk");
    await app.getByTestId("device-setup-target").fill(sdkRoot);
    await app.getByTestId("device-setup-start").click();
    await expect(app.getByTestId("device-setup-state")).toContainText("SDK bereit", { timeout: 120_000 });

    // Das Setup hat Platzhalter angelegt — die adb-CLI antwortet jetzt wie das echte Werkzeug.
    installAnsweringAdb(sdkRoot);
    await expect(app.getByTestId("device-unavailable")).toHaveCount(0, { timeout: 15_000 });

    // AVD anlegen — Name, installiertes Image, Profil; Ergebnis erscheint in der Liste.
    await app.getByText("AVD anlegen (Simulator-Einrichtung)").click();
    await app.getByTestId("device-avd-name").fill("e2e-avd");
    await app.getByTestId("device-avd-create-btn").click();
    await expect(app.getByTestId("device-avd-created")).toContainText("e2e-avd");
    await expect(app.getByTestId("device-avd")).toContainText("e2e-avd", { timeout: 35_000 });

    // Start: Emulator läuft (Fake), adb meldet Boot-Marker → bereit.
    await app.getByTestId("device-start").click();
    const row = app.getByTestId("device-row").filter({ hasText: "emulator-5554" });
    await expect(row.getByTestId("device-state")).toHaveText("bereit", { timeout: 60_000 });

    // Nutzung: Lease holen, Standbild erscheint — Eingaben sind an Generation und Geometrie gebunden.
    await row.getByText("emulator-5554").click();
    await app.getByTestId("device-lease").click();
    await expect(app.getByTestId("device-generation")).toBeVisible({ timeout: 30_000 });
    await expect(app.getByTestId("device-frame")).toBeVisible({ timeout: 30_000 });

    // Schließen-Knopf: sichtbar und funktional — Panel weg, Emulator bleibt beim Hub.
    await expect(app.getByRole("button", { name: "Geräte schließen" })).toBeVisible();
    await app.getByRole("button", { name: "Geräte schließen" }).click();
    await expect(app.getByTestId("device-panel")).toHaveCount(0);
    const st = await hub.api<{ devices: { serial: string; owned: boolean }[] }>("/api/devices");
    expect(st.body.devices.some((d) => d.serial === "emulator-5554" && d.owned)).toBe(true);
    await hub.api("/api/devices/stop", { body: { serial: "emulator-5554" } });
    void id;
  });

  test.afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });
});
