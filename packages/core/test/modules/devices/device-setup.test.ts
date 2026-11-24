import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DeviceError} from "@ancientvoid/core";
import { DeviceService, DeviceSetup, readConfiguredSdkRoot, type DeviceExec } from "@ancientvoid/core";
import { DEVICE_DEFAULT_IMAGE, DEVICE_DEFAULT_PROFILE } from "@ancientvoid/contracts";

/** In-App-Setup (2026-11-24): Phasen, fail loud, busy, K7-Wiederanlauf, AVD-Anlage. Kein Netz, kein echtes SDK. */

class FakeExec implements DeviceExec {
  readonly runs: { argv: string[]; stdin?: string }[] = [];
  respond: (argv: string[]) => { code: number; stdout: string } | null = () => null;
  avdsStdout = "";

  run(argv: string[], opts: { stdin?: string }): Promise<{ code: number; stdout: Buffer; stderr: string }> {
    this.runs.push({ argv, ...(opts.stdin !== undefined ? { stdin: opts.stdin } : {}) });
    const r = this.respond(argv);
    return Promise.resolve({ code: r?.code ?? 0, stdout: Buffer.from(r?.stdout ?? ""), stderr: r?.code ? "Fehler: Testabweichung" : "" });
  }
  spawnDetached(): { pid: number } {
    throw new Error("nicht benötigt");
  }
  async ownedAlive(): Promise<boolean> {
    return false;
  }
  async kill(): Promise<void> {}
  async exited(): Promise<boolean> {
    return true;
  }
}

/** System-Java fehlt; tar/unzip erzeugen synchron die entpackten Dateien. */
function happyRespond(exec: FakeExec, licensesFail = false): void {
  exec.respond = (argv) => {
    const key = argv.join(" ");
    if (key === "java -version") return { code: 1, stdout: "" };
    if (argv[0] === "tar") {
      mkdirSync(join(argv[4]!, "jdk-21", "bin"), { recursive: true });
      writeFileSync(join(argv[4]!, "jdk-21", "bin", "java"), "#!/bin/sh\n");
      return { code: 0, stdout: "" };
    }
    if (argv[0]!.endsWith("java") && argv[1] === "-version") return { code: 0, stdout: "" };
    if (argv[0] === "unzip") {
      mkdirSync(join(argv[4]!, "cmdline-tools", "bin"), { recursive: true });
      writeFileSync(join(argv[4]!, "cmdline-tools", "bin", "sdkmanager"), "#!/bin/sh\n");
      return { code: 0, stdout: "" };
    }
    if (argv[0]!.endsWith("sdkmanager") && argv.at(-1) === "--licenses") return { code: licensesFail ? 1 : 0, stdout: "ok" };
    if (argv[0]!.endsWith("sdkmanager")) return { code: 0, stdout: "ok" };
    return null;
  };
}

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "av-device-setup-"));
}


describe("DeviceSetup (In-App-Setup)", () => {
  let root: string;
  let exec: FakeExec;

  beforeEach(async () => {
    root = await tempRoot();
    exec = new FakeExec();
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("läuft durch alle Phasen bis done und meldet onReady mit SDK-Wurzel und JDK-Home", async () => {
    happyRespond(exec);
    const downloads: string[] = [];
    let ready: { sdkRoot: string; jdkHome: string | null } | null = null;
    const setup = new DeviceSetup({
      dataDir: root,
      exec,
      download: async (_url, dest) => {
        downloads.push(dest);
        await writeFile(dest, "fake");
      },
      onReady: (sdkRoot, jdkHome) => {
        ready = { sdkRoot, jdkHome };
      },
    });
    const sdk = join(root, "android-sdk");
    expect((await setup.start(sdk)).started).toBe(true);
    await expect.poll(() => setup.status().state, { timeout: 5_000 }).toBe("done");
    const st = setup.status();
    expect(st.phase).toBe("packages");
    expect(st.sdkRoot).toBe(sdk);
    expect(st.reason).toBeNull();
    expect(ready).toMatchObject({ sdkRoot: sdk, jdkHome: join(sdk, ".av-setup", "jdk", "jdk-21") });
    expect(downloads).toHaveLength(2);
    // Entpackte Struktur ist wirklich eingerichtet (rename, kein Fake-Pfad).
    expect(existsSync(join(sdk, "cmdline-tools", "latest", "bin", "sdkmanager"))).toBe(true);
    // Lizenzen/Pakete laufen mit y-Antworten über stdin (kein Shell-String).
    const licensed = exec.runs.filter((r) => r.argv.at(-1) === "--licenses");
    expect(licensed).toHaveLength(1);
    expect(licensed[0]!.stdin).toMatch(/^y\n/);
    expect(exec.runs.some((r) => r.argv.includes("emulator"))).toBe(true);
    expect(st.tail).toContain("Pakete");
  });

  it("fail loud: scheiternde Phase landet mit Grund im Zustand, Setup bleibt wiederholbar", async () => {
    happyRespond(exec, true);
    const setup = new DeviceSetup({ dataDir: root, exec, download: async (_u, d) => writeFile(d, "x"), onReady: () => undefined });
    await setup.start(join(root, "android-sdk"));
    await expect.poll(() => setup.status().state, { timeout: 5_000 }).toBe("failed");
    const st = setup.status();
    expect(st.reason).toContain("Lizenzen fehlgeschlagen");
    expect(st.phase).toBe("licenses");
    expect((await setup.start(join(root, "android-sdk"))).started).toBe(true);
  });

  it("busy: während des Laufs startet kein zweites Setup", async () => {
    exec.respond = (argv) => {
      if (argv.join(" ") === "java -version") return { code: 1, stdout: "" }; // kein System-Java → JDK-Download nötig
      return null;
    };
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const setup = new DeviceSetup({
      dataDir: root,
      exec,
      download: async (_u, dest) => {
        await writeFile(dest, "x");
        await gate; // erster Download hält den Lauf in Phase jdk
      },
      onReady: () => undefined,
    });
    await setup.start(join(root, "android-sdk"));
    await expect.poll(() => setup.status().state, { timeout: 5_000 }).toBe("running");
    expect(setup.status().phase).toBe("jdk");
    const second = await setup.start(join(root, "android-sdk"));
    expect(second.started).toBe(false);
    expect(second.status.state).toBe("running");
    release();
  });

  it("K7: `running` ohne lebenden Lauf wird nach Neustart failed; done-Wurzel gilt als SDK-Wurzel", async () => {
    const journal = join(root, "setup.jsonl");
    writeFileSync(journal, `${JSON.stringify({ t: "state", at: "2026-11-24T00:00:00Z", state: "running", phase: "tools", sdkRoot: "/tmp/x" })}\n`);
    const afterCrash = new DeviceSetup({ dataDir: root, exec, onReady: () => undefined });
    expect(afterCrash.status().state).toBe("failed");
    expect(afterCrash.status().reason).toContain("Neustart");
    // Abgeschlossenes Setup: Wurzel überlebt den Neustart (Fallback für den Dienst).
    writeFileSync(journal, `${JSON.stringify({ t: "done", at: "2026-11-24T00:01:00Z", sdkRoot: join(root, "android-sdk"), jdkHome: null })}\n`);
    expect(readConfiguredSdkRoot(root)).toBe(join(root, "android-sdk"));
  });
});

describe("DeviceService (In-App-Setup)", () => {
  it("K7-Fallback: übernimmt die eingerichtete SDK-Wurzel ohne Config/env", async () => {
    const dataBase = await mkdtemp(join(tmpdir(), "av-device-svc-"));
    const devicesDir = join(dataBase, "devices");
    await mkdir(devicesDir, { recursive: true });
    const sdk = join(dataBase, "android-sdk");
    for (const part of ["platform-tools", "emulator"]) await mkdir(join(sdk, part), { recursive: true });
    writeFileSync(join(sdk, "platform-tools", "adb"), "#!/bin/sh\n");
    writeFileSync(join(sdk, "emulator", "emulator"), "#!/bin/sh\n");
    writeFileSync(join(devicesDir, "setup.jsonl"), `${JSON.stringify({ t: "done", at: "2026-11-24T00:00:00Z", sdkRoot: sdk, jdkHome: null })}\n`);
    const previousSdk = process.env.ANDROID_SDK_ROOT;
    const previousHome = process.env.ANDROID_HOME;
    delete process.env.ANDROID_SDK_ROOT;
    delete process.env.ANDROID_HOME;
    try {
      const svc = new DeviceService({ dataDir: dataBase, exec: new FakeExec(), kvmPath: "/dev/null" });
      const caps = (await svc.status()).capabilities;
      expect(caps.sdkRoot).toBe(sdk);
      expect(caps.ready).toBe(true);
    } finally {
      if (previousSdk !== undefined) process.env.ANDROID_SDK_ROOT = previousSdk;
      if (previousHome !== undefined) process.env.ANDROID_HOME = previousHome;
    }
    await rm(dataBase, { recursive: true, force: true });
  });

  it("createAvd: feste avdmanager-Vorlage mit no-Antwort; Doppelnamen werden verweigert", async () => {
    const dataBase = await mkdtemp(join(tmpdir(), "av-device-avd-"));
    const sdk = join(dataBase, "android-sdk");
    for (const part of ["platform-tools", "emulator", "cmdline-tools/latest/bin"]) await mkdir(join(sdk, part), { recursive: true });
    writeFileSync(join(sdk, "platform-tools", "adb"), "#!/bin/sh\n");
    writeFileSync(join(sdk, "emulator", "emulator"), "#!/bin/sh\n");
    const avdmanager = join(sdk, "cmdline-tools", "latest", "bin", "avdmanager");
    writeFileSync(avdmanager, "#!/bin/sh\n");
    const exec = new FakeExec();
    exec.respond = (argv) => {
      if (argv[0] === avdmanager && argv[1] === "create" && argv[2] === "avd") {
        const name = argv[argv.indexOf("-n") + 1]!;
        mkdirSync(join(dataBase, "devices", "avd", `${name}.avd`), { recursive: true });
        writeFileSync(join(dataBase, "devices", "avd", `${name}.avd`, "config.ini"), "hw.lcd.density=420\n");
        exec.avdsStdout = `${name}\n`;
        return { code: 0, stdout: "" };
      }
      if (argv.at(-1) === "-list-avds") return { code: 0, stdout: exec.avdsStdout };
      return null;
    };
    const svc = new DeviceService({ dataDir: dataBase, exec, kvmPath: "/dev/null", sdkRoot: sdk });
    expect((await svc.status()).capabilities.ready).toBe(true);
    const created = await svc.createAvd({ name: "av-e2e", image: DEVICE_DEFAULT_IMAGE, profile: DEVICE_DEFAULT_PROFILE });
    expect(created.name).toBe("av-e2e");
    const avdRun = exec.runs.find((r) => r.argv[0] === avdmanager)!;
    expect(avdRun.argv[avdRun.argv.indexOf("-n") + 1]).toBe("av-e2e");
    expect(avdRun.argv[avdRun.argv.indexOf("-k") + 1]).toBe(DEVICE_DEFAULT_IMAGE);
    expect(avdRun.argv[avdRun.argv.indexOf("--device") + 1]).toBe(DEVICE_DEFAULT_PROFILE);
    expect(avdRun.stdin).toBe("no\n");
    await expect(svc.createAvd({ name: "av-e2e", image: DEVICE_DEFAULT_IMAGE, profile: DEVICE_DEFAULT_PROFILE })).rejects.toMatchObject({ code: "conflict" } satisfies Partial<DeviceError>);
    await rm(dataBase, { recursive: true, force: true });
  });

  it("listImages: installierte System-Images aus der Verzeichnisstruktur", async () => {
    const dataBase = await mkdtemp(join(tmpdir(), "av-device-img-"));
    const sdk = join(dataBase, "android-sdk");
    await mkdir(join(sdk, "system-images", "android-35", "google_apis", "x86_64"), { recursive: true });
    const svc = new DeviceService({ dataDir: dataBase, exec: new FakeExec(), kvmPath: "/dev/null", sdkRoot: sdk });
    expect(svc.listImages()).toMatchObject({ images: [DEVICE_DEFAULT_IMAGE] });
    await rm(dataBase, { recursive: true, force: true });
  });
});
