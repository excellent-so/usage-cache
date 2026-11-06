# Changelog

Notable changes to `@excellent-so/usage-cache`. Versions follow
[Semantic Versioning](https://semver.org/).

## 0.1.1 (2026-11-05)

### Added

- `npm run test:standalone`: runs the CLI with a fresh temp HOME, a PATH of
  node's bin dir plus `/usr/bin:/bin`, an empty environment, a fake token and a
  fake endpoint, then checks that it writes its cache and exits 0. It makes no
  network calls and never reads the real token.
- `CHANGELOG.md`, `CONTRIBUTING.md` and `SECURITY.md`, now shipped in the package.
- Its own mark (`docs/mark.svg`) at the head of the README.

### Changed

- README: install commands, a disclaimer that the endpoint is undocumented and
  unofficial, where the token is read from on each platform, and the full list
  of CLI flags and result fields.
- The public home is https://github.com/excellent-so/usage-cache: `homepage`,
  `repository` and the new `bugs` field point there.
- Security reports go to `matt@excellent.so`.

## 0.1.0 (2026-07-14)

First public release.

- `readUsage(opts)` reads `GET https://api.anthropic.com/api/oauth/usage`
  (with the `anthropic-beta: oauth-2025-04-20` header) using your own Claude
  Code OAuth token, and returns the 5-hour, weekly and per-model weekly usage
  plus the hottest of them (`binding`).
- One shared cache file at `~/.cache/excellent-usage-cache/usage.json`, with
  `$XDG_CACHE_HOME` and `$EXCELLENT_USAGE_CACHE_DIR` respected. Writes are
  atomic.
- Cache first: within `ttlMs` (60 seconds by default) no request is made.
- Single flight across processes through an atomic `mkdir` lock, treated as
  abandoned after 15 seconds by default.
- The last good reading is held through HTTP 429 and other failed reads,
  flagged `rateLimited` and, after 15 minutes, `stale`.
- The token comes from the macOS Keychain (`Claude Code-credentials`) or
  `~/.claude/.credentials.json`. It is never logged, stored or refreshed.
- `usage-cache` CLI with `--pct`, `--statusline`, `--json`, `--binding`,
  `--ttl`, `--wait`, `--force` and `--offline` (alias `--no-network`). It
  always exits 0.
- Zero dependencies. Node 18 or later. 18 tests run with `node --test`.
