# Contributing to `@romaco/mcp`

Thanks for your interest in improving the Romaco MCP server. This project uses a
lightweight **trunk-based** workflow — read the rules below before opening a PR.

## Branching model

- **`main`** is the only long-lived branch. It is always releasable and protected.
- Do your work on a **short-lived topic branch** cut from `main`, then open a Pull
  Request back into `main`. Topic branches are deleted automatically after merge.
- There is **no** `develop`, `release/*`, or `hotfix/*` branch — keep it simple.

### Branch naming

Name the branch after the kind of change:

| Prefix | For |
| --- | --- |
| `feat/` | a new feature |
| `fix/` | a bug fix |
| `docs/` | documentation only |
| `chore/` | tooling, deps, CI, housekeeping |
| `refactor/` | code change that neither fixes a bug nor adds a feature |
| `perf/` | a performance improvement |
| `test/` | tests only |

Examples: `feat/alpaca-datafeed`, `fix/yfinance-2h-bucketing`.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/):
`type(scope): summary` — e.g. `fix(gateway): add request timeout`. Types match the
branch prefixes above.

## Pull requests

1. Branch off the latest `main`.
2. Make your change. Add/adjust tests (`npm test`) and keep the build green (`npm run build`).
3. Open a focused PR into `main` — one logical change per PR.
4. PRs are merged with **squash-merge** (one clean commit per PR) and the source
   branch is deleted automatically.

## Local development

```bash
npm ci          # install
npm run build   # tsc -> dist/
npm test        # vitest
npm run dev     # tsc --watch
```

## Releases (maintainers)

Releases are cut from `main` by tagging — never publish from a laptop:

```bash
# bump "version" in package.json, commit to main, then:
git tag vX.Y.Z
git push origin vX.Y.Z   # the v* tag triggers .github/workflows/publish.yml -> npm
```

## License

By contributing, you agree that your contributions are licensed under the
[Apache License 2.0](./LICENSE), the same license as the project.
