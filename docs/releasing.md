# Releasing pi-promptsmith

This project uses a manual GitHub Actions workflow plus `release-it` for npm publishing.

## GitHub Actions release

The workflow lives at `.github/workflows/release.yml`.

Before using it, add an `NPM_TOKEN` repository secret with publish access to the `pi-promptsmith` package on npm.

Then run the **Release** workflow from GitHub Actions and choose:

- `patch`, `minor`, or `major`
- whether this is the first npm publish (`first_release = true`)

The workflow:

- installs dependencies
- runs `pnpm run check`
- publishes to npm
- creates a git tag
- creates a GitHub release
- updates `CHANGELOG.md`

## Local release commands

For local maintainer-driven releases:

```bash
pnpm run release
```

For the initial npm publish:

```bash
pnpm run release:first
```
