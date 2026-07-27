# Publishing

Everything about how the packages in this repository are verified, versioned and
shipped. If you only want to cut a release, jump to
[Cutting a release](#cutting-a-release).

- [What ships](#what-ships)
- [The three workflows](#the-three-workflows)
- [The verification gate](#the-verification-gate)
- [Versions and dist-tags](#versions-and-dist-tags)
- [Snapshots](#snapshots)
- [Cutting a release](#cutting-a-release)
- [Changelogs and release notes](#changelogs-and-release-notes)
- [Secrets](#secrets)
- [Registry authentication in the workflows](#registry-authentication-in-the-workflows)
- [Installing the packages](#installing-the-packages)
- [Design decisions](#design-decisions)
- [Checking things locally](#checking-things-locally)
- [Troubleshooting](#troubleshooting)
- [Recovering from a bad publish](#recovering-from-a-bad-publish)

## What ships

| Directory         | Package            | Binary   |
| ----------------- | ------------------ | -------- |
| `packages/nopy`   | `@bitsquare/nopy`   | `nopy`   |
| `packages/keyman` | `@bitsquare/keyman` | `keyman` |

Both are ESM, both declare `engines.node >= 22`, and both expose a single
executable through `bin`, so `npm install -g` puts `nopy` / `keyman` on the
`PATH`. `cubes/` is not a package and is never published.

The tarball contents are pinned by `files: ["dist", "README.md", "LICENSE"]` —
sources and tests are not shipped. `publishConfig.access: "public"` is what makes
a scoped package publishable to npmjs without an extra flag; the workflows pass
`--access public` anyway.

Versions and changelogs are maintained **by hand**. Nothing in CI commits a
version bump, opens a release PR, or pushes a tag. A release happens because you
tagged a commit whose manifest already carries the version you want.

## The three workflows

All three live in [`.gitea/workflows`](.gitea/workflows) and run on the
`ubuntu-latest` runner label.

| Workflow               | Trigger                          | Publishes                                  |
| ---------------------- | -------------------------------- | ------------------------------------------ |
| `ci.yml`               | pull requests, non-`main` pushes | nothing                                    |
| `publish-snapshot.yml` | pushes to `main`                 | **both** packages → Gitea, tag `main`      |
| `release.yml`          | tags matching `*-v*`             | **one** package → Gitea **and** npmjs      |

`ci.yml` explicitly excludes `main` and all tags (`branches-ignore` +
`tags-ignore`). That is not an oversight: both publish workflows carry the full
gate themselves, so excluding them here means no commit is ever verified twice,
while nothing is ever published from an unverified tree.

Concurrency: `ci.yml` cancels superseded runs for the same ref
(`cancel-in-progress: true`); the two publish workflows never cancel, because a
half-finished publish is worse than a slow queue.

### `ci.yml`

```
checkout → pnpm → node → pnpm store cache → install
        → lint:ci → typecheck → test:coverage → coverage summary
        → build → npm pack --dry-run (per package) → upload coverage
```

The `npm pack --dry-run --ignore-scripts` step prints the exact file list that
would be published. It is there to catch a `files` or `bin` entry pointing at
something the build no longer produces — a failure that would otherwise only
surface after the version is already on a registry and immutable.

Coverage HTML/JSON reports are uploaded as a `coverage` artifact with a 7-day
retention. Both the artifact upload and the store cache are
`continue-on-error: true`, so a runner without a cache or artifact server gets
slower CI rather than broken CI.

### `publish-snapshot.yml`

```
checkout → pnpm → node → cache → install
        → lint:ci → typecheck → test:coverage → coverage summary → build
        → write .npmrc → publish both packages → delete .npmrc
```

One job, no `needs:` barrier, so install and build happen exactly once and
nothing has to be passed between jobs as an artifact.

### `release.yml`

```
checkout → resolve tag → check secrets
        → pnpm → node → cache → install
        → lint:ci → typecheck → test:coverage → build
        → publish to Gitea → publish to npmjs → delete .npmrc
        → create the Gitea release → step summary
```

Tag resolution and the secret check run **before** anything is installed or
built, so a malformed tag or a missing token fails in seconds instead of after
the whole gate.

## The verification gate

The same three commands guard every path into a registry:

| Step            | Command                 |
| --------------- | ----------------------- |
| Lint            | `pnpm run lint:ci`      |
| Typecheck       | `pnpm run typecheck`    |
| Test + coverage | `pnpm run test:coverage`|

Coverage is a hard failure below **85 % branches** (and 85 % functions, 80 %
lines, 80 % statements). The thresholds live in `coverage.thresholds` in each
package's `vitest.config.ts`, not in a CI-only flag, which means
`pnpm run test:coverage` fails identically on a laptop, in the `pre-push` hook,
and on the runner. Barrel files and CLI argv wiring are excluded from
measurement; everything with behaviour in it is not.

The `pre-push` hook installed by `simple-git-hooks` runs exactly this gate, so a
push that survives locally will not surprise you on the runner. Bypass with
`SKIP_SIMPLE_GIT_HOOKS=1` when you must — CI will still catch it.

`pnpm run coverage:summary` renders the per-package `json-summary` reports as a
Markdown table. In CI it appends to `$GITHUB_STEP_SUMMARY` so the numbers show up
on the run page without opening the log. It is reporting only — `if: always()`
and `continue-on-error: true` — and can never be the reason a run goes red.

## Versions and dist-tags

| Source                                    | Version                       | Registry     | dist-tag |
| ----------------------------------------- | ----------------------------- | ------------ | -------- |
| push to `main`                            | `1.0.0-main.42.g736c012`      | Gitea        | `main`   |
| tag `nopy-v1.2.0`                         | `1.2.0`                       | Gitea, npmjs | `latest` |
| tag `nopy-v1.2.0-rc.1`                    | `1.2.0-rc.1`                  | Gitea, npmjs | `next`   |

The rule for the dist-tag is mechanical: a version containing a prerelease part
(anything with a `-` in it) goes out as `next` and is marked as a prerelease on
the Gitea release; anything else goes out as `latest`. There is no way to publish
a prerelease over `latest` by accident.

## Snapshots

Every commit that lands on `main` publishes both packages to the Gitea registry,
versioned as:

```
<manifest version>-main.<run number>.g<short sha>
```

for example `1.0.0-main.42.g736c012`. The `g` prefix keeps the identifier valid
semver even when the abbreviated sha happens to be all digits. The run number is
monotonic, so every push produces a version that has never existed before.

```sh
pnpm add @bitsquare/nopy@main
```

Snapshots never reach npmjs and never move `latest`. The version is written into
the manifest on the runner with `npm pkg set` immediately before publishing; that
edit is discarded with the workspace and is never committed.

## Cutting a release

1. Bump `version` in `packages/<pkg>/package.json`.
2. Add a changelog entry (see below).
3. Commit, merge to `main`, and let the snapshot workflow go green.
4. Tag that commit and push the tag:

   ```sh
   git tag nopy-v1.2.0
   git push origin nopy-v1.2.0
   ```

The tag name is `<directory>-v<version>` — the directory under `packages/`, not
the npm name. `nopy-v1.2.0`, not `@bitsquare/nopy-v1.2.0`.

The tag decides **which** package ships; `package.json` decides the **version**.
The workflow re-reads the manifest and refuses to continue if the two disagree:

```
::error::Tag 'nopy-v1.2.0' asks for 1.2.0, but packages/nopy/package.json
declares 1.1.0. Bump the manifest and re-tag.
```

An unknown package name fails the same way. Both checks run before install, so a
typo costs you seconds.

Tagging one package does not touch the other. Two packages at the same version is
a coincidence, not a requirement.

What a successful run leaves behind:

- `@bitsquare/<pkg>@<version>` on the Gitea registry
- the same tarball on npmjs, public, under `latest` or `next`
- a Gitea release on the tag, with notes and an install snippet
- a step summary with both install commands

## Changelogs and release notes

Neither package has a `CHANGELOG.md` yet. Without one, the Gitea release body is
just the install snippet — nothing fails.

When you add one, `release.yml` extracts the section for the version being
released. The parser is deliberately dumb: it looks for the first `## ` heading
whose text contains the version string, and takes every line until the next `## `
heading. Any of these work:

```markdown
## 1.2.0

## [1.2.0] - 2026-07-27

## v1.2.0 — Faster inventory parsing
```

Version strings that are prefixes of each other are the one thing to watch: with
both `## 1.2.0` and `## 1.2.0-rc.1` in the file, releasing `1.2.0` matches
whichever heading comes first. Keep the newest at the top, as usual, and this
resolves itself.

## Secrets

Configure under **Settings → Actions → Secrets**, on the repository or on the
organisation to share across repos.

| Secret            | Required | Purpose                                                   |
| ----------------- | -------- | --------------------------------------------------------- |
| `NPM_TOKEN`       | yes      | npmjs granular token, read-and-write on `@bitsquare/*`      |
| `MYGITEA_NPM_TOKEN` | yes      | Gitea PAT with `write:package`                             |

`GITEA_TOKEN` is injected into every run by Gitea itself, and the workflows fall
back to it via `${{ secrets.MYGITEA_NPM_TOKEN || secrets.GITEA_TOKEN }}`. On
`gitea.bitsquare.dev` that fallback is **not** sufficient: the automatic token is
a short-lived task token scoped to git and repo API calls, and the package
registry rejects it with `E401 Incorrect or missing password` at the publish
step, with the gate already green. `MYGITEA_NPM_TOKEN` is therefore required in
practice. Create it under **Settings → Applications → Access Tokens** with the
`package` scope set to read-and-write; its owner needs package-write on the
`BitSquare` organisation, since the registry path is org-owned.

For npmjs, create a **granular access token** scoped to `@bitsquare/*` with
read-and-write permission, and set 2FA to not-required so it works
unattended. npm warns against that combination and points at Trusted Publishing
instead — but Trusted Publishing federates only GitHub Actions and GitLab CI/CD
over OIDC, and Gitea is not a provider it accepts. A token is the only route
from this runner. Scoping the token to `@bitsquare/*` is what keeps the exposure
small: a leak lets someone publish to that scope, not touch the account.

> npm caps granular token lifetime at 90 days, so `NPM_TOKEN` needs rotating
> roughly quarterly. The failure mode is gentle — an expired token trips the
> secret check in `release.yml` within seconds, before anything is installed or
> built. If it expires between the two registries, re-running after rotation is
> safe; the `npm view` guard skips whatever already published.

`release.yml` refuses to start if either token is missing, and says which one.

> npm `--provenance` is deliberately not used. It requires GitHub Actions OIDC,
> which Gitea has no equivalent for; passing the flag would only fail the
> publish. Releases are therefore unsigned in the provenance sense — the audit
> trail is the tag, the run log, and the Gitea release.

## Registry authentication in the workflows

`release.yml` has to talk to two different registries about the same `@bitsquare`
scope inside one job. It does that without ever mutating `~/.npmrc`:

- each publish step writes its own credentials file, created with
  `install -m 600 /dev/null` (which both sets the mode and truncates whatever was
  there before);
- `npm_config_userconfig` points npm at that file for the duration of the step;
- the npmjs step therefore starts from a file that no longer contains the Gitea
  token;
- a final `if: always()` step deletes it, so it does not survive into a later
  step or a cached workspace.

`.npmrc`, `.npmrc-*` and `release.json` are in `.gitignore`, so a credentials
file written into the workspace can never be committed by accident.

## Installing the packages

From npmjs — public, no configuration:

```sh
npm install -g @bitsquare/nopy @bitsquare/keyman
```

From the Gitea registry, which holds every snapshot plus a mirror of every
release. Per-project, in the repo's `.npmrc`:

```ini
@bitsquare:registry=https://gitea.bitsquare.dev/api/packages/BitSquare/npm/
```

Globally with credentials, in `~/.npmrc`:

```ini
@bitsquare:registry=https://gitea.bitsquare.dev/api/packages/BitSquare/npm/
//gitea.bitsquare.dev/api/packages/BitSquare/npm/:_authToken=<your gitea token>
```

Reads only need a token if the repository is private. The registry URL is derived
in the workflows as `{server_url}/api/packages/{owner}/npm/`, so it follows the
instance and organisation automatically.

To track snapshots in another project:

```sh
pnpm add @bitsquare/nopy@main
```

## Design decisions

**Every publish is idempotent.** Each step asks the registry whether that exact
version already exists (`npm view <name>@<version>`) and skips if it does. A
release that publishes to Gitea and then fails on npmjs can simply be re-run: the
Gitea publish is skipped, the npmjs publish proceeds. This matters because Gitea
refuses to overwrite an existing version — without the check, a re-run would fail
on the first registry and never reach the second.

**The build is explicit, publishes are `--ignore-scripts`.** `prepack` exists for
humans running `npm pack` locally; in CI the build has already run as its own
step, and repeating it inside `npm publish` would only cost time and add a way
for a lifecycle script to change what ships after the gate looked at it.

**One job per workflow.** No artifact hand-off, no second install, no risk of
publishing a tree that a different job built.

**Caching is best-effort.** `actions/cache@v4` is wrapped in
`continue-on-error: true`, and `setup-node`'s built-in `cache:` is not used, so
a Gitea runner without a cache backend still works.

**`actions/upload-artifact@v3`, not v4** — v4 depends on a backend API that many
Gitea runner setups do not implement.

**pnpm and Node versions come from the repo.** `pnpm/action-setup@v4` reads
`packageManager` from the root manifest; `setup-node` reads `.nvmrc`. There is no
version pinned in the workflow files to drift out of sync.

## Checking things locally

Reproduce the CI gate exactly:

```sh
pnpm install --frozen-lockfile
pnpm run lint:ci && pnpm run typecheck && pnpm run test:coverage
```

See what would actually be in the tarball:

```sh
pnpm run build
cd packages/nopy && npm pack --dry-run --ignore-scripts
```

Try the binary as an end user would get it, without publishing:

```sh
cd packages/nopy && pnpm run link:local   # build + npm link
nopy --help
npm unlink -g @bitsquare/nopy
```

Check that a version is not already taken before you tag:

```sh
npm view @bitsquare/nopy@1.2.0 version                    # npmjs
npm view @bitsquare/nopy@1.2.0 version \
  --registry https://gitea.bitsquare.dev/api/packages/BitSquare/npm/
```

## Troubleshooting

| Symptom                                                        | Cause and fix                                                                                 |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `Tag ... asks for X, but package.json declares Y`               | The manifest was not bumped, or the tag is on the wrong commit. Fix the manifest, re-tag.       |
| `Tag ... names package 'foo', but packages/foo/package.json does not exist` | Tag prefix must be the directory name under `packages/`.                             |
| `NPM_TOKEN secret is not set`                                   | Add the secret; the run stops before installing anything.                                       |
| `401`/`403` from the Gitea registry                             | The automatic `GITEA_TOKEN` lacks `write:package`. Add a `MYGITEA_NPM_TOKEN` PAT — no edit needed. |
| `E409 Conflict` / version already exists                        | Only reachable if a version was published outside the workflow; the `npm view` guard covers re-runs. |
| Coverage step fails, thresholds look met                        | Thresholds are per package. Read which package failed — the summary table shows both.           |
| `npm pack --dry-run` step fails                                 | A `files` or `bin` path no longer exists after the build. Fix before it reaches a registry.      |
| Snapshot workflow green, nothing installable                    | Snapshots are only on Gitea and only under `@main`. Point the scope at the Gitea registry.      |
| The release workflow did not trigger                            | The tag must match `*-v*` and must be pushed (`git push origin <tag>`), not just created.       |

## Recovering from a bad publish

**On npmjs**, a version is permanent. Do not try to re-use it — publish a patch.
Meanwhile:

```sh
npm dist-tag add @bitsquare/nopy@1.1.9 latest    # point users back
npm deprecate @bitsquare/nopy@1.2.0 "Broken build, use 1.2.1"
```

`npm unpublish` is only possible within 72 hours and burns the version number
forever; a deprecation with a working `latest` is almost always the better move.

**On Gitea**, delete the version under **Packages → @bitsquare/… → Settings**
before that exact version can be published again.

**A bad tag** can be moved, but only before the release workflow has published
anything:

```sh
git push --delete origin nopy-v1.2.0
git tag -d nopy-v1.2.0
```

Once a tarball is on npmjs, the tag is a historical record — leave it and roll
forward.

**A bad snapshot** needs no action at all: the next push to `main` produces a new
run number and therefore a new version, and `@main` moves to it.
