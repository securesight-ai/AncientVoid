import { describe, expect, it } from "vitest";
import { applySuggestion, commandsForScope, slashNotice, slashSuggestions, type SlashCommand } from "../../../src/features/composer/slash.ts";

const cmds: readonly SlashCommand[] = [
  { name: "/clear", description: "leeren", scope: "both" },
  { name: "/compact", description: "komprimieren", scope: "both" },
  { name: "/new", description: "neu", scope: "start" },
  { name: "/tokens", description: "Tokens", scope: "start" },
];

describe("slash layer (ADR-0042, EPIC-P25 T25.4)", () => {
  it("scope-Filter: Neu-Session sieht start+both, Antwort nur steer+both", () => {
    expect(commandsForScope(cmds, "start").map((c) => c.name)).toEqual(["/clear", "/compact", "/new", "/tokens"]);
    expect(commandsForScope(cmds, "steer").map((c) => c.name)).toEqual(["/clear", "/compact"]);
    expect(commandsForScope(undefined, "start")).toEqual([]);
  });

  it("Vorschläge nur beim ersten /-Wort ohne Leerzeichen, Präfix-Treffer", () => {
    expect(slashSuggestions("/c", cmds).map((c) => c.name)).toEqual(["/clear", "/compact"]);
    expect(slashSuggestions("/compact", cmds).map((c) => c.name)).toEqual(["/compact"]);
    expect(slashSuggestions("/compact hallo", cmds)).toEqual([]);
    expect(slashSuggestions("text /clear", cmds)).toEqual([]);
    expect(slashSuggestions("", cmds)).toEqual([]);
  });

  it("Hinweis erst nach vollständigem ersten Wort, nur wenn nicht gemeldet", () => {
    expect(slashNotice("/compact", cmds)).toBeNull();
    expect(slashNotice("/compact bitte", cmds)).toBeNull();
    expect(slashNotice("/foo bar", cmds)).toBe("/foo ist nicht als Command gemeldet — der Text geht als normaler Prompt.");
    expect(slashNotice("normaler text", cmds)).toBeNull();
  });

  it("Adapter ohne Commands meldet das ehrlich statt still zu senden", () => {
    expect(slashNotice("/clear jetzt", [])).toBe("Dieser Adapter meldet keine /Commands — der Text geht als normaler Prompt.");
  });

  it("Übernehmen ersetzt das erste Wort und erhält den Rest", () => {
    expect(applySuggestion("/comp", cmds[1]!)).toBe("/compact ");
    expect(applySuggestion("/c mit Anleitung", cmds[1]!)).toBe("/compact mit Anleitung ");
  });
});


it("reports reserved /compact as unavailable when this adapter or scope has no command", () => {
  expect(slashNotice("/compact", [])).toBe("/compact is unavailable here.");
  expect(slashNotice(" /compact focus", [])).toBe("/compact is unavailable here.");
});
