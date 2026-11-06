#!/usr/bin/env node
// Independence gate: `npm run test:standalone`.
//
// Runs the real CLI (bin/cli.js) the way it would run on a machine that has
// never seen this repo:
//
//   - HOME is a fresh temp dir, with only a fake ~/.claude/.credentials.json
//   - PATH is node's own bin dir plus /usr/bin:/bin
//   - the environment starts empty, so no EXCELLENT_*, XDG_* or NODE_OPTIONS
//     value from this shell reaches the CLI
//   - scripts/standalone-preload.cjs swaps in a fake endpoint and refuses every
//     child process, so the macOS Keychain is never read
//
// It never makes a network call and never touches the real token. Temp dirs go
// under os.tmpdir(); set TMPDIR to put them somewhere else. Pass --keep to leave
// the temp dir in place after a pass (it is always kept after a failure).

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, "..", "bin", "cli.js");
const preload = path.join(here, "standalone-preload.cjs");
const keep = process.argv.includes("--keep");

const work = fs.mkdtempSync(path.join(os.tmpdir(), "usage-cache-standalone-"));
const home = path.join(work, "home");
const childTmp = path.join(work, "tmp");
const callLog = path.join(work, "calls.jsonl");
const cacheFile = path.join(home, ".cache", "excellent-usage-cache", "usage.json");
const lockDir = path.join(home, ".cache", "excellent-usage-cache", "fetch.lock");

const FAKE_TOKEN = "standalone-fake-token";
fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
fs.mkdirSync(childTmp);
fs.writeFileSync(
  path.join(home, ".claude", ".credentials.json"),
  JSON.stringify({ claudeAiOauth: { accessToken: FAKE_TOKEN, expiresAt: Date.now() + 3_600_000 } }),
  { mode: 0o600 },
);

const env = {
  HOME: home,
  PATH: [path.dirname(process.execPath), "/usr/bin", "/bin"].join(path.delimiter),
  TMPDIR: childTmp,
  USAGE_CACHE_STANDALONE_LOG: callLog,
  USAGE_CACHE_STANDALONE_TOKEN: FAKE_TOKEN,
};

let failures = 0;
let passes = 0;
function check(ok, label, detail) {
  if (ok) {
    passes++;
    console.log(`ok - ${label}`);
  } else {
    failures++;
    console.log(`not ok - ${label}${detail === undefined ? "" : `: ${detail}`}`);
  }
}

function run(args) {
  return spawnSync(process.execPath, ["--require", preload, cli, ...args], {
    env,
    cwd: work,
    encoding: "utf8",
    timeout: 20_000,
  });
}

function calls() {
  try {
    return fs
      .readFileSync(callLog, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

check(
  !Object.keys(env).some((k) => k.startsWith("EXCELLENT_") || k.startsWith("XDG_")),
  "child env has no EXCELLENT_* or XDG_* variables",
);

// Run 1: cold cache, so the CLI reads the (fake) endpoint once and writes the cache.
const first = run(["--json"]);
check(first.status === 0, "first run (--json) exits 0", `status ${first.status}, stderr ${first.stderr}`);
const result = (() => {
  try {
    return JSON.parse(first.stdout);
  } catch {
    return null;
  }
})();
check(result && result.ok === true, "first run reports ok: true", first.stdout);
check(result && result.source === "network", "first run read the fake endpoint", result && result.source);
check(result && result.quota && result.quota.fiveHour && result.quota.fiveHour.pct === 34, "first run returns the fake 34%");

const cache = readJson(cacheFile);
check(cache !== null, "cache file written under the temp HOME", cacheFile);
check(
  cache && cache.lastStatus === "ok" && cache.quota && cache.quota.fiveHour && cache.quota.fiveHour.pct === 34,
  "cache holds the fake reading",
);
check(!fs.existsSync(lockDir), "fetch lock released");

const afterFirst = calls();
const fetches = afterFirst.filter((c) => c.event === "fetch");
check(fetches.length === 1, "exactly one fetch", `${fetches.length} fetches`);
check(fetches.every((c) => c.url === "https://api.anthropic.com/api/oauth/usage"), "fetch went to the usage URL (faked)");
check(fetches.every((c) => c.tokenMatches), "fetch used the fake token from the temp HOME");
check(fetches.every((c) => c.beta === "oauth-2025-04-20"), "fetch sent the oauth-2025-04-20 beta header");
check(!afterFirst.some((c) => c.event === "socket-refused"), "no socket was opened");
const spawns = afterFirst.filter((c) => c.event === "spawn-refused");
if (process.platform === "darwin") {
  check(
    spawns.length === 1 && spawns[0].file === "/usr/bin/security",
    "Keychain lookup was attempted once and refused (fell back to the file)",
    JSON.stringify(spawns),
  );
} else {
  check(spawns.length === 0, "no child process was started", JSON.stringify(spawns));
}

// Run 2: warm cache, so the CLI must answer without another fetch.
const second = run(["--statusline"]);
check(second.status === 0, "second run (--statusline) exits 0", `status ${second.status}, stderr ${second.stderr}`);
check(second.stdout === "34% (5h) · wk 61%\n", "second run prints the cached statusline", JSON.stringify(second.stdout));
check(calls().filter((c) => c.event === "fetch").length === 1, "second run made no fetch (served from cache)");

if (failures === 0) {
  console.log(`\nstandalone: PASS (${passes} checks)`);
  if (keep) console.log(`kept ${work}`);
  else fs.rmSync(work, { recursive: true, force: true });
  process.exit(0);
}
console.log(`\nstandalone: FAIL (${failures} of ${passes + failures} checks failed)`);
console.log(`kept ${work}`);
process.exit(1);
