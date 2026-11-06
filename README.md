<img src="docs/mark.svg" width="40" height="40" alt="">

# @excellent-so/usage-cache

One shared, file-cached read of your Claude plan usage. Every Claude Code
statusline, dev shell and menu-bar meter on your machine reads the same cache,
so together they make one request per interval.

Zero dependencies. Node 18 or later. MIT license.

> **Unofficial.** This package reads an undocumented Anthropic endpoint
> (`GET https://api.anthropic.com/api/oauth/usage`) using your own Claude Code
> login. Anthropic does not publish or support this endpoint. It can change or
> go away at any time, and this package will break when it does. This project
> is not affiliated with or endorsed by Anthropic.

## Install

```sh
npm i -g @excellent-so/usage-cache
```

That puts a `usage-cache` command on your PATH. To try it once without
installing:

```sh
npx @excellent-so/usage-cache --statusline
```

To use it as a library, run `npm i @excellent-so/usage-cache` in your project.

You need to be logged in to Claude Code on the same machine, because this reads
the token Claude Code already stores (see
[Where the token comes from](#where-the-token-comes-from)).

## Why

The usage endpoint (the one `claude /usage` reads) rate-limits per token. A dev
box often runs many clients on one Claude Code login: a statusline in every
`claude` session, a dev shell, a menu-bar meter. When each one polls on its
own, together they use up the token's request budget, get HTTP 429 back, and
the numbers they show go stale.

This package makes them share one read:

- **Cache first.** Within `ttlMs` (60 seconds by default) every caller gets the
  cached reading and makes no request.
- **Single flight.** When the cache is older than `ttlMs`, exactly one caller
  (whoever wins an atomic file lock) calls the endpoint. The rest wait briefly
  and read the cache. However many clients you run, that is one request per
  interval.
- **Hold through 429.** A reading stays usable until its 5-hour window resets
  (the 7-day window when there is no 5-hour figure). If a refresh is
  rate-limited, the last good reading is kept and flagged `rateLimited` (and
  `stale` once it is over 15 minutes old), so callers keep showing a number.

## CLI

```sh
usage-cache                 # "34%", the 5-hour session figure (same as --pct)
usage-cache --statusline    # "34% (5h) · wk 61%"
usage-cache --json          # the full result object
usage-cache --binding       # headline = the hottest window (5-hour, weekly or per-model)
usage-cache --offline       # serve the cache only, never call the endpoint (alias --no-network)
usage-cache --force         # skip the TTL and refresh now (still single flight)
usage-cache --ttl 30        # cache freshness window, in seconds (default 60)
usage-cache --wait 3000     # how long to wait for another process's read, in ms
usage-cache --help          # the options; --version prints the version
```

When the endpoint returns no 5-hour figure, the headline is the weekly one and
`--statusline` prints it once, labelled: `43% (wk)`. With `--binding`, the
label names the window the headline came from, for example `80% (Opus) · wk 61%`.

A reading over 15 minutes old prints with a leading `~` (for example `~30%`).
With no reading at all it prints `-`. If you run it by hand in a terminal, it
also prints one line to stderr saying why (no Claude Code login, HTTP 401, no
network, and so on) and what to do. A statusline or a `$(usage-cache)` prompt
never sees that line; `--json` carries the same cause in `reason`.

A failed read still exits 0, so it is safe to use as a statusline command or in
a shell prompt. Only an unknown option or a bad `--ttl` or `--wait` value exits
2, with a one-line message.

### Claude Code statusline

```jsonc
// ~/.claude/settings.json
{ "statusLine": { "type": "command", "command": "usage-cache --statusline" } }
```

Every `claude` session then reads the shared cache, and only one of them calls
the endpoint per interval.

## Library

The package is CommonJS. From CommonJS:

```js
const { readUsage } = require("@excellent-so/usage-cache");

readUsage().then((res) => console.log(res.binding));
```

From an ES module, named imports work too:

```js
import { readUsage } from "@excellent-so/usage-cache";

const res = await readUsage();
// {
//   ok: true,
//   quota: { fiveHour: { pct, resetsAt, severity }, sevenDay, scoped: [...] },
//   binding: { scope, label, pct, resetsAt, severity },  // hottest window
//   fetchedAt, ageMs,
//   source: "network" | "cache" | "cache-wait" | "none",
//   stale: false,        // over 15 minutes old (show it with a leading "~")
//   rateLimited: false,  // the last attempt got HTTP 429
//   expired: false,      // the window has reset, so pct no longer applies
//   lastStatus: "ok",    // "ok" | "rate_limited" | "miss" | null
//   reason: null,        // why the last attempt failed, null when it worked
// }
```

`reason` is one of `no-token` (no Claude Code login found),
`keychain-timeout`, `http-401` (or any other `http-NNN`), `network`,
`bad-json`, `empty`, `cache-dir` (the cache folder cannot be written),
`no-cache` (offline with nothing cached) or `busy` (another process was still
reading when `waitMs` ran out).

`pct` is a percent, as the endpoint returns it: 0 to 100, and above 100 when
you are over a limit. `resetsAt` and `fetchedAt` are epoch milliseconds.

The module also exports `binding(quota)`, `expired(quota, now)`, `STALE_MS` and
`DEFAULT_TTL_MS`.

### Options

| option | default | meaning |
|---|---|---|
| `ttlMs` | `60000` | serve the cache without a request if it is younger than this |
| `waitMs` | `3000` | if another process holds the fetch lock, wait this long for its result |
| `timeoutMs` | `8000` | request timeout for the one GET |
| `force` | `false` | ignore the TTL and force a (still single-flight) read |
| `offline` | `false` | never call the endpoint; serve the cache only |
| `cacheDir` | `~/.cache/excellent-usage-cache` | override the shared cache location |

## Where the token comes from

The token is the one Claude Code stores when you log in. This package looks in
two places:

- **macOS:** the Keychain item `Claude Code-credentials`, read with
  `/usr/bin/security find-generic-password`. The lookup gives up after 4
  seconds (for example, while a Keychain access prompt is open). If it fails or
  times out, the file below is tried. If that has no token either, the result's
  `reason` is `keychain-timeout`.
- **Linux and other platforms:** `~/.claude/.credentials.json`.

Both hold the same JSON, and the token is `claudeAiOauth.accessToken`. It is
never refreshed here; that is Claude Code's job. If it has expired, requests
fail and the last reading is held until Claude Code refreshes it.

It has been built and tested on macOS. Other platforms use the file path above
and have not been tested.

## The shared cache

One JSON file all clients agree on: `~/.cache/excellent-usage-cache/usage.json`
(`$XDG_CACHE_HOME` is respected; override with `$EXCELLENT_USAGE_CACHE_DIR`).
Writes are atomic (temp file, then rename). The fetch lock is a sibling
directory (`fetch.lock`) created with atomic `mkdir`. A lock older than the
request timeout plus 7 seconds (15 seconds by default) is treated as abandoned
and removed, so a crashed holder never blocks every client.

The cache file holds the usage numbers and timestamps only. The token is never
written to it.

## Privacy

One read-only GET, to `api.anthropic.com` only. This package sets two headers,
`Authorization: Bearer <your token>` and `anthropic-beta: oauth-2025-04-20`,
and sends no body. There is no telemetry and no other host. The token is read
for the request and then dropped: never logged, never written to disk.

## Uninstall

```sh
npm rm -g @excellent-so/usage-cache
rm -rf ~/.cache/excellent-usage-cache
```

The second line removes the shared cache (use your `$EXCELLENT_USAGE_CACHE_DIR`
or `$XDG_CACHE_HOME/excellent-usage-cache` if you set one). Remove the
`statusLine` entry from `~/.claude/settings.json` if you added it.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). To report a security issue, see
[SECURITY.md](SECURITY.md). Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## License

MIT
