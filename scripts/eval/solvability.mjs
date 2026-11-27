// P84: Der Abnahmetest bleibt versteckt. Fair ist eine Aufgabe nur, wenn ihr Text jeden Namen nennt,
// den erst die Lösung einführt und den dieser Test benutzt. Geprüft werden Namen, nicht das Verhalten.
import { execFileSync } from "node:child_process";
import { posix } from "node:path";

const SOURCES = ["--", "apps", "packages", ":(exclude)*test*"];
const NAME = /\b[A-Za-z_][A-Za-z0-9_]{3,}(?::[a-z0-9_]+)*/g;
const COMMENT_OR_STRING = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/g;
const TEST_CASE = /^(\s*)(?:it|test)(?:\.\w+)?\(\s*(["'`])((?:\\.|(?!\2).)*)\2/;

/** Die Testdatei ohne die Testfälle, die der Selektor nicht auswählt; Helfer und Aufbau bleiben. */
export function selectedSource(source, selector) {
  const pattern = new RegExp(selector);
  const lines = source.split("\n");
  const kept = [];
  let selected = 0;
  for (let i = 0; i < lines.length; i++) {
    const match = TEST_CASE.exec(lines[i]);
    if (!match) { kept.push(lines[i]); continue; }
    let end = i;
    if (!/\}.*\);\s*$/.test(lines[i])) {
      const closing = new RegExp(`^${match[1]}\\}.*\\);?\\s*$`);
      do end++; while (end < lines.length - 1 && !closing.test(lines[end]));
    }
    if (pattern.test(match[3])) { selected++; kept.push(...lines.slice(i, end + 1)); }
    i = end;
  }
  if (!selected) throw new Error(`Selector matches no test case: ${selector}`);
  return kept.join("\n");
}

/** Bezeichner aus dem Code; aus Zeichenketten nur schlüsselartige (mit `_` oder `:`), aus Kommentaren nichts. */
export function testNames(source) {
  const strings = [];
  const code = source.replace(COMMENT_OR_STRING, (part) => {
    if (!part.startsWith("/")) strings.push(part);
    return " ";
  });
  const keys = strings.flatMap((part) => part.replaceAll(/\\[nrt]/g, " ").match(NAME) ?? []).filter((name) => /[_:]/.test(name));
  return new Set([...(code.match(NAME) ?? []), ...keys]);
}

/** Namen (und bei neuen Exporten deren Datei), die der Aufgabentext verschweigt. */
export function unnamed(root, task) {
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 1 << 26 });
  const source = selectedSource(git("show", `${task.reference}:${task.test}`), task.selector);
  const added = git("diff", "--unified=0", task.start, task.reference, ...SOURCES)
    .split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++")).join("\n");
  const introduced = new Set(added.match(NAME) ?? []);
  const existsAtStart = (name) => {
    try {
      git("grep", "-qwF", "-e", name, task.start, ...SOURCES);
      return true;
    } catch (error) {
      if (error.status !== 1) throw error;
      return false;
    }
  };
  const names = [...testNames(source)].filter((name) => introduced.has(name) && !existsAtStart(name));
  const imports = [...source.matchAll(/(?:import\s*\{([^}]*)\}\s*from\s*|\{([^}]*)\}\s*=\s*await import\()["'](\.[^"']+)["']/g)];
  const files = imports
    .filter((match) => (match[1] ?? match[2]).split(",").some((part) => names.includes(part.trim().split(/\s/)[0])))
    .map((match) => posix.basename(match[3]));
  return [...new Set([...names, ...files])].filter((name) => !task.prompt.includes(name));
}
