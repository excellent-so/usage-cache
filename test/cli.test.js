"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { writeCache } = require("../lib/cache.js");
const { explain } = require("../lib/explain.js");

const CLI = path.join(__dirname, "..", "bin", "cli.js");
const reset = () => Date.now() + 3_600_000;

// --offline everywhere: these runs never read a token or call the endpoint.
function run(args, quota) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uc-cli-"));
  if (quota) writeCache({ fetchedAt: Date.now(), lastAttemptAt: Date.now(), lastStatus: "ok", quota }, dir);
  return spawnSync(process.execPath, [CLI, ...args], {
    env: { PATH: process.env.PATH, HOME: dir, EXCELLENT_USAGE_CACHE_DIR: dir },
    encoding: "utf8",
  });
}

const both = {
  fiveHour: { pct: 34, resetsAt: reset(), severity: "normal" },
  sevenDay: { pct: 61, resetsAt: reset(), severity: "normal" },
  scoped: [{ label: "Opus", pct: 80, resetsAt: reset(), severity: "normal" }],
};
const weeklyOnly = { fiveHour: null, sevenDay: { pct: 43, resetsAt: reset(), severity: "normal" }, scoped: [] };

test("statusline: 5-hour and weekly", () => {
  assert.equal(run(["--offline", "--statusline"], both).stdout, "34% (5h) · wk 61%\n");
});

test("statusline: no 5-hour figure shows the weekly one once, labelled", () => {
  const r = run(["--offline", "--statusline"], weeklyOnly);
  assert.equal(r.stdout, "43% (wk)\n");
  assert.equal(run(["--offline"], weeklyOnly).stdout, "43%\n");
});

test("statusline --binding labels the window the headline came from", () => {
  assert.equal(run(["--offline", "--statusline", "--binding"], both).stdout, "80% (Opus) · wk 61%\n");
  const weeklyHot = { ...both, scoped: [], sevenDay: { pct: 90, resetsAt: reset(), severity: "normal" } };
  assert.equal(run(["--offline", "--statusline", "--binding"], weeklyHot).stdout, "90% (wk)\n");
});

test("no reading prints - and exits 0, with no stderr when not at a terminal", () => {
  const r = run(["--offline", "--statusline"]);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "-\n");
  assert.equal(r.stderr, "");
});

test("an unknown option exits 2 with one sentence", () => {
  const r = run(["--bogus"]);
  assert.equal(r.status, 2);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, 'usage-cache: unknown option "--bogus". Run usage-cache --help to see the options.\n');
});

test("a bad --ttl or --wait value exits 2 with one sentence", () => {
  for (const args of [["--ttl", "abc"], ["--ttl"], ["--wait", "-1"]]) {
    const r = run(["--offline", ...args]);
    assert.equal(r.status, 2, args.join(" "));
    assert.match(r.stderr, /^usage-cache: --(ttl|wait) needs a number, for example --(ttl 30|wait 3000)\.\n$/);
  }
});

test("explain() has a sentence for each reason a read can fail", () => {
  for (const reason of ["no-token", "keychain-timeout", "http-401", "http-429", "http-503", "network", "empty", "cache-dir", "no-cache", "busy"]) {
    const why = explain({ ok: false, reason });
    assert.equal(typeof why, "string", reason);
    assert.ok(!why.includes("\n"), `${reason}: one line`);
  }
  assert.equal(explain({ ok: true, reason: null }), null);
});
