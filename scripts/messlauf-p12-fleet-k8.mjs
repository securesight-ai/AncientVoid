#!/usr/bin/env node
/* global fetch, AbortSignal */
/**
 * EPIC-P12 / AI-P6-3: 30 dummy events/s per session through the home Hub's
 * fleet proxy, on two isolated temporary Hub instances. Production Hub
 * configs and datadirs are not modified.
 *
 *   ANCIENTVOID_TOKEN=<home device token> node scripts/messlauf-p12-fleet-k8.mjs
 */
import { execFileSync } from "node:child_process";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";

const HOME = "http://127.0.0.1:7373";
const TOKEN = process.env.ANCIENTVOID_TOKEN ?? "";
const RATE = 30;
const SECONDS = 10;
const PER_HOST = 10;
const hosts = [
  { key: "gpubox", ssh: "dev@gpubox.tailnet-example.ts.net", port: 7441 },
  { key: "home-server", ssh: "dev@home-server.tailnet-example.ts.net", port: 7441 },
];
const runId = randomUUID().slice(0, 8);
const remote = new Map();
const sessionIds = [];
const paired = [];
const streams = [];
const streamBySession = new Map();
const streamCounts = new Map();
const streamDropped = new Set();
const baselineSeq = new Map();
let armed = false;
let benchmarkStart = 0;
let cleaning = false;

function ssh(host, command, input) {
  return execFileSync("ssh", [...(input ? [] : ["-n"]), "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", host.ssh, command], {
    encoding: "utf8",
    ...(input ? { input } : {}),
    stdio: [input ? "pipe" : "ignore", "pipe", "pipe"],
  });
}

function authHeaders(json = false) {
  return { authorization: `Bearer ${TOKEN}`, ...(json ? { "content-type": "application/json" } : {}) };
}

async function api(path, init = {}) {
  const res = await fetch(`${HOME}${path}`, {
    ...init,
    headers: { ...authHeaders(init.body !== undefined), ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(15_000),
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

function check(ok, message) {
  if (!ok) throw new Error(message);
}

async function ready(url, timeoutMs = 30_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const res = await fetch(`${url}/api/fleet/hello`, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return await res.json();
    } catch {
      // The sidecar may still be loading workspace packages.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("temporary fleet Hub did not become ready");
}

function prepare(host) {
  const hostId = `p12k8-${host.key}-${runId}`;
  const base = `/tmp/ancientvoid-p12-k8-${runId}-${host.key}`;
  const encoded = (value) => Buffer.from(value).toString("base64");
  const ip = ssh(host, "tailscale ip -4").trim().split("\n").at(-1);
  check(/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip), `${host.key}: could not read Tailnet IPv4`);
  const config = `${base}/hub.config.json`;
  const script = `
set -euo pipefail
umask 077
base=$(printf '%s' "$1" | base64 -d)
config=$(printf '%s' "$2" | base64 -d)
host_id=$(printf '%s' "$3" | base64 -d)
ip=$(printf '%s' "$4" | base64 -d)
port=$(printf '%s' "$5" | base64 -d)
mkdir -p "$base"
node --input-type=module - "$config" "$base" "$host_id" "$ip" "$port" <<'NODE'
import { writeFileSync, chmodSync } from 'node:fs';
const [, , path, base, hostId, ip, port] = process.argv;
const config = {
  hostId,
  dataDir: base + '/data',
  workerRunner: 'process',
  projectRoots: [],
  server: { host: ip, port: Number(port) },
  adapters: [{ id: 'dummy', module: '@ancientvoid/adapter-dummy', config: { eventsPerSecond: ${RATE} } }],
};
writeFileSync(path, JSON.stringify(config, null, 2) + '\\n', { mode: 0o600 });
chmodSync(path, 0o600);
NODE
cd "$HOME/AncientVoid"
ANCIENTVOID_CONFIG="$config" nohup node apps/hub/src/main.ts >"$base/hub.log" 2>&1 < /dev/null &
echo "$!" > "$base/pid"
chmod 600 "$base/pid"
`;
  ssh(host, `bash -s -- '${encoded(base)}' '${encoded(config)}' '${encoded(hostId)}' '${encoded(ip)}' '${encoded(String(host.port))}'`, script);
  const item = { ...host, hostId, base, config, ip, url: `http://${ip}:${host.port}` };
  remote.set(host.key, item);
  return item;
}

async function pair(item) {
  await ready(item.url);
  const output = ssh(item, `cd ~/AncientVoid && node apps/hubctl/src/cli.ts fleet invite --db ${item.base}/data/hub.db`);
  const code = output.trim().split("\n").at(-1).trim();
  check(/^[A-Z0-9-]{8,}$/.test(code), `${item.key}: invite output was not recognized`);
  const res = await api("/api/fleet/peers", { method: "POST", body: { url: item.url, code } });
  check(res.status === 201, `${item.key}: fleet pairing failed (${res.status})`);
  paired.push(item);
  check(res.body?.hostId === item.hostId, `${item.key}: paired host identity mismatch`);
  const adapters = await api(`/api/hosts/${item.hostId}/adapters`);
  check(adapters.status === 200 && adapters.body?.some((adapter) => adapter.id === "dummy"), `${item.key}: dummy adapter missing`);
}

function openTail(session) {
  return new Promise((resolve, reject) => {
    const url = `${HOME.replace(/^http/, "ws")}/api/hosts/${session.hostId}/events/${session.id}/tail`;
    const socket = new WebSocket(url, { headers: { authorization: `Bearer ${TOKEN}` } });
    streams.push(socket);
    streamBySession.set(session.id, socket);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error(`${session.hostId}: event stream did not connect`));
    }, 10_000);
    socket.once("open", () => {
      clearTimeout(timeout);
      resolve(socket);
    });
    socket.once("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    socket.on("error", () => streamDropped.add(session.id));
    socket.on("message", (data) => {
      if (!armed) return;
      try {
        const message = JSON.parse(data.toString());
        if (message.type !== "events") return;
        if (message.dropped) streamDropped.add(session.id);
        const count = (message.events ?? []).filter((event) =>
          event.seq > (baselineSeq.get(session.id) ?? 0) && Date.parse(event.ts) >= benchmarkStart,
        ).length;
        streamCounts.set(session.id, (streamCounts.get(session.id) ?? 0) + count);
      } catch {
        streamDropped.add(session.id);
      }
    });
  });
}

async function cleanup() {
  if (cleaning) return;
  cleaning = true;
  armed = false;
  for (const socket of streams) socket.close();
  for (const { hostId, id } of sessionIds) {
    await api(`/api/hosts/${hostId}/sessions/${id}/stop`, { method: "POST" }).catch(() => undefined);
  }
  for (const item of paired) {
    await api(`/api/fleet/peers/${item.hostId}`, { method: "DELETE" }).catch(() => undefined);
  }
  for (const item of remote.values()) {
    try {
      ssh(item, `
set -euo pipefail
base='${item.base}'
if [ -f "$base/pid" ]; then
  pid=$(cat "$base/pid")
  kill -TERM "$pid" 2>/dev/null || true
  for _ in $(seq 1 100); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
  if kill -0 "$pid" 2>/dev/null; then echo 'temporary Hub still running' >&2; exit 1; fi
fi
rm -rf -- "$base"
`);
    } catch {
      console.error(`${item.key}: temporary files retained at ${item.base}; inspect and remove after stopping its Hub`);
    }
  }
}

async function main() {
  check(TOKEN, "ANCIENTVOID_TOKEN is required");
  const health = await fetch(`${HOME}/api/health`, { headers: authHeaders(), signal: AbortSignal.timeout(5000) });
  check(health.ok, `home Hub health returned ${health.status}`);
  const before = await api("/api/fleet/peers");
  check(before.status === 200, `home Hub peer list returned ${before.status}`);

  for (const host of hosts) prepare(host);
  for (const item of remote.values()) await pair(item);

  console.log(`P12 Fleet K8: ${hosts.length * PER_HOST} sessions, ${RATE} events/s each, ${SECONDS}s`);
  for (const item of remote.values()) {
    for (let i = 0; i < PER_HOST; i++) {
      const res = await api(`/api/hosts/${item.hostId}/sessions`, {
        method: "POST",
        body: { adapter: "dummy", project: "/tmp", prompt: `P12 K8 ${runId}-${i + 1}` },
      });
      check(res.status === 201 && res.body?.id, `${item.key}: session create failed (${res.status})`);
      sessionIds.push({ hostId: item.hostId, id: res.body.id });
    }
  }

  for (const session of sessionIds) {
    const res = await api(`/api/hosts/${session.hostId}/sessions/${session.id}/events?limit=2000`);
    check(res.status === 200 && Array.isArray(res.body), `${session.hostId}: event baseline failed`);
    baselineSeq.set(session.id, res.body.at(-1)?.seq ?? 0);
  }
  await Promise.all(sessionIds.map(openTail));
  benchmarkStart = Date.now();
  armed = true;
  for (const session of sessionIds) {
    const socket = streamBySession.get(session.id);
    socket.send(JSON.stringify({ type: "hello", lastSeq: baselineSeq.get(session.id) ?? 0 }));
  }
  await new Promise((resolve) => setTimeout(resolve, SECONDS * 1000));
  armed = false;
  for (const socket of streams) socket.close();

  const expected = Math.floor(RATE * SECONDS * 0.9);
  let failures = 0;
  let total = 0;
  for (const item of remote.values()) {
    const perSession = [];
    for (const session of sessionIds.filter((s) => s.hostId === item.hostId)) {
      const res = await api(`/api/hosts/${item.hostId}/sessions/${session.id}/events?limit=2000`);
      const events = res.body;
      const seqs = Array.isArray(events) ? events.map((event) => event.seq).sort((a, b) => a - b) : [];
      const gaps = seqs.reduce((sum, seq, i) => sum + (seq !== i + 1 ? 1 : 0), 0);
      const streamed = streamCounts.get(session.id) ?? 0;
      perSession.push({ count: seqs.length, streamed, gaps });
      if (res.status !== 200 || streamed < expected || gaps > 0 || streamDropped.has(session.id)) failures++;
    }
    const count = perSession.reduce((sum, session) => sum + session.count, 0);
    total += count;
    console.log(`${item.key}: ${count} persisted events; per-session 10s stream min=${Math.min(...perSession.map((s) => s.streamed))}; sequence gaps=${perSession.reduce((sum, s) => sum + s.gaps, 0)}`);
  }

  for (const { hostId, id } of sessionIds) await api(`/api/hosts/${hostId}/sessions/${id}/stop`, { method: "POST" });
  console.log(`result: ${failures === 0 ? "PASS" : `FAIL (${failures} session(s))`}; ${total} total events; target ≥ ${expected} per session`);
  if (failures) process.exitCode = 1;
}

process.on("SIGINT", () => {
  console.error("SIGINT received; cleaning temporary hubs");
  void cleanup().finally(() => process.exit(130));
});
process.on("SIGTERM", () => {
  console.error("SIGTERM received; cleaning temporary hubs");
  void cleanup().finally(() => process.exit(143));
});
try {
  await main();
} finally {
  await cleanup();
}
