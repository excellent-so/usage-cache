// @excellent-so/usage-cache — the shared on-disk cache (atomic).
//
// Every client on the box agrees on ONE cache path, so they read a single cached
// reading instead of each hitting the endpoint. Override the location with
// $EXCELLENT_USAGE_CACHE_DIR (tests point it at a temp dir).

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function cacheDir(override) {
  if (override) return override;
  if (process.env.EXCELLENT_USAGE_CACHE_DIR) return process.env.EXCELLENT_USAGE_CACHE_DIR;
  const base = process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
  return path.join(base, "excellent-usage-cache");
}

function cacheFile(override) {
  return path.join(cacheDir(override), "usage.json");
}

function lockDir(override) {
  return path.join(cacheDir(override), "fetch.lock");
}

function readCache(override) {
  try {
    return JSON.parse(fs.readFileSync(cacheFile(override), "utf8"));
  } catch {
    return null;
  }
}

// Atomic write: a per-pid temp file + rename (rename is atomic on the same fs),
// so a concurrent reader never sees a half-written JSON.
function writeCache(entry, override) {
  try {
    fs.mkdirSync(cacheDir(override), { recursive: true });
    const file = cacheFile(override);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(entry), "utf8");
    fs.renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}

module.exports = { cacheDir, cacheFile, lockDir, readCache, writeCache };
