import { describe, expect, it, afterEach, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

describe("commands for another host (T6.6)", async () => {
  const { onHost } = await import("../../../src/features/session/HostCommands.tsx");
  it("wraps a remote command in ssh, leaves this hub's alone", () => {
    expect(onHost("cd /w && opencode --session s1", "home-server")).toBe("ssh -t home-server 'cd /w && opencode --session s1'");
    expect(onHost("tmux attach -t ancientvoid-x", null)).toBe("tmux attach -t ancientvoid-x");
    expect(onHost("echo 'x'", "h")).toBe(`ssh -t h 'echo '\\''x'\\'''`);
  });
});

describe("continueSessionLink (BUG-0249)", async () => {
  const { continueSessionLink } = await import("../../../src/features/session/HostCommands.tsx");
  it("baut den Session-Deep-Link aus der ID, nicht aus location.href", () => {
    vi.stubGlobal("location", { origin: "http://hub.example", href: "http://hub.example/#/" });
    expect(continueSessionLink("abc")).toBe("http://hub.example/#/sessions/abc");
    expect(continueSessionLink("abc", "peer-1")).toBe("http://hub.example/#/hosts/peer-1/sessions/abc");
  });
});
