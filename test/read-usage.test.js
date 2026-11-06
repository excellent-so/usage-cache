"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { readUsage } = require("../index.js");
const { writeCache } = require("../lib/cache.js");

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "uc-read-"));
}

const FUTURE = () => new Date(Date.now() + 3_600_000).toISOString();
const PAST = () => new Date(Date.now() - 3_600_000).toISOString();

// A fake fetch that counts calls and returns a usable payload after `delayMs`.
function countingFetch(delayMs, pct = 34) {
  const state = { calls: 0 };
  const impl = async () => {
    state.calls++;
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        limits: [
          { kind: "session", percent: pct, resets_at: FUTURE() },
          { kind: "weekly_all", percent: 61, resets_at: FUTURE() },
        ],
      }),
    };
  };
  return { impl, state };
}

const TOKEN = async () => ({ token: "test-token", expiresAt: null });

test("SINGLE-FLIGHT: 20 concurrent callers make exactly ONE network read", async () => {
  const dir = tmpDir();
  const { impl, state } = countingFetch(150);

  const results = await Promise.all(
    Array.from({ length: 20 }, () =>
      readUsage({ cacheDir: dir, tokenReader: TOKEN, fetchImpl: impl, ttlMs: 60_000, waitMs: 5_000 }),
    ),
  );

  assert.equal(state.calls, 1, "the endpoint was hit exactly once for 20 callers");
  for (const r of results) {
    assert.equal(r.ok, true);
    assert.equal(r.quota.fiveHour.pct, 34);
  }
  // One winner read it off the network; everyone else got it from the shared cache.
  const network = results.filter((r) => r.source === "network").length;
  const shared = results.filter((r) => r.source === "cache-wait" || r.source === "cache").length;
  assert.equal(network, 1, "one caller was the network reader");
  assert.equal(shared, 19, "the other 19 read the shared cache");
});

test("TTL: a fresh cache serves every caller with NO network read", async () => {
  const dir = tmpDir();
  writeCache(
    { fetchedAt: Date.now(), quota: { fiveHour: { pct: 42, resetsAt: Date.parse(FUTURE()) }, sevenDay: null, scoped: [] }, lastStatus: "ok", lastAttemptAt: Date.now() },
    dir,
  );
  const { impl, state } = countingFetch(0);

  const r = await readUsage({ cacheDir: dir, tokenReader: TOKEN, fetchImpl: impl, ttlMs: 60_000 });
  assert.equal(state.calls, 0, "no network read while the cache is fresh");
  assert.equal(r.source, "cache");
  assert.equal(r.quota.fiveHour.pct, 42);
});

test("HOLD-THROUGH-429: a rate-limited read keeps the last good reading, flagged", async () => {
  const dir = tmpDir();
  // Seed a good-but-old reading (older than TTL so we WILL try the network).
  const old = Date.now() - 5 * 60_000;
  writeCache(
    { fetchedAt: old, quota: { fiveHour: { pct: 30, resetsAt: Date.parse(FUTURE()) }, sevenDay: null, scoped: [] }, lastStatus: "ok", lastAttemptAt: old },
    dir,
  );
  const rateLimited = async () => ({ ok: false, status: 429, json: async () => ({}) });

  const r = await readUsage({ cacheDir: dir, tokenReader: TOKEN, fetchImpl: rateLimited, ttlMs: 60_000 });
  assert.equal(r.ok, true, "still has a usable reading");
  assert.equal(r.quota.fiveHour.pct, 30, "held the last good %");
  assert.equal(r.rateLimited, true, "flagged as rate-limited");
  assert.equal(r.source, "cache");
});

test("STALE: a held reading older than 15 min is flagged stale (the ~ in the UI)", async () => {
  const dir = tmpDir();
  const now = 10_000_000_000;
  writeCache(
    { fetchedAt: now - 20 * 60_000, quota: { fiveHour: { pct: 30, resetsAt: now + 3_600_000 }, sevenDay: null, scoped: [] }, lastStatus: "rate_limited", lastAttemptAt: now - 20 * 60_000 },
    dir,
  );
  const r = await readUsage({ cacheDir: dir, tokenReader: TOKEN, offline: true, now });
  assert.equal(r.stale, true, "20-min-old held reading reads as last-known");
  assert.equal(r.quota.fiveHour.pct, 30);
});

test("EXPIRED CACHE + miss: window has reset and the network misses → no usable reading", async () => {
  const dir = tmpDir();
  writeCache(
    { fetchedAt: Date.now() - 60_000, quota: { fiveHour: { pct: 30, resetsAt: Date.parse(PAST()) }, sevenDay: null, scoped: [] }, lastStatus: "ok", lastAttemptAt: Date.now() - 60_000 },
    dir,
  );
  const miss = async () => ({ ok: false, status: 500, json: async () => ({}) });
  const r = await readUsage({ cacheDir: dir, tokenReader: TOKEN, fetchImpl: miss });
  assert.equal(r.ok, false, "expired window + miss → nothing usable");
  assert.equal(r.source, "none");
});

test("force: bypasses a fresh cache and re-reads (still single-flight)", async () => {
  const dir = tmpDir();
  writeCache(
    { fetchedAt: Date.now(), quota: { fiveHour: { pct: 10, resetsAt: Date.parse(FUTURE()) }, sevenDay: null, scoped: [] }, lastStatus: "ok", lastAttemptAt: Date.now() },
    dir,
  );
  const { impl, state } = countingFetch(0, 77);
  const r = await readUsage({ cacheDir: dir, tokenReader: TOKEN, fetchImpl: impl, force: true });
  assert.equal(state.calls, 1, "force ignores the fresh cache");
  assert.equal(r.quota.fiveHour.pct, 77);
  assert.equal(r.source, "network");
});

test("SINGLE-FLIGHT RACE: a read that lands between our cache read and our lock is reused, not repeated", async () => {
  const dir = tmpDir();
  const old = Date.now() - 5 * 60_000;
  writeCache(
    { fetchedAt: old, quota: { fiveHour: { pct: 30, resetsAt: Date.parse(FUTURE()) }, sevenDay: null, scoped: [] }, lastStatus: "ok", lastAttemptAt: old },
    dir,
  );
  // Simulate another process that finished its read and released the lock
  // just before this caller takes it.
  const lock = require("../lib/lock.js");
  const realAcquire = lock.acquire;
  lock.acquire = (...args) => {
    const at = Date.now();
    writeCache(
      { fetchedAt: at, quota: { fiveHour: { pct: 55, resetsAt: Date.parse(FUTURE()) }, sevenDay: null, scoped: [] }, lastStatus: "ok", lastAttemptAt: at },
      dir,
    );
    return realAcquire(...args);
  };
  try {
    const { impl, state } = countingFetch(0, 99);
    const r = await readUsage({ cacheDir: dir, tokenReader: TOKEN, fetchImpl: impl, ttlMs: 60_000 });
    assert.equal(state.calls, 0, "no second request");
    assert.equal(r.quota.fiveHour.pct, 55, "the other process's reading");
    assert.equal(fs.existsSync(path.join(dir, "fetch.lock")), false, "lock released");
  } finally {
    lock.acquire = realAcquire;
  }
});

test("REASON: a failed read says why, in the result and for waiters", async () => {
  const dir = tmpDir();
  const unauthorized = async () => ({ ok: false, status: 401, json: async () => ({}) });
  const r = await readUsage({ cacheDir: dir, tokenReader: TOKEN, fetchImpl: unauthorized });
  assert.equal(r.ok, false);
  assert.equal(r.lastStatus, "miss");
  assert.equal(r.reason, "http-401");

  const noToken = await readUsage({ cacheDir: tmpDir(), tokenReader: async () => null, fetchImpl: unauthorized });
  assert.equal(noToken.reason, "no-token");

  const timedOut = await readUsage({
    cacheDir: tmpDir(),
    tokenReader: async () => ({ token: null, reason: "keychain-timeout" }),
    fetchImpl: unauthorized,
  });
  assert.equal(timedOut.reason, "keychain-timeout");

  const limited = await readUsage({ cacheDir: tmpDir(), tokenReader: TOKEN, fetchImpl: async () => ({ ok: false, status: 429 }) });
  assert.equal(limited.rateLimited, true);
  assert.equal(limited.reason, "http-429");

  const offline = await readUsage({ cacheDir: tmpDir(), offline: true });
  assert.equal(offline.reason, "no-cache");
});

test("REASON: a good read clears the last failure's reason", async () => {
  const dir = tmpDir();
  await readUsage({ cacheDir: dir, tokenReader: TOKEN, fetchImpl: async () => ({ ok: false, status: 503 }) });
  const { impl } = countingFetch(0, 20);
  const r = await readUsage({ cacheDir: dir, tokenReader: TOKEN, fetchImpl: impl });
  assert.equal(r.ok, true);
  assert.equal(r.reason, null);
});

test("UNWRITABLE CACHE: says so at once instead of waiting on a lock nobody holds", async () => {
  const parent = tmpDir();
  const file = path.join(parent, "not-a-dir");
  fs.writeFileSync(file, "x");
  const { impl, state } = countingFetch(0);
  const t0 = Date.now();
  const r = await readUsage({ cacheDir: path.join(file, "cache"), tokenReader: TOKEN, fetchImpl: impl, waitMs: 3_000 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "cache-dir");
  assert.equal(state.calls, 0, "no uncached request");
  assert.ok(Date.now() - t0 < 1_000, "did not wait out waitMs");
});
