import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { type TeamAddressError } from "@ancientvoid/contracts";

/**
 * EPIC-P83 T83.2 (ADR-0118 §3): Adressprüfung für Team-Sockets — Lauschen und
 * Wählen. Erlaubt sind nur Loopback, RFC 1918, 100.64.0.0/10 und fc00::/7;
 * Wildcard und öffentliche Adressen sind ein Startfehler. Ausgehende Ziele
 * werden nach der Namensauflösung geprüft und die geprüfte Adresse gewählt
 * (kein DNS-Rebinding). Das gilt unabhängig von anderen Bind-Optionen des Hubs.
 */

type V4Check = (n: bigint) => boolean;

/** CIDR-Prüfung für IPv4 als 32-Bit-Zahl. */
function v4Cidr(cidr: string): V4Check {
  const [base, bitsRaw] = cidr.split("/");
  const bits = Number(bitsRaw);
  const baseN = BigInt(`0b${base!.split(".").map((o) => Number(o).toString(2).padStart(8, "0")).join("")}`);
  const mask = ((1n << BigInt(bits)) - 1n) << (32n - BigInt(bits));
  return (n: bigint): boolean => (n & mask) === (baseN & mask);
}

const RFC1918 = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"].map(v4Cidr);
const CGNAT = v4Cidr("100.64.0.0/10");
const LOOPBACK_V4 = v4Cidr("127.0.0.0/8");

function v4Allowed(ip: string): boolean {
  const n = BigInt(`0b${ip.split(".").map((o) => Number(o).toString(2).padStart(8, "0")).join("")}`);
  return LOOPBACK_V4(n) || RFC1918.some((c) => c(n)) || CGNAT(n);
}

/** IPv6: ::1, IPv4-mapped (::ffff:a.b.c.d → v4-Regeln) und fc00::/7 (ULA). */
function v6Allowed(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1") return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return v4Allowed(mapped[1]!);
  const first = Number.parseInt(lower.split(":")[0] || "0", 16) || 0;
  return (first & 0xfe00) === 0xfc00; // fc00::/7
}

/** Literal-Prüfung: Wildcard, öffentlich oder erlaubt? */
export function checkTeamAddressLiteral(host: string): "allowed" | "wildcard" | "public" {
  const trimmed = host.trim();
  if (trimmed === "" || trimmed === "*" || trimmed === "0.0.0.0" || trimmed === "::" || trimmed === "[::]") return "wildcard";
  const family = isIP(trimmed);
  if (family === 4) return v4Allowed(trimmed) ? "allowed" : "public";
  if (family === 6) return v6Allowed(trimmed) ? "allowed" : "public";
  return "public";
}

export interface ResolvedTeamAddress {
  /** Geprüfte Literal-Adresse (v4 oder v6) — wird für die Verbindung benutzt. */
  address: string;
}

export interface RejectedTeamAddress {
  error: TeamAddressError;
  message: string;
}

/** Auflösen und Prüfen eines Wähl-Ziels: Jede aufgelöste Adresse muss erlaubt
 * sein — löst ein Name auf mehrere Adressen auf, von denen eine öffentlich
 * ist, gilt das als Rebinding und wird abgelehnt (ADR-0118 §3). */
export async function resolveTeamAddress(
  host: string,
  port: number,
  lookupFn: (host: string, opts: { all: true; verbatim: true }) => Promise<{ address: string; family: number }[]> = lookup,
): Promise<ResolvedTeamAddress | RejectedTeamAddress> {
  const trimmed = host.trim();
  if (trimmed === "") return { error: "unresolvable", message: "Leere Adresse" };
  const literal = checkTeamAddressLiteral(trimmed);
  if (literal === "wildcard") return { error: "wildcard", message: `Wildcard-Adresse ${trimmed} ist als Wähl-Ziel verboten` };
  if (literal === "allowed") return { address: trimmed };
  const family = isIP(trimmed);
  if (family !== 0) return { error: "public_address", message: `Öffentliche Adresse ${trimmed} ist als Team-Ziel verboten` };
  let results: { address: string; family: number }[];
  try {
    results = await lookupFn(trimmed, { all: true, verbatim: true });
  } catch (err) {
    return { error: "unresolvable", message: `Name ${trimmed} löst nicht auf: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (results.length === 0) return { error: "unresolvable", message: `Name ${trimmed} löst nicht auf` };
  for (const r of results) {
    if (checkTeamAddressLiteral(r.address) !== "allowed") {
      return { error: "rebinding", message: `Name ${trimmed} löst auch auf ${r.address} auf — Rebinding-Schutz greift (ADR-0118 §3), Port ${port}` };
    }
  }
  return { address: results[0]!.address };
}

/** Bind-Adresse für `team.listen` (T83.2): Wildcard/öffentlich = Startfehler,
 *  Hostnames werden aufgelöst und jede Adresse geprüft. Wirft mit klarem
 *  Grund, damit main den Start verweigert (ADR-0118 §3). */
export async function teamListenBindAddress(
  address: string,
  port: number,
  lookupFn?: (host: string, opts: { all: true; verbatim: true }) => Promise<{ address: string; family: number }[]>,
): Promise<string> {
  const trimmed = address.trim();
  const literal = checkTeamAddressLiteral(trimmed);
  if (literal === "wildcard") {
    throw new Error(`team.listen: Wildcard-Adresse "${trimmed}" ist verboten — Start verweigert (ADR-0118 §3)`);
  }
  if (literal === "public") {
    const resolved = await resolveTeamAddress(trimmed, port, lookupFn);
    if ("error" in resolved) throw new Error(`team.listen: ${resolved.message} — Start verweigert (ADR-0118 §3)`);
    return resolved.address;
  }
  return trimmed;
}
