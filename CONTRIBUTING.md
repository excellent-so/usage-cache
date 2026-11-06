# Contributing

This is a small package, so the rules are short.

## Run the tests

You need Node 18 or later. There is nothing to install.

```sh
npm test                  # unit tests (node --test)
npm run test:standalone   # the CLI in a clean temp HOME, against a fake endpoint
```

Both run offline. The unit tests pass a fake token and a fake fetch through the
`tokenReader` and `fetchImpl` options of `readUsage`. The standalone check
loads `scripts/standalone-preload.cjs`, which fakes the endpoint and blocks the
Keychain lookup. A test must never read a real token or call
`api.anthropic.com`.

## Zero dependencies

The package has no `dependencies` and no `devDependencies`, and it should stay
that way. Use Node built-ins only, and keep to what Node 18 supports. If a
change seems to need a package, open an issue to discuss it first.

## Reporting a bug

Open an issue on the repository:
https://github.com/excellent-so/usage-cache/issues

Include:

- your OS and the output of `node --version`
- the output of `usage-cache --version`
- the command you ran and what it printed (`usage-cache --json` output helps,
  and it contains no token)
- what you expected to see

For a security issue, follow [SECURITY.md](SECURITY.md) and do not open a
public issue.
