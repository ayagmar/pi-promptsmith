// Runs the release workflow's shell steps the way GitHub Actions does (`bash -eo pipefail`),
// so a step that ends on a failing test cannot turn a successful release red.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflow = join(root, ".github/workflows/release.yml");

async function readStepScript(stepName: string): Promise<string> {
  const lines = (await readFile(workflow, "utf8")).split("\n");
  const start = lines.findIndex((line) => line.trim() === `- name: ${stepName}`);
  assert.notEqual(start, -1, `step "${stepName}" not found`);
  const runLine = lines.findIndex((line, index) => index > start && /^\s+run: \|\s*$/.test(line));
  assert.notEqual(runLine, -1, `step "${stepName}" has no run block`);
  const indent = (lines[runLine] ?? "").search(/\S/);
  const body: string[] = [];
  for (const line of lines.slice(runLine + 1)) {
    if (line.trim() !== "" && line.search(/\S/) <= indent) break;
    body.push(line.slice(indent + 2));
  }
  // Stand-in for GitHub expressions, which are substituted before the shell runs.
  return body.join("\n").replace(/\$\{\{[^}]*\}\}/g, "x");
}

for (const dryRun of ["true", "false"]) {
  void test(`release Summary step succeeds when DRY_RUN=${dryRun}`, {
    skip: process.platform === "win32",
  }, async () => {
    const script = await readStepScript("Summary");
    const dir = await mkdtemp(join(tmpdir(), "pi-release-summary-"));
    try {
      const summary = join(dir, "summary.md");
      const result = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", script], {
        env: { ...process.env, DRY_RUN: dryRun, GITHUB_STEP_SUMMARY: summary },
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr);
      const written = await readFile(summary, "utf8");
      assert.equal(written.includes("Dry run"), dryRun === "true");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}
