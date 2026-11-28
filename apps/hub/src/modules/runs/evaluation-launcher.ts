import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, readdir, appendFile, open } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { EvalLaunch } from "@ancientvoid/contracts";

const id = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,47}$/);
const safeOrigin = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    && url.pathname === "/" && !url.username && !url.password && !url.search && !url.hash;
});
const file = z.string().min(1).max(4096);
const presetsSchema = z.array(z.strictObject({
  id, label: z.string().min(1).max(120), repo: file, protocol: file, scratch: file,
  corpus: file.optional(),
  origin: safeOrigin, tokenFile: file,
  energy: z.strictObject({ origin: safeOrigin, tokenFile: file }).optional(),
})).max(50).refine((presets) => new Set(presets.map((preset) => preset.id)).size === presets.length, "duplicate evaluation preset");

const launchSchema = z.object({
  series: z.string().regex(/^eval-\d+-[a-f0-9]{8}$/),
  preset: id,
  repo: z.string(),
  startedAt: z.iso.datetime(),
  state: z.enum(["running", "finished", "partial", "failed", "interrupted"]),
});
const interruption = z.object({
  key: z.string().regex(/^[a-z0-9._-]+\/[a-z0-9._-]+\/[1-9][0-9]*$/).max(250),
  cause: z.enum(["timeout", "approval", "infrastructure"]),
});
const runner = fileURLToPath(new URL("../../../../../scripts/messlauf-eval.mjs", import.meta.url));

async function interruptions(scratch: string, series: string): Promise<NonNullable<EvalLaunch["interruptions"]>> {
  const files = await Promise.all(["aborted.jsonl", "invalid.jsonl"].map(async (name) => {
    try {
      return await readFile(join(scratch, series, name), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw error;
    }
  }));
  return files.flatMap((file) => file.split("\n").slice(0, -1).flatMap((line) => {
    const entry = interruption.safeParse(JSON.parse(line));
    return entry.success ? [entry.data] : [];
  })).slice(-30);
}

export class EvaluationLauncher {
  private readonly directory: string;
  private child: ChildProcess | null = null;
  private active: string | null = null;
  private starting = false;

  constructor(privateDataDir: string) {
    this.directory = join(privateDataDir, "evaluation");
  }

  private async configured() {
    try {
      return presetsSchema.parse(JSON.parse(await readFile(join(this.directory, "presets.json"), "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async list() {
    const configured = await this.configured();
    const presets = configured.map(({ id, label, repo }) => ({ id, label, repo }));
    let files: string[];
    try {
      files = await readdir(this.directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { presets, runs: [] };
      throw error;
    }
    const journals = await Promise.all(files.filter((name) => /^run-[a-z0-9.-]+\.jsonl$/.test(name)).sort().slice(-30).map(async (name) => {
      const raw = await readFile(join(this.directory, name), "utf8");
      const entries = raw.split("\n").slice(0, -1);
      if (entries.length === 0) return null;
      const launch = launchSchema.parse(JSON.parse(entries.at(-1)!));
      if (launch.state === "running" && launch.series !== this.active) launch.state = "interrupted";
      const preset = configured.find(({ id }) => id === launch.preset);
      return preset ? { ...launch, interruptions: await interruptions(preset.scratch, launch.series) } : launch;
    }));
    return { presets, runs: journals.filter((entry) => entry !== null) };
  }

  async start(presetId: string): Promise<EvalLaunch | null> {
    if (this.starting || this.active !== null) throw new Error("An evaluation is already running");
    this.starting = true;
    try {
      const preset = (await this.configured()).find((entry) => entry.id === presetId);
      if (!preset) return null;
      const protocol = JSON.parse(await readFile(preset.protocol, "utf8")) as { repoScan?: { repo?: string } };
      if (protocol.repoScan?.repo !== preset.repo) throw new Error("Repository differs from the registered scan protocol");
      const [token, energyToken] = await Promise.all([readFile(preset.tokenFile, "utf8"), preset.energy && readFile(preset.energy.tokenFile, "utf8")]);
      if (!token.trim() || (preset.energy && !energyToken?.trim())) throw new Error("Benchmark credentials are missing");
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const startedAt = new Date().toISOString();
      const series = `eval-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
      const journal = join(this.directory, `run-${series}.jsonl`);
      const launch: EvalLaunch = { series, preset: preset.id, repo: preset.repo, startedAt, state: "running" };
      const log = await open(join(this.directory, `${series}.log`), "wx", 0o600);
      try {
        await appendFile(journal, JSON.stringify(launch) + "\n", { mode: 0o600, flush: true });
        this.active = series;
        const args = [runner, "run", "--protocol", preset.protocol, "--scratch", preset.scratch, "--series", series];
        if (preset.corpus) args.push("--corpus", preset.corpus);
        this.child = spawn(process.execPath, args, {
          stdio: ["ignore", log.fd, log.fd, "ipc"],
          env: {
            ...process.env,
            ANCIENTVOID_URL: preset.origin,
            ANCIENTVOID_TOKEN: token.trim(),
            ANCIENTVOID_EVAL_ENERGY_URL: preset.energy?.origin ?? "",
            ANCIENTVOID_EVAL_ENERGY_TOKEN: energyToken?.trim() ?? "",
          },
        });
        this.child.once("error", (error) => console.error("Evaluation process could not start", error.message));
        this.child.once("close", (code) => {
          const state = code === 0 ? "finished" : code === 2 ? "partial" : "failed";
          void appendFile(journal, JSON.stringify({ ...launch, state }) + "\n", { flush: true })
            .catch((error: unknown) => console.error("Evaluation journal could not be updated", error))
            .finally(() => { this.active = null; this.child = null; });
        });
      } catch (error) {
        this.active = null;
        throw error;
      } finally {
        await log.close();
      }
      return launch;
    } finally {
      this.starting = false;
    }
  }

  close(): void {
    if (this.child?.connected) this.child.disconnect();
  }
}
