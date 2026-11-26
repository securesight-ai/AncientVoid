#!/usr/bin/env node
/**
 * Messlauf EPIC-P6 (T6.5) against the real fleet over the tailnet.
 *
 *   ANCIENTVOID_TOKEN=<device token of the home hub> node scripts/messlauf-p6.mjs <step>
 *
 * Steps: sessions (AC-P6-1, K8) · routing (AC-P6-2, K1) · outage (AC-P6-3, 5 min)
 *        revoke (AC-P6-4) · incompatible (AC-P6-5) · logs (credentials, AC-P6-2)
 *
 * Talks only to the home hub's API (127.0.0.1:7373) and, for outage/revoke,
 * to the other hosts over SSH (systemctl --user, hubctl). Prints numbers and
 * a verdict; the record lives under docs/messlauf/.
 */
import { createServer, request } from "node:http";
import { Buffer } from "node:buffer";
import { URL } from "node:url";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import WebSocket from "ws";

const HOME = "http://127.0.0.1:7373";
const TOKEN = process.env.ANCIENTVOID_TOKEN ?? "";
const HOSTS = {
  "home-server": { ssh: "dev@home-server.tailnet-example.ts.net", project: "/home/dev/ancientvoid-alpha" },
  gpubox: { ssh: "dev@gpubox.tailnet-example.ts.net", project: "/home/dev/ancientvoid-projects/ancientvoid-alpha" },
};
const REMOTE_HUBCTL = "cd ~/AncientVoid && node apps/hubctl/src/cli.ts";
const REMOTE_DB = "--db ~/.local/share/ancientvoid/hub.db";

function api(path, init = {}) {
  const payload = init.body === undefined ? undefined : JSON.stringify(init.body);
  const url = new URL(path, HOME);
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: init.method ?? (payload === undefined ? "GET" : "POST"),
        agent: false,
        headers: {
          authorization: `Bearer ${init.token ?? TOKEN}`,
          ...(payload === undefined ? {} : { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }),
        },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (text += c));
        res.on("end", () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }));
      },
    );
    req.setTimeout(15_000, () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const ssh = (host, cmd) => execFileSync("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", HOSTS[host].ssh, cmd], { encoding: "utf8" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stats = (v) => {
  const s = [...v].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
  return `n=${s.length} min=${s[0]} median=${q(0.5)} p95=${q(0.95)} max=${s.at(-1)} ms`;
};
async function until(check, what, timeoutMs = 30_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await check()) return;
    await sleep(250);
  }
  throw new Error(`timed out: ${what}`);
}
const fleet = async () => (await api("/api/fleet")).body;
const hostOf = (f, id) => f.hosts.find((h) => h.hostId === id);

async function remoteSessions(host) {
  return (await api(`/api/hosts/${host}/sessions`)).body;
}

async function sessionsStep() {
  const wanted = { "home-server": 7, gpubox: 6 };
  for (const [host, n] of Object.entries(wanted)) {
    const have = (await remoteSessions(host)).length;
    for (let i = have; i < n; i++) {
      const res = await api(`/api/hosts/${host}/sessions`, { body: { adapter: "dummy", project: HOSTS[host].project, prompt: `Flotten-Messlauf ${host} ${i + 1}` } });
      if (res.status !== 201) throw new Error(`create on ${host}: ${res.status} ${JSON.stringify(res.body)}`);
    }
  }
  const times = [];
  let last;
  for (let r = 0; r < 10; r++) {
    const t0 = performance.now();
    last = await fleet();
    times.push(Math.round(performance.now() - t0));
  }
  const keys = last.sessions.map((s) => `${s.hostId}/${s.id}`);
  const perHost = Object.fromEntries(last.hosts.map((h) => [h.hostId, `${h.sessions} (${h.state})`]));
  const alphaHosts = new Set(last.sessions.filter((s) => s.project.endsWith("/ancientvoid-alpha")).map((s) => s.hostId));
  console.log("AC-P6-1 / K8 — Flottenübersicht");
  console.log("  pro Host:", JSON.stringify(perHost));
  console.log(`  gesamt: ${last.sessions.length}, doppelte Schlüssel: ${keys.length - new Set(keys).size}`);
  console.log(`  gleichnamiges Projekt ancientvoid-alpha getrennt auf: ${[...alphaHosts].sort().join(", ")}`);
  console.log("  GET /api/fleet:", stats(times));
  const ok = last.sessions.length >= 20 && last.hosts.every((h) => h.state === "reachable" && h.sessions >= 2) && keys.length === new Set(keys).size && alphaHosts.size === 2;
  console.log(`  verdict: ${ok ? "PASS" : "FAIL"}`);
}

async function routingStep() {
  console.log("AC-P6-2 / K1 — Eingaben landen nur beim adressierten Host");
  const run = Date.now().toString(36);
  const picked = {};
  for (const host of Object.keys(HOSTS)) picked[host] = (await remoteSessions(host)).find((s) => s.adapter === "dummy");
  const latencies = [];
  for (const host of Object.keys(HOSTS)) {
    for (let i = 0; i < 10; i++) {
      const t0 = performance.now();
      const res = await api(`/api/hosts/${host}/sessions/${picked[host].id}/steer`, {
        body: { kind: "prompt", text: `p6-${run}-${host}-${i}`, inputId: `p6-${run}-${host}-${i}`, clientId: "messlauf-p6" },
      });
      latencies.push(Math.round(performance.now() - t0));
      if (res.status !== 200) throw new Error(`steer ${host} ${i}: ${res.status} ${JSON.stringify(res.body)}`);
    }
  }
  const dup = await api(`/api/hosts/gpubox/sessions/${picked.gpubox.id}/steer`, {
    body: { kind: "prompt", text: `p6-${run}-gpubox-0`, inputId: `p6-${run}-gpubox-0`, clientId: "messlauf-p6" },
  });
  let wrong = 0;
  let found = 0;
  for (const host of Object.keys(HOSTS)) {
    for (const s of await remoteSessions(host)) {
      const events = (await api(`/api/hosts/${host}/sessions/${s.id}/events?limit=2000`)).body;
      for (const e of events) {
        const m = e.type === "user" && typeof e.payload?.text === "string" && e.payload.text.match(new RegExp(`^p6-${run}-(.+)-\\d+$`));
        if (!m) continue;
        if (m[1] === host && s.id === picked[host].id) found++;
        else wrong++;
      }
    }
  }
  console.log("  Steer-Latenz über den Heim-Hub (K1-Pfad):", stats(latencies));
  console.log(`  angekommen beim richtigen Host: ${found}/20 · woanders: ${wrong} · Wiederholung gleiche Input-ID: ${dup.body?.detail}`);
  console.log(`  verdict: ${found === 20 && wrong === 0 && dup.body?.detail === "duplicate input ignored" ? "PASS" : "FAIL"}`);
}

async function outageStep() {
  const host = "home-server";
  const minutes = Number(process.env.OUTAGE_MINUTES ?? 5);
  console.log(`AC-P6-3 — ${host} ${minutes} min offline`);
  const target = (await remoteSessions(host)).find((s) => s.adapter === "dummy");
  const inputId = `p6-outage-${Date.now().toString(36)}`;
  const ack = await api(`/api/hosts/${host}/sessions/${target.id}/steer`, { body: { kind: "prompt", text: "vor dem Ausfall", inputId, clientId: "messlauf-p6" } });
  if (ack.status !== 200) throw new Error("steer before outage failed");
  const before = (await api(`/api/hosts/${host}/sessions/${target.id}/events?limit=2000`)).body.map((e) => `${e.seq}|${e.type}|${e.summary}`);
  const syncedBefore = hostOf(await fleet(), host).lastSyncAt;
  ssh(host, "systemctl --user stop ancientvoid-hub");
  const t0 = Date.now();
  let checks = 0;
  let othersOk = 0;
  let staleOk = 0;
  while (Date.now() - t0 < minutes * 60_000) {
    const f = await fleet();
    const h = hostOf(f, host);
    if (h.state === "stale" && h.lastSyncAt === syncedBefore) staleOk++;
    const evox = (await remoteSessions("gpubox")).find((s) => s.adapter === "dummy");
    const steer = await api(`/api/hosts/gpubox/sessions/${evox.id}/steer`, { body: { kind: "prompt", text: `während Ausfall ${checks}` } });
    const local = await api("/api/sessions");
    if (steer.status === 200 && local.status === 200 && hostOf(f, "gpubox").state === "reachable") othersOk++;
    checks++;
    await sleep(30_000);
  }
  ssh(host, "systemctl --user start ancientvoid-hub");
  const reconnectStart = Date.now();
  await until(async () => hostOf(await fleet(), host).state === "reachable", `${host} back`, 60_000);
  const reconnectMs = Date.now() - reconnectStart;
  const after = (await api(`/api/hosts/${host}/sessions/${target.id}/events?limit=2000`)).body.map((e) => `${e.seq}|${e.type}|${e.summary}`);
  const retry = await api(`/api/hosts/${host}/sessions/${target.id}/steer`, { body: { kind: "prompt", text: "vor dem Ausfall", inputId, clientId: "messlauf-p6" } });
  const prefixOk = before.every((line, i) => after[i] === line);
  console.log(`  Prüfungen während des Ausfalls: ${checks} · andere Hosts bedienbar: ${othersOk}/${checks} · „veraltet“ mit Original-Zeit: ${staleOk}/${checks}`);
  console.log(`  Wiederverbindung nach Start: ${reconnectMs} ms · bestätigte Events unverändert: ${prefixOk} (${before.length}) · gleiche Input-ID danach: ${retry.body?.detail}`);
  console.log(`  verdict: ${othersOk === checks && staleOk === checks && prefixOk && retry.body?.detail === "duplicate input ignored" ? "PASS" : "FAIL"}`);
}

async function revokeStep() {
  const host = "gpubox";
  console.log(`AC-P6-4 — Widerruf auf ${host}, Heim-Hub-Ausfall`);
  const s = (await remoteSessions(host)).find((x) => x.adapter === "dummy");
  const ws = new WebSocket(`${HOME.replace("http", "ws")}/api/hosts/${host}/events/${s.id}/tail`, { headers: { authorization: `Bearer ${TOKEN}` } });
  await new Promise((r, j) => {
    ws.once("open", r);
    ws.once("error", j);
  });
  ws.send(JSON.stringify({ type: "hello", lastSeq: 0 }));
  const closed = new Promise((r) => ws.once("close", (code) => r(code)));
  const t0 = Date.now();
  ssh(host, `${REMOTE_HUBCTL} token revoke fleet:workstation ${REMOTE_DB}`);
  const newReq = await api(`/api/hosts/${host}/sessions`);
  const code = await Promise.race([closed, sleep(10_000).then(() => "offen")]);
  const closeMs = Date.now() - t0;
  const state = hostOf(await fleet(), host).state;
  console.log(`  neue Anfrage: ${newReq.status} (${newReq.body?.state}) · Stream geschlossen nach ${closeMs} ms (Code ${code}) · Übersicht: ${state}`);

  // Home hub down: the other hub keeps working on its own.
  const devTok = ssh(host, `${REMOTE_HUBCTL} token issue messlauf-p6 ${REMOTE_DB} | tail -n 1`).trim();
  execFileSync("scripts/hub.sh", ["stop"]);
  let own;
  try {
    const url = "http://gpubox.tailnet-example.ts.net:7373";
    const probe = (path, body) =>
      new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : undefined;
        const req = request(new URL(path, url), { method: body ? "POST" : "GET", agent: false, headers: { authorization: `Bearer ${devTok}`, ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}) } }, (res) => {
          let t = "";
          res.on("data", (c) => (t += c));
          res.on("end", () => resolve({ status: res.statusCode, body: t ? JSON.parse(t) : null }));
        });
        req.on("error", reject);
        if (payload) req.write(payload);
        req.end();
      });
    const created = await probe("/api/sessions", { adapter: "dummy", project: HOSTS[host].project, prompt: "ohne Heim-Hub" });
    own = created.status;
  } finally {
    execFileSync("scripts/hub.sh", ["start"]);
    ssh(host, `${REMOTE_HUBCTL} token revoke messlauf-p6 ${REMOTE_DB}`);
  }
  await until(async () => (await api("/api/fleet").catch(() => ({ status: 0 }))).status === 200, "home hub back", 30_000);
  console.log(`  ${host} direkt bedienbar, während der Heim-Hub aus ist: Session anlegen → ${own}`);
  // Pair again for the next steps.
  const code2 = ssh(host, `${REMOTE_HUBCTL} fleet invite ${REMOTE_DB} | tail -n 1`).trim();
  const repaired = await api("/api/fleet/peers", { body: { url: "http://gpubox.tailnet-example.ts.net:7373", code: code2 } });
  console.log(`  neu gekoppelt: ${repaired.status}`);
  console.log(`  verdict: ${newReq.status === 502 && code === 4401 && closeMs < 5000 && state === "unauthorized" && own === 201 && repaired.status === 201 ? "PASS" : "FAIL"}`);
}

async function incompatibleStep() {
  console.log("AC-P6-5 — inkompatibler Hub wird sichtbar abgewiesen");
  const fake = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ hostId: "altversion", protocolVersion: 99, hubVersion: "9.9.9", serverTime: new Date().toISOString() }));
  });
  await new Promise((r) => fake.listen(7399, "127.0.0.1", r));
  try {
    const res = await api("/api/fleet/peers", { body: { url: "http://127.0.0.1:7399", code: "AAAA-BBBB-CCCC" } });
    console.log(`  Antwort: ${res.status} ${JSON.stringify(res.body)}`);
    console.log(`  verdict: ${res.status === 422 && /incompatible/.test(res.body?.error ?? "") ? "PASS" : "FAIL"}`);
  } finally {
    fake.close();
  }
}

async function logsStep() {
  console.log("AC-P6-2 — keine Zugangsdaten in Logs");
  const db = new DatabaseSync("data/hub.db", { readOnly: true });
  const secrets = db.prepare("SELECT token FROM fleet_peers").all().map((r) => r.token);
  db.close();
  secrets.push(TOKEN);
  // Only entries since the BUG-0028 fix went live on workstation (older ones are
  // the known leak, kept on purpose until the public release clean-up).
  const since = Date.parse(process.env.LOGS_SINCE ?? "2026-09-23T14:53:40Z");
  const stamp = (line) => {
    try {
      const j = JSON.parse(line);
      return typeof j.time === "number" ? j.time : Date.parse(j.ts ?? "");
    } catch {
      return NaN;
    }
  };
  const sources = {
    workstation: readFileSync(`/tmp/ancientvoid-hub-${execFileSync("bash", ["-c", "printf '%s' \"$PWD\" | cksum | cut -d' ' -f1"], { encoding: "utf8" }).trim()}.log`, "utf8").split("\n").filter((l) => stamp(l) >= since).join("\n"),
  };
  for (const host of Object.keys(HOSTS)) sources[host] = ssh(host, "journalctl --user -u ancientvoid-hub --no-pager --since today");
  let leaks = 0;
  for (const [name, text] of Object.entries(sources)) {
    const raw = (text.match(/[?&]token=(?!\[redacted\])[A-Za-z0-9_-]{8,}/g) ?? []).length;
    const known = secrets.filter((s) => s && text.includes(s)).length;
    console.log(`  ${name}: unmaskierte token= ${raw} · bekannte Tokens im Text ${known}`);
    leaks += raw + known;
  }
  console.log(`  verdict: ${leaks === 0 ? "PASS" : "FAIL (alte Einträge vor BUG-0028?)"}`);
}

const steps = { sessions: sessionsStep, routing: routingStep, outage: outageStep, revoke: revokeStep, incompatible: incompatibleStep, logs: logsStep };
const step = steps[process.argv[2] ?? ""];
if (!step || !TOKEN) {
  console.error(`usage: ANCIENTVOID_TOKEN=… node scripts/messlauf-p6.mjs ${Object.keys(steps).join("|")}`);
  process.exit(2);
}
await step();
