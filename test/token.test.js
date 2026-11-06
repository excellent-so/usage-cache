"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");
const { readOAuthToken } = require("../lib/token.js");

// Run fn with process.platform = darwin, HOME = a temp dir, and execFile
// answering like a Keychain lookup that was killed at its timeout.
async function withTimedOutKeychain(writeFile, fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "uc-token-"));
  if (writeFile) {
    fs.mkdirSync(path.join(home, ".claude"));
    fs.writeFileSync(
      path.join(home, ".claude", ".credentials.json"),
      JSON.stringify({ claudeAiOauth: { accessToken: "file-token" } }),
    );
  }
  const saved = { execFile: childProcess.execFile, home: process.env.HOME, platform: process.platform };
  const calls = [];
  childProcess.execFile = (file, args, opts, cb) => {
    calls.push({ file, timeout: opts.timeout });
    process.nextTick(cb, Object.assign(new Error("killed"), { killed: true, signal: "SIGTERM" }), "", "");
  };
  process.env.HOME = home;
  Object.defineProperty(process, "platform", { value: "darwin" });
  try {
    return await fn(calls);
  } finally {
    childProcess.execFile = saved.execFile;
    process.env.HOME = saved.home;
    Object.defineProperty(process, "platform", { value: saved.platform });
  }
}

test("a timed-out Keychain lookup falls back to ~/.claude/.credentials.json", async () => {
  await withTimedOutKeychain(true, async (calls) => {
    const cred = await readOAuthToken();
    assert.equal(cred.token, "file-token");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].file, "/usr/bin/security");
    assert.equal(calls[0].timeout, 4_000, "the README's 4 seconds");
  });
});

test("a timed-out Keychain lookup with no file reports keychain-timeout", async () => {
  await withTimedOutKeychain(false, async () => {
    const cred = await readOAuthToken();
    assert.equal(cred.token, null);
    assert.equal(cred.reason, "keychain-timeout");
  });
});
