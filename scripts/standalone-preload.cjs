// Loaded into the CLI process by scripts/standalone-check.mjs (`node --require`).
//
// It replaces every way the CLI could reach past the machine or the temp HOME:
//
//   - globalThis.fetch becomes a fake usage endpoint. Any other URL throws, and a
//     request without the fake token gets a 401.
//   - every child_process call is refused, so the macOS Keychain lookup
//     (/usr/bin/security) never runs and the real token is never read. The CLI
//     then falls back to the fake ~/.claude/.credentials.json in the temp HOME.
//   - net and tls connections throw, as a second guard against a real request.
//
// Each call is appended to $USAGE_CACHE_STANDALONE_LOG (JSON lines) so the check
// can count them. The Authorization header is never written down, only whether
// it matched the fake token.

"use strict";

const fs = require("node:fs");
const net = require("node:net");
const tls = require("node:tls");
const { EventEmitter } = require("node:events");
const childProcess = require("node:child_process");

const LOG = process.env.USAGE_CACHE_STANDALONE_LOG;
const FAKE_TOKEN = process.env.USAGE_CACHE_STANDALONE_TOKEN;
const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";

if (!LOG || !FAKE_TOKEN) {
  process.stderr.write("standalone preload: USAGE_CACHE_STANDALONE_LOG and _TOKEN must be set\n");
  process.exit(97);
}

function log(entry) {
  fs.appendFileSync(LOG, `${JSON.stringify(entry)}\n`, "utf8");
}

function header(headers, name) {
  if (!headers) return undefined;
  if (typeof headers.get === "function") return headers.get(name);
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
}

const inAnHour = () => new Date(Date.now() + 3_600_000).toISOString();

globalThis.fetch = async function fakeFetch(url, init = {}) {
  const tokenMatches = header(init.headers, "authorization") === `Bearer ${FAKE_TOKEN}`;
  log({
    event: "fetch",
    url: String(url),
    tokenMatches,
    beta: header(init.headers, "anthropic-beta") || null,
  });
  if (String(url) !== USAGE_URL) throw new Error("standalone: unexpected URL");
  if (!tokenMatches) return { ok: false, status: 401, json: async () => ({}) };
  return {
    ok: true,
    status: 200,
    json: async () => ({
      limits: [
        { kind: "session", percent: 34, resets_at: inAnHour() },
        { kind: "weekly_all", percent: 61, resets_at: inAnHour() },
      ],
    }),
  };
};

function refuse(name) {
  return function refused(file, ...rest) {
    log({ event: "spawn-refused", via: name, file: String(file) });
    const err = Object.assign(new Error(`standalone: child_process.${name} refused`), {
      code: "ESTANDALONE",
    });
    const cb = [...rest].reverse().find((a) => typeof a === "function");
    if (cb) {
      process.nextTick(cb, err, "", "");
      return new EventEmitter();
    }
    throw err;
  };
}

for (const name of ["exec", "execFile", "execFileSync", "execSync", "fork", "spawn", "spawnSync"]) {
  childProcess[name] = refuse(name);
}

function noSockets(name) {
  return function blocked() {
    log({ event: "socket-refused", via: name });
    throw new Error(`standalone: ${name} refused`);
  };
}

net.connect = noSockets("net.connect");
net.createConnection = noSockets("net.createConnection");
tls.connect = noSockets("tls.connect");

// Fail closed: if any stub did not take, stop before the CLI runs.
if (
  globalThis.fetch.name !== "fakeFetch" ||
  childProcess.execFile.name !== "refused" ||
  net.connect.name !== "blocked"
) {
  process.stderr.write("standalone preload: a stub did not install\n");
  process.exit(98);
}
