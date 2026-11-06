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
const { execFile } = require("node:child_process");

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

function readTokenFromKeychain() {
  return new Promise((resolve) => {
    if (process.platform !== "darwin") return resolve(null);
    execFile(
      "/usr/bin/security",
      ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"],
      { timeout: KEYCHAIN_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
      (err, stdout) => resolve(err ? null : credsFromJson(String(stdout).trim())),
    );
  });
}

function readTokenFromFile(file) {
  try {
    return credsFromJson(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// Keychain first (where Claude Code keeps it on macOS), then the dotfile.
// `credsFile` is the test seam — when given, ONLY that file is read.
async function readOAuthToken({ credsFile } = {}) {
  if (credsFile) return readTokenFromFile(credsFile);
  return (
    (await readTokenFromKeychain()) ||
    readTokenFromFile(path.join(os.homedir(), ".claude", ".credentials.json"))
  );
}

module.exports = { readOAuthToken, credsFromJson, KEYCHAIN_SERVICE };
