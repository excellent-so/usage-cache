# Security policy

## What this package handles

`usage-cache` reads your Claude Code OAuth token from the macOS Keychain item
`Claude Code-credentials` or from `~/.claude/.credentials.json`. It sends that
token in one read-only GET to `https://api.anthropic.com/api/oauth/usage` and
to no other host. The token is never logged, never written to disk and never
refreshed. The cache file (`~/.cache/excellent-usage-cache/usage.json`) holds
usage numbers and timestamps only.

Examples of what counts as a security issue here:

- the token reaching any host other than `api.anthropic.com`
- the token showing up in output, a log, the cache file or any other file
- a way for another local user or process to get the token through this
  package

## Supported versions

The latest version published on npm. Fixes ship in a new release.

## Reporting a vulnerability

Please do not open a public issue. Email `matt@excellent.so` with:

- what you found and what an attacker could do with it
- steps to reproduce
- the package version, your OS and `node --version`

Never include a real token in a report. There is no bounty program.
