// @excellent-so/usage-cache — parse the Anthropic OAuth usage payload (pure).
//
// Normalizes `GET https://api.anthropic.com/api/oauth/usage` into the shape the
// cache stores and callers render, plus the window-state helpers. `pct` is a
// PERCENT (0..100 — the endpoint's native unit, may exceed 100), never a
// fraction. Every client that renders from the cache gets the same numbers.

"use strict";

function isoMs(s) {
  if (typeof s !== "string") return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

// 0..100 percent; clamps negatives to 0, keeps >100 (over-limit is real).
function asPct(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, n) : null;
}

// Normalize → { fiveHour, sevenDay, scoped } (each window { pct, resetsAt,
// severity } | null). `limits[]` (kind session/weekly_all/weekly_scoped) is the
// primary shape; the bare `five_hour`/`seven_day` objects are the fallback for
// older/partial responses. Returns null when there is no usable window.
function parseUsage(json) {
  if (!json || typeof json !== "object") return null;
  let fiveHour = null;
  let sevenDay = null;
  const scoped = [];

  const limits = Array.isArray(json.limits) ? json.limits : [];
  for (const l of limits) {
    if (!l || typeof l !== "object") continue;
    const pct = asPct(l.percent);
    if (pct === null) continue;
    const entry = {
      pct,
      resetsAt: isoMs(l.resets_at),
      severity: typeof l.severity === "string" ? l.severity : "normal",
    };
    if (l.kind === "session") fiveHour = entry;
    else if (l.kind === "weekly_all") sevenDay = entry;
    else if (l.kind === "weekly_scoped") {
      const label = (l.scope && l.scope.model && l.scope.model.display_name) || "Model";
      scoped.push({ label, ...entry });
    }
  }

  if (!fiveHour && json.five_hour && asPct(json.five_hour.utilization) !== null) {
    fiveHour = {
      pct: asPct(json.five_hour.utilization),
      resetsAt: isoMs(json.five_hour.resets_at),
      severity: "normal",
    };
  }
  if (!sevenDay && json.seven_day && asPct(json.seven_day.utilization) !== null) {
    sevenDay = {
      pct: asPct(json.seven_day.utilization),
      resetsAt: isoMs(json.seven_day.resets_at),
      severity: "normal",
    };
  }

  if (!fiveHour && !sevenDay && scoped.length === 0) return null;
  return { fiveHour, sevenDay, scoped };
}

// The hottest window across 5h / weekly / scoped — "the thing closest to
// stopping me". Returns { scope, label, pct, resetsAt, severity } | null.
function binding(quota) {
  if (!quota) return null;
  const cands = [];
  if (quota.fiveHour) cands.push({ scope: "fiveHour", label: "5-hour", ...quota.fiveHour });
  if (quota.sevenDay) cands.push({ scope: "sevenDay", label: "weekly", ...quota.sevenDay });
  for (const s of quota.scoped || []) cands.push({ scope: "scoped", ...s });
  const ok = cands.filter((c) => c && Number.isFinite(c.pct));
  if (!ok.length) return null;
  return ok.reduce((a, b) => (b.pct > a.pct ? b : a));
}

// The earliest window reset carried by a reading (5h before weekly).
function windowResetsAt(quota) {
  if (!quota) return null;
  return (
    (quota.fiveHour && quota.fiveHour.resetsAt) ||
    (quota.sevenDay && quota.sevenDay.resetsAt) ||
    null
  );
}

// A reading whose window has reset (now past resetsAt) → its pct is meaningless.
function expired(quota, now) {
  const r = windowResetsAt(quota);
  return r != null && now > r;
}

module.exports = { parseUsage, binding, expired, windowResetsAt, _asPct: asPct, _isoMs: isoMs };
