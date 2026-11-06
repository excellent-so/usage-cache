"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseUsage, binding, expired } = require("../lib/parse.js");

const FUTURE = new Date(Date.now() + 3_600_000).toISOString();
const PAST = new Date(Date.now() - 3_600_000).toISOString();

test("parses the limits[] shape (session / weekly_all / weekly_scoped)", () => {
  const q = parseUsage({
    limits: [
      { kind: "session", percent: 34, resets_at: FUTURE, severity: "normal" },
      { kind: "weekly_all", percent: 61, resets_at: FUTURE },
      { kind: "weekly_scoped", percent: 12, resets_at: FUTURE, scope: { model: { display_name: "Opus" } } },
    ],
  });
  assert.equal(q.fiveHour.pct, 34);
  assert.equal(q.sevenDay.pct, 61);
  assert.equal(q.scoped.length, 1);
  assert.equal(q.scoped[0].label, "Opus");
  assert.equal(q.scoped[0].pct, 12);
});

test("falls back to five_hour / seven_day utilization", () => {
  const q = parseUsage({
    five_hour: { utilization: 20, resets_at: FUTURE },
    seven_day: { utilization: 55, resets_at: FUTURE },
  });
  assert.equal(q.fiveHour.pct, 20);
  assert.equal(q.sevenDay.pct, 55);
});

test("pct stays a 0..100 percent, clamps negatives, keeps over-100", () => {
  const q = parseUsage({ limits: [{ kind: "session", percent: 137 }, { kind: "weekly_all", percent: -5 }] });
  assert.equal(q.fiveHour.pct, 137);
  assert.equal(q.sevenDay.pct, 0);
});

test("returns null when there is no usable window", () => {
  assert.equal(parseUsage({}), null);
  assert.equal(parseUsage(null), null);
  assert.equal(parseUsage({ limits: [{ kind: "session" }] }), null); // no percent
});

test("binding picks the hottest window across 5h / weekly / scoped", () => {
  const q = parseUsage({
    limits: [
      { kind: "session", percent: 34, resets_at: FUTURE },
      { kind: "weekly_all", percent: 61, resets_at: FUTURE },
      { kind: "weekly_scoped", percent: 88, resets_at: FUTURE, scope: { model: { display_name: "Opus" } } },
    ],
  });
  const b = binding(q);
  assert.equal(b.pct, 88);
  assert.equal(b.scope, "scoped");
});

test("expired is true only once now is past the window reset", () => {
  const live = parseUsage({ limits: [{ kind: "session", percent: 34, resets_at: FUTURE }] });
  const dead = parseUsage({ limits: [{ kind: "session", percent: 34, resets_at: PAST }] });
  assert.equal(expired(live, Date.now()), false);
  assert.equal(expired(dead, Date.now()), true);
});
