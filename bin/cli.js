#!/usr/bin/env node
// @excellent-so/usage-cache — CLI. Drop-in for a statusline / prompt segment.
//
//   usage-cache                 -> "34%"   (session 5h headline; "~30%" when held)
//   usage-cache --statusline    -> "34% (5h) · wk 61%"
//   usage-cache --json          -> the full result object
//
// It NEVER errors (exit 0 always) — a statusline command must not break a prompt.

"use strict";

const { readUsage } = require("../index.js");

const HELP = `usage-cache — shared, single-flight reader for the Anthropic OAuth usage endpoint.

One local cache that every Claude Code statusline / dev shell / menu bar reads,
so N clients make ONE network read per interval instead of each tripping the
per-token rate limit.

Usage:
  usage-cache [--pct|--statusline|--json] [options]

Formats:
  --pct          just the headline number, e.g. "34%" (default). "~30%" when the
                 reading is HELD through a rate-limit; "-" when unavailable.
  --statusline   headline + weekly, e.g. "34% (5h) . wk 61%".
  --json         the full result object.

Options:
  --binding      headline = the hottest window (5h/weekly/scoped), not just 5h.
  --ttl <sec>    serve cache without a network read if younger than this (default 60).
  --wait <ms>    if another process is fetching, wait this long for it (default 3000).
  --force        ignore the TTL and force a (still single-flight) read.
  --offline      never hit the network; serve cache only.
  -h, --help     show this help.
  -v, --version  print the version.
`;

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
    else if (a === "--ttl") o.ttlMs = Number(argv[++i]) * 1000;
    else if (a === "--wait") o.waitMs = Number(argv[++i]);
    else if (a === "-h" || a === "--help") o.help = true;
    else if (a === "-v" || a === "--version") o.version = true;
  }
  return o;
}

function fmtPct(p) {
  return `${Math.round(p)}%`;
}

// The headline number: 5h session by default (mirrors `claude /usage`), or the
// hottest window with --binding. "~" prefix = held through a rate-limit/outage.
function headline(res, useBinding) {
  const q = res.quota;
  let pct = null;
  if (useBinding) {
    pct = res.binding ? res.binding.pct : null;
  } else if (q && q.fiveHour) {
    pct = q.fiveHour.pct;
  } else if (q && q.sevenDay) {
    pct = q.sevenDay.pct;
  } else if (res.binding) {
    pct = res.binding.pct;
  }
  if (pct == null || !Number.isFinite(pct)) return "-";
  return res.stale ? `~${fmtPct(pct)}` : fmtPct(pct);
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
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
    const head = headline(res, o.binding);
    const parts = [head === "-" ? "-" : head + (res.quota && res.quota.fiveHour ? " (5h)" : "")];
    if (res.quota && res.quota.sevenDay) parts.push(`wk ${fmtPct(res.quota.sevenDay.pct)}`);
    process.stdout.write(`${parts.join(" · ")}\n`);
    return;
  }
  process.stdout.write(`${headline(res, o.binding)}\n`);
}

main().then(
  () => process.exit(0),
  () => process.exit(0), // never break a statusline
);
