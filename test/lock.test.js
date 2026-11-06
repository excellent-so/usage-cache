"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { acquire, release, isStale } = require("../lib/lock.js");

function tmpLock() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uc-lock-"));
  return path.join(dir, "fetch.lock");
}

test("only one of many acquirers wins; release lets the next in", () => {
  const lock = tmpLock();
  const now = 1_000_000;
  assert.equal(acquire(lock, { now }), true, "first acquires");
  assert.equal(acquire(lock, { now }), false, "second is blocked");
  assert.equal(acquire(lock, { now }), false, "third is blocked");
  assert.equal(release(lock), true);
  assert.equal(acquire(lock, { now }), true, "acquirable again after release");
  release(lock);
});

test("a stale lock (dead holder) is broken and re-acquired", () => {
  const lock = tmpLock();
  const t0 = 1_000_000;
  assert.equal(acquire(lock, { now: t0, staleMs: 15_000 }), true);
  // A fresh contender at t0+5s is still blocked...
  assert.equal(acquire(lock, { now: t0 + 5_000, staleMs: 15_000 }), false);
  // ...but 20s later the holder is presumed dead → lock is broken and taken.
  assert.equal(isStale(lock, 15_000, t0 + 20_000), true);
  assert.equal(acquire(lock, { now: t0 + 20_000, staleMs: 15_000 }), true);
  release(lock);
});

test("acquire creates a missing parent directory on first run", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "uc-lock-"));
  const lock = path.join(base, "nested", "deeper", "fetch.lock");
  assert.equal(acquire(lock, { now: 1 }), true);
  assert.ok(fs.existsSync(lock));
  release(lock);
});
