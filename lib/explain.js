// @excellent-so/usage-cache — one sentence on why there is no reading.
//
// The CLI prints this to stderr only when someone runs it by hand in a terminal,
// so a statusline or a `$(usage-cache)` prompt never sees it. `--json` carries
// the same `reason` code instead.

"use strict";

const { cacheDir } = require("./cache.js");

// → a sentence (no trailing newline), or null when there is nothing to explain.
function explain(res) {
  if (!res || res.ok) return null;
  const reason = res.reason || "";
  const http = /^http-(\d{3})$/.exec(reason);
  if (reason === "no-token") {
    return "no Claude Code login found on this machine. Run claude and log in, then try again.";
  }
  if (reason === "keychain-timeout") {
    return (
      "the macOS Keychain lookup timed out after 4 seconds (an access prompt may be open) and " +
      "~/.claude/.credentials.json has no token. Allow the prompt, or log in to Claude Code again, then try again."
    );
  }
  if (http && (http[1] === "401" || http[1] === "403")) {
    return `Anthropic refused the Claude Code login (HTTP ${http[1]}). Start claude so it refreshes the login, then try again.`;
  }
  if (http && http[1] === "429") {
    return "the usage endpoint is rate-limiting this login (HTTP 429). Try again in a few minutes.";
  }
  if (http) return `api.anthropic.com answered HTTP ${http[1]}. Try again later.`;
  if (reason === "network" || reason === "no-response") {
    return "could not reach api.anthropic.com. Check your connection, then try again.";
  }
  if (reason === "bad-json" || reason === "empty") {
    return "the usage endpoint answered without usage figures; it may have changed. Check for a newer @excellent-so/usage-cache.";
  }
  if (reason === "no-fetch") return "this Node has no fetch(). Use Node 18 or later.";
  if (reason === "cache-dir") {
    return `cannot write the cache folder ${cacheDir()}. Set EXCELLENT_USAGE_CACHE_DIR to a folder you can write, then try again.`;
  }
  if (reason === "no-cache") return "there is no cached reading yet. Run usage-cache once without --offline.";
  if (reason === "busy") return "another usage-cache process is still reading. Try again in a moment.";
  return null;
}

module.exports = { explain };
