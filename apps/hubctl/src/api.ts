/** Shared hub access for hubctl commands — base URL, token, JSON fetch. */

export const BASE = process.env.ANCIENTVOID_URL ?? "http://127.0.0.1:7373";
const TOKEN = process.env.ANCIENTVOID_TOKEN ?? "";

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(`${res.status} ${res.statusText}: ${body.error ?? ""}`, { cause: res.status });
  }
  return (await res.json()) as T;
}
