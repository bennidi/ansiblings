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
- [Resolving from Gitea in this repo](#resolving-from-gitea-in-this-repo)
- [Testing a snapshot before you release](#testing-a-snapshot-before-you-release)
- [Upgrading an installed CLI](#upgrading-an-installed-cli)
- [Design decisions](#design-decisions)
- [Checking things locally](#checking-things-locally)
- [Troubleshooting](#troubleshooting)
- [Recovering from a bad publish](#recovering-from-a-bad-publish)

## What ships

| Directory             | Package                 | Binary   | Kind                     |
| --------------------- | ----------------------- | -------- | ------------------------ |
| `packages/nopy`       | `@bitsquare/nopy`       | `nopy`   | CLI                      |
| `packages/keyman`     | `@bitsquare/keyman`     | `keyman` | CLI                      |
| `packages/nopy-cube`  | `@bitsquare/nopy-cube`  | —        | library (cube authoring) |
| `packages/cubes-core` | `@bitsquare/cubes-core` | —        | cube bundle (no build)   |

All are ESM and declare `engines.node >= 22`. The two CLIs expose a single
executable through `bin`, so `npm install -g` puts `nopy` / `keyman` on the
`PATH`; the other two are libraries you add to a project.

The tarball contents are pinned by `files` — for the three TypeScript packages
that is `["dist", "README.md", "LICENSE"]`, so sources and tests are not shipped.
`cubes-core` ships `["cubes", "!cubes/**/*.log", "README.md", "LICENSE"]`: the
negation matters, because a cube that has been run leaves a `pyinfra-debug.log`
next to its `deploy.py`, and `.gitignore` does not filter an npm tarball.
`publishConfig.access: "public"` is what makes a scoped package publishable to
npmjs without an extra flag; the workflows pass `--access public` anyway.

### Dependencies between them

`keyman` stands alone. `nopy` and `cubes-core` both depend on `nopy-cube` through
`workspace:*`, which drives three rules the rest of this document keeps coming
back to:

1. **Publish with `pnpm`, not `npm`.** `link-workspace-packages` is unset and
   pnpm 10+ defaults it to `false`, so `workspace:*` is mandatory in the
   manifests. npm has no idea what that protocol is: `npm pack` copies the string
   through verbatim and the install fails with `EUNSUPPORTEDPROTOCOL`. `pnpm
   pack` and `pnpm publish` substitute the concrete version at pack time. Both
   workflows use `pnpm publish --ignore-scripts --no-git-checks`.
2. **`nopy-cube` publishes before anything that depends on it.**
   `node scripts/publish-order.mjs` prints the publishable directories in
   dependency order — note that plain alphabetical `packages/*/` gets this
   backwards, putting `nopy` first.
3. **Every packed manifest is checked.** `node scripts/verify-pack.mjs` packs
   each non-private package and fails if any `workspace:` range survived into the
   tarball. It runs in both publish workflows, after the build.

Versions and changelogs are maintained **by hand**. Nothing in CI commits a
version bump, opens a release PR, or pushes a tag. A release happens because you
tagged a commit whose manifest already carries the version you want.

## The three workflows

All three live in [`.gitea/workflows`](.gitea/workflows) and run on the
`ubuntu-latest` runner label.

| Workflow               | Trigger                          | Publishes                                  |
| ---------------------- | -------------------------------- | ------------------------------------------ |
| `ci.yml`               | pull requests, non-`main` pushes | nothing                                    |
| `publish-snapshot.yml` | pushes to `main`                 | **every** package → Gitea, tag `main`      |
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
        → build → npm pack --dry-run (per package) → verify-pack
        → upload coverage
```

The `npm pack --dry-run --ignore-scripts` step prints the exact file list that
would be published. It is there to catch a `files` or `bin` entry pointing at
something the build no longer produces — a failure that would otherwise only
surface after the version is already on a registry and immutable. `verify-pack`
then packs for real and checks no `workspace:` range survived; both publish
workflows run it too, but running it here is what puts the failure on the pull
request rather than on the release.

Coverage HTML/JSON reports are uploaded as a `coverage` artifact with a 7-day
retention. Both the artifact upload and the store cache are
`continue-on-error: true`, so a runner without a cache or artifact server gets
slower CI rather than broken CI.

### `publish-snapshot.yml`

```
checkout → pnpm → node → cache → install
        → lint:ci → typecheck → test:coverage → coverage summary → build
        → verify-pack → write .npmrc → publish every package → delete .npmrc
```

One job, no `needs:` barrier, so install and build happen exactly once and
nothing has to be passed between jobs as an artifact.

The publish step is **two passes** over `node scripts/publish-order.mjs`: the
first stamps the snapshot version into every manifest with `npm pkg set`, the
second publishes. They cannot be one loop — `pnpm publish` reads a linked
package's version out of its manifest at pack time, so stamping and publishing
one package at a time would bake the *old* `nopy-cube` version into `nopy`'s
tarball.

### `release.yml`

```
checkout → resolve tag → check secrets
        → pnpm → node → cache → install → check linked deps are released
        → lint:ci → typecheck → test:coverage → build → verify-pack
        → publish to Gitea → publish to npmjs → delete .npmrc
        → create the Gitea release → step summary
```

Tag resolution and the secret check run **before** anything is installed or
built, so a malformed tag or a missing token fails in seconds instead of after
the whole gate.

*Check linked deps are released* asks npmjs whether every `workspace:` dependency
of the package being released already exists at the version pnpm is about to
bake in (`scripts/linked-deps.mjs` → `npm view`). Tagging `nopy-v1.3.0` while
`@bitsquare/nopy-cube@1.1.0` is still unpublished would otherwise ship a tarball
nobody can install, and npmjs only lets you unpublish for 72 hours. The check is
npmjs-only: it runs before any credentials are written, and npmjs is the registry
where the mistake is permanent.

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
| push to `main`                            | `0.5.0-main.42.g736c012`      | Gitea        | `main`   |
| tag `nopy-v0.6.0`                         | `0.6.0`                       | Gitea, npmjs | `latest` |
| tag `nopy-v0.6.0-rc.1`                    | `0.6.0-rc.1`                  | Gitea, npmjs | `next`   |

The rule for the dist-tag is mechanical: a version containing a prerelease part
(anything with a `-` in it) goes out as `next` and is marked as a prerelease on
the Gitea release; anything else goes out as `latest`. There is no way to publish
a prerelease over `latest` by accident.

### Why 0.x and not 1.0.0-alphaN

The packages used to be numbered `1.0.0-alpha5`, `1.0.0-alpha0` and so on. Every
one of those is a prerelease, so the rule above sent every release to `next` and
**`latest` never moved**. That is a quiet failure rather than a loud one: on
npmjs `latest` happened to point at `1.0.0-alpha5` only because npmjs sets
`latest` on a package's *first* publish whatever `--tag` says, and it would have
stayed pinned there through every subsequent alpha. On Gitea, which has no such
fallback, `latest` did not exist at all — and `npm view @bitsquare/nopy` against
a registry with no `latest` prints nothing and exits **0**, so it looks like a
successful lookup of a package with no data.

`0.x.y` says the same thing about stability that `1.0.0-alphaN` was trying to
say, while leaving the prerelease slot free for actual release candidates. So
`latest` rolls on every release, `next` means what it says, and no dist-tag has
to be moved by hand.

> **One-off consequence of the switch.** `1.0.0-alpha5` is semver-*greater* than
> any `0.x`, and it is already on npmjs. Publishing `0.5.0` moves the `latest`
> tag to it correctly, but the alpha remains the numerically highest version on
> the registry. Install with an explicit tag (`npm i -g @bitsquare/nopy@latest`,
> which follows the tag and will downgrade), not with `npm update -g`. Consider
> `npm deprecate '@bitsquare/nopy@1.0.0-alpha5' 'Superseded by the 0.x line'` so
> nobody lands on it by pinning.

## Snapshots

Every commit that lands on `main` publishes every package to the Gitea registry,
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
the npm name. `nopy-v1.2.0`, not `@bitsquare/nopy-v1.2.0`. All four prefixes work
the same way:

```sh
git tag nopy-v1.2.0
git tag keyman-v1.2.0
git tag nopy-cube-v1.2.0
git tag cubes-core-v1.2.0
```

### Ordering when more than one package changed

Tags are independent, but the dependency graph is not. If a release touches
`nopy-cube` *and* something that depends on it, release them in this order,
waiting for each run to go green:

```
nopy-cube  →  nopy, cubes-core   (these two are independent of each other)
```

Release `nopy` first and the run stops at the *check linked deps* step, telling
you the `nopy-cube` version it wanted is not on npmjs. That is the guard working;
release `nopy-cube`, then re-tag. `node scripts/publish-order.mjs` prints the
order if you would rather not reason about it.

Bumping `nopy-cube` means bumping the packages that depend on it in the same
change — the `workspace:*` range resolves to whatever version is in the workspace
at pack time, so their next release picks it up whether or not you meant it to.

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

From npmjs — public, no configuration. The CLIs go on the `PATH`:

```sh
npm install -g @bitsquare/nopy @bitsquare/keyman
```

The other two go into a project. A cube bundle is a dev dependency of whatever
repo describes your infrastructure; `nopy-cube` is only needed if you are writing
cubes of your own:

```sh
pnpm add -D @bitsquare/cubes-core     # then name it in .nopyrc.json cubePackages
pnpm add -D @bitsquare/nopy-cube zod  # authoring your own manifests
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

> Always map the **scope**, never set a bare `registry=`. The Gitea registry
> serves `@bitsquare` packages and does not proxy npmjs, so a global
> `--registry` sends `commander`, `execa`, `zod` and everything else to a
> registry that has never heard of them. The CLI's own `self-update` builds
> `--@bitsquare:registry=<url>` for the same reason.

## Resolving from Gitea in this repo

This repository ships a root [`.npmrc`](.npmrc) that maps the scope:

```ini
@bitsquare:registry=https://gitea.bitsquare.dev/api/packages/BitSquare/npm/
```

So any npm or pnpm command run from inside the repo resolves `@bitsquare/*` from
Gitea, with no flags — including a global install, since npm reads the project
`.npmrc` for those too:

```sh
npm install -g @bitsquare/nopy@main       # the newest snapshot, no flags needed
```

This is not a trade against npmjs. Gitea is a strict **superset** of it for this
scope: `release.yml` publishes to both, `publish-snapshot.yml` pushes a `main`
snapshot to Gitea on every push, and today three of the four packages exist
*only* there. Pointing the scope at Gitea gains the snapshots and loses nothing.

`.npmrc` is otherwise gitignored — the publish workflows write credentials into
`.npmrc-gitea` / `.npmrc-release` — so `.gitignore` carries a `!/.npmrc`
negation for the root file specifically. **It contains the scope mapping and
nothing else.** Reads are anonymous; no token belongs in a committed file.

It cannot affect `pnpm install`: every `@bitsquare` dependency in the workspace
is a `workspace:*` range that resolves to a `link:`, so nothing in the tree is
ever fetched from that scope. Verified with `pnpm install --frozen-lockfile`.

Two consequences worth knowing:

- **An untagged install resolves to nothing.** Gitea currently publishes no
  `latest` dist-tag, so `npm i -g @bitsquare/nopy` finds no version — and npm
  reports that by printing nothing and exiting 0. Always name a tag (`@main`,
  `@next`) until the first `0.x` release lands. See
  [Why 0.x and not 1.0.0-alphaN](#why-0x-and-not-100-alphan).
- **Bare lookups now answer for Gitea.** `npm view @bitsquare/nopy …` run from
  the repo queries Gitea. Pass `--registry https://registry.npmjs.org/` when you
  specifically mean npmjs.

To see both registries at once — which versions exist where, and which are on
Gitea only and therefore still testable and still un-published:

```sh
pnpm run registry:status
pnpm run registry:status -- --json
```

Working **outside** the repo, set the same mapping globally once:

```sh
npm config set @bitsquare:registry https://gitea.bitsquare.dev/api/packages/BitSquare/npm/
npm config delete @bitsquare:registry     # back to npmjs
```

`nopy self-update` reads that key too (`npm config get @bitsquare:registry`), so
a CLI installed from Gitea keeps checking Gitea for its own updates with nothing
else configured.

### Why the publish jobs delete it

A scoped mapping is not just another way to say `--registry`. For a **scoped**
package npm resolves `@scope:registry` *before* `registry`, so the scoped key
wins no matter how the plain one was set — including on the command line. And a
project `.npmrc` outranks the userconfig the workflows write.

Left in place, that combination silently redirects the npmjs release lane:

```console
$ pnpm publish --tag latest --access public --registry https://registry.npmjs.org/ --dry-run
📦 @bitsquare/nopy@0.5.0 → https://gitea.bitsquare.dev/api/packages/BitSquare/npm/
```

Not hypothetical — that is the workflow's own command, measured. The
`npm view … --registry <npmjs>` idempotency guard inverts the same way: it
answers from Gitea, finds the version already there, and **skips the npmjs
publish entirely**. A release that reports success and shipped nothing.

Both publish workflows therefore `rm -f .npmrc` right after checkout, and every
publish and lookup names its registry as `--@bitsquare:registry=<url>`. Either
fix alone is sufficient — both are verified independently — and the pair means a
command added later cannot quietly inherit the wrong registry. Nothing else in
the job is affected: every `@bitsquare` range in the workspace is `workspace:*`,
so no install resolves through that scope.

## Testing a snapshot before you release

Every push to `main` publishes a snapshot, so the rehearsal for a release is to
install one the way a stranger would:

```sh
pnpm run try:snapshot                                  # @main from Gitea
pnpm run try:snapshot -- --tag latest                  # a release, from Gitea
pnpm run try:snapshot -- --registry https://registry.npmjs.org/
pnpm run try:snapshot -- --keep                        # keep the directory
```

`scripts/try-snapshot.mjs` builds a throwaway project in a temp directory,
points the `@bitsquare` scope at the registry, installs `@bitsquare/nopy` and
`@bitsquare/cubes-core` at that tag, and then:

- asserts the installed `nopy` declares a **concrete** `nopy-cube` version
  rather than a leaked `workspace:*` range;
- prints the three resolved versions, so you can see which commit you are on;
- runs `nopy --version`;
- runs `nopy install -P -D` with stdin closed and asserts the cube-selection
  prompt listed cubes from the bundle — which only happens if the loader
  resolved the package out of `node_modules` and imported every manifest.

It uses **npm**, not pnpm, on purpose: npm is the client that rejects a leaked
`workspace:` range, so a clean install here is the stronger proof. This is the
check `verify-pack.mjs` cannot be — that one inspects a local tarball, this one
goes to the real registry and runs the real binary.

The directory is deleted on success and left behind on failure, with its path
printed.

## Upgrading an installed CLI

Both CLIs can update themselves:

```sh
nopy self-update
keyman self-update
```

Each derives its channel from the version it is running — a `-main.` prerelease
came from the snapshot workflow, any other prerelease from `next`, a clean
version from `latest` — so an upgrade keeps you on the channel you installed
from instead of quietly moving you to another one. The registry comes from
`npm config get @bitsquare:registry`, so an install from Gitea checks Gitea
without any further configuration. The package manager is detected from the
install path (npm, pnpm, yarn or bun), so the update does not leave two copies
on the `PATH`.

```sh
nopy self-update --dry-run          # print the command, change nothing
nopy self-update --force            # reinstall even when up to date
nopy self-update --channel next     # switch channel
nopy self-update --registry <url>   # check somewhere else
```

Once a day each CLI checks its channel at startup and prints a one-line hint to
**stderr** when something newer exists — never stdout, so `--json` and
`--print-only` stay machine-readable. Results are cached in
`~/.nopy/update-check.json` and `~/.keyman/update-check.json`; an unreachable
registry gets 1.5 seconds and is then ignored. The check is off whenever `CI` is
set, and `NOPY_NO_UPDATE_CHECK=1` / `KEYMAN_NO_UPDATE_CHECK=1` turn it off
explicitly. `NOPY_REGISTRY`, `NOPY_REGISTRY_TOKEN` and `NOPY_PACKAGE_MANAGER`
(and the `KEYMAN_` equivalents) override the three things it detects.

The logic lives in `packages/nopy/src/nopy.update.ts` and
`packages/keyman/src/keyman.update.ts` — two near-identical copies. keyman
shares no internal library with nopy by design, and a fifth workspace package
for ~250 lines would add another edge to the publish order for nothing. If a
third CLI appears, extract it then.

## Design decisions

**Every publish is idempotent.** Each step asks the registry whether that exact
version already exists (`npm view <name>@<version>`) and skips if it does. A
release that publishes to Gitea and then fails on npmjs can simply be re-run: the
Gitea publish is skipped, the npmjs publish proceeds. This matters because Gitea
refuses to overwrite an existing version — without the check, a re-run would fail
on the first registry and never reach the second.

**The build is explicit, publishes are `--ignore-scripts`.** `prepack` exists for
humans packing locally; in CI the build has already run as its own step, and
repeating it inside `pnpm publish` would only cost time and add a way for a
lifecycle script to change what ships after the gate looked at it.

**`verify-pack.mjs` checks the artefact, not the source.** Reading `package.json`
in the repo would only tell you what you already know — every one of them says
`workspace:*`. The question is what pnpm wrote into the tarball, so the script
packs, extracts `package/package.json`, and reads the ranges back out. It cannot
pass `--ignore-scripts`, because `pnpm pack` has no such flag (only `pnpm publish`
does), so `prepack` rebuilds — which at least means the tarball under test is
byte-for-byte the one publish would ship.

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
cd packages/nopy && pnpm pack --dry-run
```

Check that no `workspace:` range leaks into a published manifest — the same
check CI runs:

```sh
node scripts/verify-pack.mjs
node scripts/publish-order.mjs             # the order to release in
node scripts/linked-deps.mjs packages/nopy # what must be on the registry first
```

See what is on each registry, and which versions Gitea has that npmjs does not:

```sh
pnpm run registry:status
```

Rehearse an install against a registry that has actually been published to —
see [Testing a snapshot](#testing-a-snapshot-before-you-release):

```sh
pnpm run try:snapshot
```

Rehearse an install the way a stranger gets one, without publishing anything.
Use **npm**, not pnpm: npm is the one that rejects a leaked `workspace:` range,
so a clean install here is the real proof.

```sh
pnpm --filter @bitsquare/nopy-cube pack --pack-destination /tmp/tgz
pnpm --filter @bitsquare/nopy      pack --pack-destination /tmp/tgz
pnpm --filter @bitsquare/cubes-core pack --pack-destination /tmp/tgz

mkdir /tmp/try && cd /tmp/try && npm init -y
npm install /tmp/tgz/*.tgz
echo '{"hosts":["h"],"cubePackages":["@bitsquare/cubes-core"]}' > .nopyrc.json
./node_modules/.bin/nopy install -l session.json -P -D
```

Try the binary as an end user would get it, without publishing:

```sh
cd packages/nopy && pnpm run link:local   # build + npm link
nopy --help
npm unlink -g @bitsquare/nopy
```

Check that a version is not already taken before you tag. The repo's `.npmrc`
points the scope at Gitea, so the bare lookup answers for Gitea and npmjs is the
one that needs the explicit flag:

```sh
npm view @bitsquare/nopy@1.2.0 version                                          # Gitea
npm view @bitsquare/nopy@1.2.0 version --registry https://registry.npmjs.org/   # npmjs
```

Or both registries, every package, in one table:

```sh
pnpm run registry:status
```

> `npm view <name>@<version>` exits 1 for a version that does not exist, so it is
> a sound check. `npm view <name>` — no version — is **not**: against a registry
> with no `latest` tag it prints nothing and exits 0.

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
| `EUNSUPPORTEDPROTOCOL` / `Unsupported URL Type "workspace:"` on install | A `workspace:` range reached a tarball — something published with `npm publish` instead of `pnpm publish`. `verify-pack.mjs` exists to catch this before it ships. |
| `... is not published yet on npmjs` before the gate runs        | Releasing a package before its `nopy-cube` dependency. Tag and release `nopy-cube` first, then re-tag. |
| `verify-pack.mjs` fails locally with a build error              | `pnpm pack` runs `prepack`, so a broken build fails the check. Fix the build; there is no skip flag. |

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
