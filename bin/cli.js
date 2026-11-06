#!/usr/bin/env node
// @excellent-so/usage-cache — CLI. Drop-in for a statusline / prompt segment.
//
//   usage-cache                 -> "34%"   (session 5h headline; "~30%" when held)
//   usage-cache --statusline    -> "34% (5h) · wk 61%"
//   usage-cache --json          -> the full result object
//
// A failed read still exits 0 — a statusline command must not break a prompt.
// Only a mistyped option or value exits 2, with one line on stderr.

"use strict";

const { readUsage } = require("../index.js");
const { explain } = require("../lib/explain.js");

const HELP = `usage-cache — shared, single-flight reader for the Anthropic OAuth usage endpoint.

One local cache that every Claude Code statusline / dev shell / menu bar reads,
so N clients make ONE network read per interval instead of each tripping the
per-token rate limit.

Usage:
  usage-cache [--pct|--statusline|--json] [options]

Formats:
  --pct          just the headline number, e.g. "34%" (default): the 5-hour
                 figure, or the weekly one when there is no 5-hour figure.
                 "~30%" when the reading is over 15 minutes old; "-" when there
                 is none.
  --statusline   headline + weekly, e.g. "34% (5h) · wk 61%", or "43% (wk)".
  --json         the full result object.

Options:
  --binding      headline = the hottest window (5h/weekly/per-model), not just 5h.
  --ttl <sec>    serve cache without a network read if younger than this (default 60).
  --wait <ms>    if another process is fetching, wait this long for it (default 3000).
  --force        ignore the TTL and force a (still single-flight) read.
  --offline      never hit the network; serve cache only (alias --no-network).
  -h, --help     show this help.
  -v, --version  print the version.

A failed read prints "-" and exits 0. Run by hand in a terminal, it also says
why on stderr. A mistyped option exits 2.
`;

class UsageError extends Error {}

function number(flag, value, example) {
  const n = Number(value);
  if (value === undefined || String(value).trim() === "" || !Number.isFinite(n) || n < 0) {
    throw new UsageError(`${flag} needs a number, for example ${flag} ${example}.`);
  }
  return n;
}

function parseArgs(argv) {
  const o = { format: "pct" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") o.format = "json";
    else if (a === "--statusline") o.format = "statusline";
    else if (a === "--pct") o.format = "pct";
    else if (a === "--binding") o.binding = true;
    else if (a === "--force") o.force = true;
    else if (a === "--offline" || a === "--no-network") o.offline = true;
    else if (a === "--ttl") o.ttlMs = number("--ttl", argv[++i], "30") * 1000;
    else if (a === "--wait") o.waitMs = number("--wait", argv[++i], "3000");
    else if (a === "-h" || a === "--help") o.help = true;
    else if (a === "-v" || a === "--version") o.version = true;
    else throw new UsageError(`unknown option "${a}". Run usage-cache --help to see the options.`);
  }
  return o;
}

function fmtPct(p) {
  return `${Math.round(p)}%`;
}

// The headline window: the 5-hour figure (what `claude /usage` leads with),
// else the weekly one, else the hottest per-model one. --binding picks the
// hottest of all of them.
function headWindow(res, useBinding) {
  const q = res.quota;
  if (!q) return null;
  if (useBinding) return res.binding;
  if (q.fiveHour) return { scope: "fiveHour", ...q.fiveHour };
  if (q.sevenDay) return { scope: "sevenDay", ...q.sevenDay };
  return res.binding;
}

// "~" prefix = over 15 minutes old (held through a rate-limit or outage).
function headline(res, useBinding) {
  const w = headWindow(res, useBinding);
  if (!w || !Number.isFinite(w.pct)) return "-";
  return res.stale ? `~${fmtPct(w.pct)}` : fmtPct(w.pct);
}

// "34% (5h) · wk 61%"; "43% (wk)" with no 5-hour figure; with --binding the
// tag names the window the headline came from.
function statusline(res, useBinding) {
  const w = headWindow(res, useBinding);
  const head = headline(res, useBinding);
  if (head === "-") return "-";
  const tag = w.scope === "fiveHour" ? "5h" : w.scope === "sevenDay" ? "wk" : w.label;
  const parts = [`${head} (${tag})`];
  if (w.scope !== "sevenDay" && res.quota.sevenDay) parts.push(`wk ${fmtPct(res.quota.sevenDay.pct)}`);
  return parts.join(" · ");
}

// Say why there is no number, but only to a person at a terminal.
function hint(res) {
  if (!process.stdout.isTTY || !process.stderr.isTTY) return;
  const why = explain(res);
  if (why) process.stderr.write(`usage-cache: ${why}\n`);
}

async function main() {
  let o;
  try {
    o = parseArgs(process.argv.slice(2));
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    process.stderr.write(`usage-cache: ${e.message}\n`);
    process.exitCode = 2;
    return;
  }
  if (o.help) {
    process.stdout.write(HELP);
    return;
  }
  if (o.version) {
    process.stdout.write(`${require("../package.json").version}\n`);
    return;
  }

  const res = await readUsage({
    force: o.force,
    offline: o.offline,
    ...(Number.isFinite(o.ttlMs) ? { ttlMs: o.ttlMs } : {}),
    ...(Number.isFinite(o.waitMs) ? { waitMs: o.waitMs } : {}),
  });

  if (o.format === "json") {
    process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
    return;
  }
  if (o.format === "statusline") {
    process.stdout.write(`${statusline(res, o.binding)}\n`);
  } else {
    process.stdout.write(`${headline(res, o.binding)}\n`);
  }
  hint(res);
}

main().then(
  () => process.exit(process.exitCode || 0),
  () => process.exit(0), // never break a statusline
);
