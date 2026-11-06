// @excellent-so/usage-cache — the one entry point.
//
// WHY THIS EXISTS: the Anthropic OAuth usage endpoint rate-limits PER TOKEN, and
// a dev box typically runs many clients sharing one Claude Code token against it
// — every `claude` session's statusline, a dev shell's prompt, a menu-bar meter.
// Each polling independently drains the token bucket, so they collectively sit in
// a 429 storm and the numbers they show go stale. This module makes them share:
//
//   • cache-first — within `ttlMs` every caller returns the cached reading and
//     touches no network at all.
//   • single-flight — when the cache IS stale, exactly one caller (the one that
//     wins an atomic file lock) hits the endpoint; the rest wait briefly for its
//     result and read the cache. N clients → ONE network read per interval.
//   • hold through 429 — a reading only goes stale, never wrong, until its 5h/7d
//     window resets, so a rate-limited read HOLDS the last good reading (flagged)
//     instead of collapsing to nothing.

"use strict";

const fs = require("node:fs");
const { readCache, writeCache, cacheFile, lockDir } = require("./lib/cache.js");
const { acquire, release } = require("./lib/lock.js");
const { fetchUsage } = require("./lib/fetch.js");
const { binding, expired } = require("./lib/parse.js");

const DEFAULT_TTL_MS = 60_000; // serve cache without a network read if younger than this
const STALE_MS = 15 * 60_000; // a held reading older than this reads as "last known"
const DEFAULT_WAIT_MS = 3_000; // if another proc is fetching, wait this long for its result
const DEFAULT_TIMEOUT_MS = 8_000; // network timeout for the one GET

function ageMs(entry, now) {
  return entry && Number.isFinite(entry.fetchedAt) ? now - entry.fetchedAt : null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Shape a stored cache entry into the public result object.
function toResult(entry, source, now, extra = {}) {
  const quota = (entry && entry.quota) || null;
  const a = ageMs(entry, now);
  return {
    ok: !!quota,
    quota,
    binding: binding(quota),
    fetchedAt: (entry && entry.fetchedAt) || null,
    ageMs: a,
    source, // "network" | "cache" | "cache-wait" | "none"
    stale: !!quota && (a == null || a > STALE_MS),
    expired: expired(quota, now),
    rateLimited: !!extra.rateLimited,
    lastStatus: (entry && entry.lastStatus) || null,
  };
}

function none() {
  return {
    ok: false,
    quota: null,
    binding: null,
    fetchedAt: null,
    ageMs: null,
    source: "none",
    stale: true,
    expired: false,
    rateLimited: false,
    lastStatus: null,
  };
}

// Wait for the lock holder to finish ONE attempt (ok / 429 / miss all stamp
// `lastAttemptAt`), then return the freshest cache. Poll-based so it works across
// separate processes, not just in-process promises.
async function waitForAttempt(dir, prevAttemptAt, waitMs) {
  const file = cacheFile(dir);
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    let entry = null;
    try {
      entry = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      /* not written yet */
    }
    if (entry && Number.isFinite(entry.lastAttemptAt) && entry.lastAttemptAt > prevAttemptAt) {
      return entry;
    }
    await sleep(80);
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// readUsage(opts) → Promise<Result>
//   opts: { ttlMs, waitMs, timeoutMs, force, offline, cacheDir, now,
//           credsFile, tokenReader, fetchImpl }  (last three are test seams)
async function readUsage(opts = {}) {
  const {
    ttlMs = DEFAULT_TTL_MS,
    waitMs = DEFAULT_WAIT_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    force = false,
    offline = false,
    cacheDir: dir,
    now = Date.now(),
    ...seams // credsFile, tokenReader, fetchImpl
  } = opts;

  const cache = readCache(dir);
  const usableCache = cache && cache.quota && !expired(cache.quota, now);

  // 1) Fresh enough — no network at all.
  if (!force && usableCache && ageMs(cache, now) < ttlMs) {
    return toResult(cache, "cache", now, { rateLimited: cache.lastStatus === "rate_limited" });
  }
  // 2) Offline — never touch the network; serve cache or nothing.
  if (offline) {
    return usableCache ? toResult(cache, "cache", now) : none();
  }

  const lock = lockDir(dir);
  // 3) Single-flight: only the lock holder hits the endpoint.
  if (acquire(lock, { staleMs: timeoutMs + 7_000, now })) {
    try {
      const r = await fetchUsage({ timeoutMs, ...seams });
      const at = Date.now();
      if (r.status === "ok") {
        const entry = { fetchedAt: at, quota: r.quota, lastStatus: "ok", lastAttemptAt: at };
        writeCache(entry, dir);
        return toResult(entry, "network", now, { rateLimited: false });
      }
      // 429 or miss — preserve the last good quota + its fetchedAt; only stamp
      // the attempt so waiters are released and we can flag "held / last known".
      const entry = cache
        ? { ...cache, lastStatus: r.status, lastAttemptAt: at }
        : { fetchedAt: null, quota: null, lastStatus: r.status, lastAttemptAt: at };
      writeCache(entry, dir);
      const rateLimited = r.status === "rate_limited";
      if (usableCache) return toResult(entry, "cache", now, { rateLimited });
      return { ...none(), rateLimited, lastStatus: r.status };
    } finally {
      release(lock);
    }
  }

  // 4) Another process is fetching — wait briefly for its result, then serve cache.
  const prevAttempt = (cache && cache.lastAttemptAt) || 0;
  const fresh = await waitForAttempt(dir, prevAttempt, waitMs);
  const c = fresh || cache;
  const use = c && c.quota && !expired(c.quota, now);
  return use
    ? toResult(c, "cache-wait", now, { rateLimited: c.lastStatus === "rate_limited" })
    : none();
}

module.exports = { readUsage, binding, expired, STALE_MS, DEFAULT_TTL_MS };
