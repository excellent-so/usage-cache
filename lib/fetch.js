// @excellent-so/usage-cache — the one read-only GET (never throws).
//
// A NARROW amendment to a zero-network posture: ONE read-only GET, to Anthropic
// only (the vendor already holding this data); nothing is sent beyond the auth
// header; no third party. Returns a tagged result so the caller can tell a 429
// (token bucket exhausted — HOLD the last reading) apart from a genuine miss.

"use strict";

const { parseUsage } = require("./parse.js");
const { readOAuthToken } = require("./token.js");

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";

// Returns one of:
//   { status: "ok", quota }             a parsed, usable reading
//   { status: "rate_limited" }          HTTP 429 — the per-token bucket is spent
//   { status: "miss", reason }          no token / offline / 401 / 5xx / empty
async function fetchUsage({
  timeoutMs = 8_000,
  credsFile,
  tokenReader = readOAuthToken,
  fetchImpl,
} = {}) {
  let cred;
  try {
    cred = await tokenReader({ credsFile });
  } catch {
    cred = null;
  }
  if (!cred || !cred.token) return { status: "miss", reason: "no-token" };

  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== "function") return { status: "miss", reason: "no-fetch" };

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let res;
  try {
    res = await doFetch(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${cred.token}`,
        "anthropic-beta": "oauth-2025-04-20",
      },
      signal: ac.signal,
    });
  } catch {
    return { status: "miss", reason: "network" };
  } finally {
    clearTimeout(timer);
  }

  if (!res) return { status: "miss", reason: "no-response" };
  if (res.status === 429) return { status: "rate_limited" };
  if (!res.ok) return { status: "miss", reason: `http-${res.status}` };

  let json;
  try {
    json = await res.json();
  } catch {
    return { status: "miss", reason: "bad-json" };
  }
  const quota = parseUsage(json);
  if (!quota) return { status: "miss", reason: "empty" };
  return { status: "ok", quota };
  // token is out of scope now — never logged, never persisted.
}

module.exports = { fetchUsage, USAGE_URL };
