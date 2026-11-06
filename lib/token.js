// @excellent-so/usage-cache — read the user's OWN Claude Code OAuth token.
//
// The usage endpoint is authed with the same OAuth token Claude Code stores in
// the macOS Keychain ("Claude Code-credentials"), falling back to
// ~/.claude/.credentials.json on other platforms. The token is read, used for
// the one request, and dropped — never logged, never persisted, never refreshed
// (refresh belongs to Claude Code). Every failure returns null; this module must
// never throw.

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process"); // looked up per call so a test can stub it

const KEYCHAIN_SERVICE = "Claude Code-credentials";
const KEYCHAIN_TIMEOUT_MS = 4_000; // a Keychain ACL prompt must not wedge a read

// The Keychain blob and the fallback dotfile share one JSON shape:
//   { claudeAiOauth: { accessToken, refreshToken, expiresAt, ... } }
function credsFromJson(text) {
  try {
    const o = JSON.parse(text);
    const t = o && o.claudeAiOauth && o.claudeAiOauth.accessToken;
    if (typeof t !== "string" || !t) return null;
    const exp = Number(o.claudeAiOauth.expiresAt);
    return { token: t, expiresAt: Number.isFinite(exp) ? exp : null };
  } catch {
    return null;
  }
}

// → creds, null, or { token: null, reason: "keychain-timeout" } when the lookup
// was killed at KEYCHAIN_TIMEOUT_MS (an access prompt left open, for example).
function readTokenFromKeychain() {
  return new Promise((resolve) => {
    if (process.platform !== "darwin") return resolve(null);
    try {
      childProcess.execFile(
        "/usr/bin/security",
        ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"],
        { timeout: KEYCHAIN_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
        (err, stdout) => {
          if (err) return resolve(err.killed ? { token: null, reason: "keychain-timeout" } : null);
          resolve(credsFromJson(String(stdout).trim()));
        },
      );
    } catch {
      resolve(null);
    }
  });
}

function readTokenFromFile(file) {
  try {
    return credsFromJson(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// Keychain first (where Claude Code keeps it on macOS), then the dotfile. When
// neither has a token, a Keychain timeout is passed on as the reason.
// `credsFile` is the test seam — when given, ONLY that file is read.
async function readOAuthToken({ credsFile } = {}) {
  if (credsFile) return readTokenFromFile(credsFile);
  const fromKeychain = await readTokenFromKeychain();
  if (fromKeychain && fromKeychain.token) return fromKeychain;
  return readTokenFromFile(path.join(os.homedir(), ".claude", ".credentials.json")) || fromKeychain;
}

module.exports = { readOAuthToken, credsFromJson, KEYCHAIN_SERVICE, KEYCHAIN_TIMEOUT_MS };
