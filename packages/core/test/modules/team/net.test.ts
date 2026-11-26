import { describe, expect, it } from "vitest";
import { checkTeamAddressLiteral, resolveTeamAddress, teamListenBindAddress } from "../../../src/modules/team/net.ts";

/** EPIC-P83 T83.2 (ADR-0118 §3): Adressprüfung — Loopback, RFC 1918, CGNAT, ULA;
 *  Wildcard und öffentlich sind Startfehler; DNS-Rebinding wird abgewiesen. */

type FakeLookup = (host: string, opts: { all: true; verbatim: true }) => Promise<{ address: string; family: number }[]>;

describe("EPIC-P83 T83.2 — Adressprüfung (ADR-0118 §3)", () => {
  it("erlaubt: Loopback, RFC 1918, CGNAT 100.64.0.0/10, fc00::/7", () => {
    for (const allowed of ["127.0.0.1", "127.8.8.8", "::1", "10.0.0.5", "10.255.255.255", "172.16.0.1", "172.31.255.254", "192.168.1.20", "100.64.0.1", "100.127.255.254", "fd00::1", "fdab:1234::", "fc00::", "fdff:ffff::ffff"]) {
      expect(checkTeamAddressLiteral(allowed), allowed).toBe("allowed");
    }
  });

  it("verbietet: Wildcard in allen Schreibweisen", () => {
    for (const wildcard of ["0.0.0.0", "::", "*"]) {
      expect(checkTeamAddressLiteral(wildcard), wildcard).toBe("wildcard");
    }
  });

  it("verbietet: öffentliche v4/v6 und dokumentierte Bereiche", () => {
    for (const pub of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "192.169.0.1", "100.128.0.1", "2001:db8::1", "2606:4700::1", "fe80::1", "beispiel.hoster.de"]) {
      expect(checkTeamAddressLiteral(pub), pub).toBe("public");
    }
  });

  it("IPv4-mapped IPv6 wird wie IPv4 geprüft", () => {
    expect(checkTeamAddressLiteral("::ffff:127.0.0.1")).toBe("allowed");
    expect(checkTeamAddressLiteral("::ffff:8.8.8.8")).toBe("public");
  });

  it("resolveTeamAddress: Literal geht direkt durch, öffentliches Literal wird abgelehnt", async () => {
    expect(await resolveTeamAddress("10.1.2.3", 7001)).toEqual({ address: "10.1.2.3" });
    const rejected = await resolveTeamAddress("8.8.8.8", 7001);
    expect("error" in rejected && rejected.error).toBe("public_address");
  });

  it("DNS-Rebinding: löst ein Name zusätzlich auf eine öffentliche Adresse, wird er abgelehnt", async () => {
    const lookup: FakeLookup = async () => [
      { address: "10.0.0.7", family: 4 },
      { address: "8.8.8.8", family: 4 },
    ];
    const rejected = await resolveTeamAddress("peer.example.internal", 7001, lookup);
    expect("error" in rejected && rejected.error).toBe("rebinding");
    expect("error" in rejected && rejected.message).toContain("8.8.8.8");
  });

  it("Auflösung liefert die geprüfte erste Adresse (kein blindes Vertrauen auf den Namen)", async () => {
    const lookup: FakeLookup = async () => [
      { address: "10.0.0.7", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ];
    expect(await resolveTeamAddress("peer.example.internal", 7001, lookup)).toEqual({ address: "10.0.0.7" });
  });

  it("teamListenBindAddress: Wildcard und öffentliche Adresse sind Startfehler", async () => {
    await expect(teamListenBindAddress("0.0.0.0", 7001)).rejects.toThrow(/Wildcard/);
    await expect(teamListenBindAddress("::", 7002)).rejects.toThrow(/Wildcard/);
    const lookupPublic: FakeLookup = async () => [{ address: "203.0.113.5", family: 4 }];
    await expect(teamListenBindAddress("hub.example.net", 7003, lookupPublic)).rejects.toThrow(/Start verweigert/);
  });

  it("teamListenBindAddress: erlaubtes Literal und privater Hostname kommen durch", async () => {
    expect(await teamListenBindAddress("127.0.0.1", 7004)).toBe("127.0.0.1");
    const lookup: FakeLookup = async () => [{ address: "100.72.0.9", family: 4 }];
    expect(await teamListenBindAddress("hub.tailnet.name", 7005, lookup)).toBe("100.72.0.9");
  });
});
