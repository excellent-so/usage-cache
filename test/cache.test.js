"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { readCache, writeCache, cacheFile, lockDir } = require("../lib/cache.js");

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "uc-cache-"));
}

test("write then read round-trips the entry", () => {
  const dir = tmpDir();
  const entry = { fetchedAt: 123, quota: { fiveHour: { pct: 34 } }, lastStatus: "ok", lastAttemptAt: 123 };
  assert.equal(writeCache(entry, dir), true);
  assert.deepEqual(readCache(dir), entry);
});

test("reading a missing / corrupt cache returns null, never throws", () => {
  const dir = tmpDir();
  assert.equal(readCache(dir), null); // nothing written yet
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(cacheFile(dir), "{ not json", "utf8");
  assert.equal(readCache(dir), null);
});

test("cacheFile and lockDir are siblings under the cache dir", () => {
  const dir = tmpDir();
  assert.equal(path.dirname(cacheFile(dir)), dir);
  assert.equal(path.dirname(lockDir(dir)), dir);
  assert.notEqual(cacheFile(dir), lockDir(dir));
});
