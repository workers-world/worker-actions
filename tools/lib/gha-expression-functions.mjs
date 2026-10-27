/**
 * Detect unsupported GitHub Actions expression function calls in workflow YAML.
 * GHA supports contains/startsWith/endsWith/format/join/toJSON/fromJSON/hashFiles/case/status checks —
 * not `matches()`. Using matches() in job/step `if:` fails evaluation and skips release jobs.
 */

/** @param {string} source workflow YAML text */
export function findUnsupportedMatchesCalls(source) {
  const findings = [];
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Strip full-line and trailing `#` comments (YAML; ignore `#` inside single-quoted strings roughly).
    const code = stripYamlComment(line);
    if (!/\bmatches\s*\(/.test(code)) continue;
    findings.push({ line: i + 1, text: line.trimEnd() });
  }
  return findings;
}

/** @param {string} line */
function stripYamlComment(line) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (ch === '#' && !inSingle && !inDouble) {
      return line.slice(0, i);
    }
  }
  return line;
}
