// @excellent-so/usage-cache — single-flight lock via atomic mkdir.
//
// mkdir is atomic and fails with EEXIST if the directory already exists — so of
// N racing clients exactly one acquires the lock and does the network read; the
// rest wait on the cache. A lock older than `staleMs` is broken, so a crashed or
// killed holder can never wedge every client forever.

"use strict";

const fs = require("node:fs");
const path = require("node:path");

function writeMeta(lockDir, now) {
  try {
    fs.writeFileSync(path.join(lockDir, "meta"), JSON.stringify({ pid: process.pid, at: now }), "utf8");
  } catch {
    /* best-effort; staleness falls back to the dir mtime */
  }
}

function isStale(lockDir, staleMs, now) {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(lockDir, "meta"), "utf8"));
    if (Number.isFinite(meta.at)) return now - meta.at > staleMs;
  } catch {
    /* fall through to mtime */
  }
  try {
    return now - fs.statSync(lockDir).mtimeMs > staleMs;
  } catch {
    return true; // already gone
  }
}

function tryMkdir(lockDir, now) {
  fs.mkdirSync(lockDir, { recursive: false });
  writeMeta(lockDir, now);
  return true;
}

// → true if this caller now holds the lock. Never throws.
function acquire(lockDir, { staleMs = 15_000, now = Date.now() } = {}) {
  try {
    return tryMkdir(lockDir, now);
  } catch (e) {
    if (e && e.code === "EEXIST") {
      if (!isStale(lockDir, staleMs, now)) return false;
      // Break a dead holder's lock, then try exactly once more.
      try {
        fs.rmSync(lockDir, { recursive: true, force: true });
        return tryMkdir(lockDir, now);
      } catch {
        return false;
      }
    }
    // Parent dir missing (first run) → create it and retry once.
    try {
      fs.mkdirSync(path.dirname(lockDir), { recursive: true });
      return tryMkdir(lockDir, now);
    } catch {
      return false;
    }
  }
}

function release(lockDir) {
  try {
    fs.rmSync(lockDir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

module.exports = { acquire, release, isStale };
