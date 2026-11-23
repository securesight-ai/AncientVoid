import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { makeRecordingContext, waitFor } from "@ancientvoid/adapter-testkit";
import { ProcessRunner } from "@ancientvoid/workers";
import { createAdapter } from "../src/index.ts";

it.each(["success", "rejection", "wrong-file"])("compacts only the verified Pi session (%s)", async (outcome) => {
  const dir = mkdtempSync(join(tmpdir(), "av-pi-compact-"));
  const id = randomUUID();
  const file = join(dir, "project", `session_${id}.jsonl`);
  const fake = join(dir, "pi.cjs");
  mkdirSync(join(dir, "project"));
  writeFileSync(file, JSON.stringify({ type: "session", id }) + "\n");
  writeFileSync(fake, `#!/usr/bin/env node
    const readline = require("node:readline");
    const args = process.argv.slice(2);
    if (args[0] !== "--mode" || args[1] !== "rpc") process.exit(2);
    readline.createInterface({ input: process.stdin }).on("line", (line) => {
      const req = JSON.parse(line);
      const reply = (fields) => console.log(JSON.stringify({ type: "response", command: req.type, id: req.id, ...fields }));
      if (req.type === "get_state") {
        reply({ success: true, data: { sessionFile: ${outcome === "wrong-file" ? '"/missing"' : 'args.at(-1)'} } });
      } else if (req.type === "compact") {
        reply(${outcome === "rejection" ? '{ success: false, error: "Nothing to compact" }' : '{ success: true, data: { summary: "private summary" } }'});
      } else {
        process.exit(3);
      }
    });
  `, { mode: 0o755 });
  const runner = new ProcessRunner();
  const ctx = makeRecordingContext({
    workdir: dir,
    spawnWorker: (cmd) => runner.spawn({ name: "pi-compaction-test", cwd: dir, cmd }),
  });
  const adapter = createAdapter({ command: fake, sessionsDir: dir });
  const handle = await adapter.start({ adapter: "pi", project: dir, args: { resumeSessionId: id } }, ctx);
  try {
    expect(await adapter.steer(handle, { kind: "prompt", text: "/compact" }, ctx)).toEqual({ ok: true });
    expect(await adapter.steer(handle, { kind: "prompt", text: "weiter" }, ctx)).toMatchObject({ ok: false });
    await waitFor(() => ctx.events.some((event) => event.payload.kind === "pi.turn_end"));
    const kinds = ctx.events.map((event) => event.payload.kind);
    expect(kinds.includes("pi.compaction_start"), JSON.stringify(ctx.events)).toBe(outcome !== "wrong-file");
    expect(kinds.includes("pi.compaction_end")).toBe(outcome === "success");
    expect(kinds.includes("provider.error"), JSON.stringify(ctx.events)).toBe(outcome !== "success");
    expect(JSON.stringify(ctx.events)).not.toContain("private summary");
  } finally {
    await adapter.stop(handle, ctx);
    rmSync(dir, { recursive: true, force: true });
  }
});
