# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Rules

- Do not create branches without being asked

## What this repo is

A pnpm workspace holding two independently published CLIs, the authoring package
their deployment units are written against, and one bundle of those units:

| Path                       | Package                      | Binary   | Role                                                      |
| -------------------------- | ----------------------------- | -------- | -------------------------------------------------------- |
| `packages/nopy`            | `@bitsquare/nopy`            | `nopy`   | interactive pyinfra script management and execution      |
| `packages/keyman`          | `@bitsquare/keyman`          | `keyman` | SSH key management, shelling out to `age` / `ssh-keygen` |
| `packages/nopy-cubes`      | `@bitsquare/nopy-cubes`      | —        | the authoring surface a `manifest.mjs` imports           |
| `packages/nopy-cubes-core` | `@bitsquare/nopy-cubes-core` | —        | the core cube bundle (22 cubes), no TypeScript           |

The root package is private; everything under `packages/` ships. `keyman` stands
alone, but `nopy` and `nopy-cubes-core` both depend on `nopy-cubes` (`workspace:*`), so
publish order matters — see *Releasing*.

`nopy-cubes-core` is consumed the way a third party would consume it: the root
`.nopyrc.json` names it in `cubePackages`, and the loader reads it out of
`node_modules`. There is no `cubes/` directory at the repo root any more.

## Documenting

Be modest. Size the write-up to the change: most work needs none, and a small
module never earns a section in `docs/API.md`. Where a reason is genuinely
non-obvious, one comment next to the code beats three paragraphs in a document
nobody re-reads. Document the surprising, not the obvious.

## Commands

```sh
pnpm install                 # also installs the git hooks via simple-git-hooks
pnpm run build               # tsc --build across the TS packages (project references)
pnpm run typecheck           # tsc --build  (see below — it really does emit)
pnpm run lint                # biome check .          (lint:fix / lint:ci variants)
pnpm test                    # vitest run, every package with tests
pnpm run test:coverage       # vitest with the coverage gate
pnpm run coverage:summary    # renders the last coverage run as a Markdown table
pnpm run registry:status     # what is on Gitea vs npmjs, and what is Gitea-only
pnpm run try:snapshot        # install a published snapshot into a temp project and run it
```

Single package / single test:

```sh
pnpm --filter @bitsquare/nopy run test tests/config.test.ts     # one file
pnpm --filter @bitsquare/nopy run test -t "merges configs"      # by test name
pnpm --filter @bitsquare/nopy run test:watch
pnpm --filter @bitsquare/nopy run nopy                          # run the CLI from source via tsx
pnpm --filter @bitsquare/keyman run keyman
```

`typescript` is the 7.x native compiler, so `tsc` *is* the fast one — there is no
separate `tsgo` binary.

`typecheck` is plain `tsc --build`, not `--noEmit`. Once a project has
`references`, `--noEmit` is rejected outright (TS6310: *referenced project may
not disable emit*) — a composite project has to emit the declarations its
dependents read. So the typecheck writes `dist` as a side effect; it is
gitignored, and the upside is that the gate now also proves the build works.

## Verification gate

`lint:ci` → `typecheck` → `test:coverage` is one gate, run in three places: the
`pre-push` hook, `ci.yml` (non-`main`), and `publish-snapshot.yml` (`main`).
`pre-commit` runs Biome with fixes on staged files only. Bypass with
`SKIP_SIMPLE_GIT_HOOKS=1`; re-install after editing the hook config with
`pnpm exec simple-git-hooks`.

Coverage thresholds live in each package's `vitest.config.ts` (85 % branches and
functions, 80 % lines and statements), not in a CI flag — they fail identically
locally and on the runner. Barrel files (`src/index.ts`, `src/cubes/index.ts`,
`src/nopy.cubes.ts`) and the Commander argv wiring (`src/*.cli.ts`) are excluded;
adding logic to those files means moving it somewhere covered.

nopy's vitest config aliases `@bitsquare/nopy-cubes` to that package's **source**,
not to the workspace link (which points at a `dist` that only exists after a
build), so the gate does not depend on build ordering and can never run against a
stale artefact. The same config excludes `**/nopy-cubes/**` from coverage — without
it nopy's numbers absorb another package's files. `nopy-cubes-core` has no tests of its
own; the loader tests in nopy cover the contract it implements.

The three TS packages set `pool: 'forks'` because tests use `process.chdir()` — most
loader/config tests build a throwaway tree under `os.tmpdir()` and chdir into it,
since discovery is driven entirely by the working directory.

## nopy architecture

One pass per invocation, `nopy.main.ts` orchestrating:

1. **`nopy.config.ts`** — `loadConfig()` walks up from `process.cwd()` collecting
   every `.nopyrc.json` plus `~/.nopyrc.json`, then merges them root-first.
   Per-property strategy comes from the child's `resolution` block (`merge` is
   the default: arrays concatenate and dedupe, objects deep-merge; `override`
   replaces). Only properties listed in `PATH_PROPERTIES` (`cubeDirs`) get
   relative paths resolved against their own config file's directory;
   `cubePackages` needs the same origin for a different reason, so each entry is
   normalised into a `CubePackageRef {spec, from}` — `from` is the directory of
   the config that named it, which is where the package gets resolved from.
   **Throws**
   if no config file exists anywhere — which is why `nopy.cli.ts` calls it lazily
   inside the action, so `--help`/`--version` work outside a project.
2. **`cubes/packages.ts`** — `resolveCubePackages()` turns each `CubePackageRef`
   into a package root plus its cube directories. The location is a **convention**:
   `<root>/cubes`, so a bundle needs no nopy-specific `package.json` field at all.
   `nopy.cubes` survives only as an override, for the bundle whose cubes are
   elsewhere (`dist/cubes` after a build, say) — absent means the default, but
   present-and-malformed is an error rather than a fall back, since saying
   something that does not parse is not the same as saying nothing.
   Resolution goes through `createRequire(...).resolve.paths()` + `existsSync`,
   deliberately bypassing the `exports` map: a bundle ships directories and has
   no entry point to declare. `existsSync` also follows the symlink pnpm plants
   at `node_modules/<name>`, which a `readdir` scan skips outright (it reports
   `isSymbolicLink()`, not `isDirectory()`). A missing package, an unreadable
   manifest, no cube directory found, and an entry pointing outside the package
   root are all errors, never silent skips.
   Duplicate refs are deduped here, last-wins, because `mergeValue` only dedupes
   arrays of primitives and these are objects.
3. **`cubes/loader.ts`** — `findCubeRoots()` unions `config.cubeDirs`, the
   directories from `cubePackages`, and every ancestor directory holding a
   `.npcubes` marker, then scans each recursively (skipping dotted dirs and
   `node_modules`). A directory is a cube
   when it holds both a manifest (`manifest.mjs` or `*.manifest.mjs`) and a
   deploy script (`deploy.py` or `*.deploy.py`); manifests are loaded by dynamic
   `import()`. Cube id = `manifest.id` → a `[id]` prefix in `manifest.name` →
   the directory basename. Ids are flat and need not mirror the path
   (`cubes/network/tailscale` declares `net:tailscale`), and they are claimed
   **globally**, not per source: a duplicate is a hard error naming every
   claimant, with no precedence rule and no shadowing. Each cube carries a
   `source` — `{type: 'dir', dir}` or `{type: 'package', packageName, dir}` —
   which is what makes that error legible when the collision is between a local
   tree and an installed bundle. Duplicate ids and bad manifests become entries
   in `errors`, which aborts the run.
4. **`nopy.workflow.ts`** — picks interactive, file-replay, or history-replay and
   normalises all three into a `WorkflowResult`. Replays never re-prompt except
   for passwords (never persisted) and a missing host.
5. **`cubes/dependencies.ts` → `BuildContext.resolveCube()`** — the core.
   Recursive, per (cube, host): assign params and schema defaults → collect
   variables (prompt, or read them back from the session on replay) → run
   `before` hooks → resolve `manifest.dependencies(vars)` (dynamic: it receives
   the *collected* variables) → emit the deploy call → run `after` hooks. There
   is no separate topological sort; emission is post-order, so the ordering *is*
   topological without an algorithm computing it, and a `${cubeId}:${host}` set
   makes emission idempotent. Hooks get a `HookContext`
   whose `exec(id, vars)` re-enters `resolveCube`, so a hook can pull in a cube
   that is not a declared dependency.
   Cycles are caught by a separate **resolution stack** — a (cube, host) pair
   re-entered while still resolving raises with the whole path named. It has to
   be separate from `resolvedCubes`, which is written *after* the descent and so
   never sees a cycle at all, and which cannot be widened into a "seen" set
   because re-entering a finished cube with different `param` overrides is
   exactly what a dependency or a hook is for.
6. **`nopy.executor.ts`** — runs the built
   `pyinfra <host> -y [-vv] [--debug] --data K=V ... --chdir <cubeDir> <script>`
   commands through execa with inherited stdio, sequentially, stopping at the
   first failure unless `continueOnError`. `DeployCall.command` is a true argv
   and is spawned **without a shell**: it used to be joined into one string and
   run through `execa({shell: true})`, which made every `--data` value shell
   syntax — a password or a variable holding `;` or `$(…)` was executed. The only
   thing that joins it back into a string is `maskCommand()`, for display, which
   shell-quotes as it goes so `--print-only` output stays pasteable. The
   verbosity/debug flags come from `config.log` through `logConfigToFlags()`.

### Variables

`Variables` (`nopy.common.ts`) holds one `Variable` per (cube, key). A `Variable`
is a list of `Assignment {value, origin}`, and precedence is the `Origin` rank:
`default(0) < env(1) < session(2) < prompt(3) < param(4)`. There are no scope
bags — config `env` is seeded per cube as a real assignment, so the old
`get('global')` (a cube id that was never a cube) is gone, and a replay assigns at
`session` instead of being smuggled into the prompts bag.

`assignments` is the true history, newest first, never reordered. `ordered` is a
**stable** sort of it by rank; `value` / `origin` read its head. The stability is
load-bearing: it is what makes same-origin ties resolve to the newest while the
displaced value stays visible in the trace. The trace is never persisted.

`get(id)` returns the effective values (→ the pyinfra command line);
`persistable(id)` returns the same minus declared secrets (→ session and history).
Every schema key is guaranteed present on the pyinfra side; pyinfra parses
`--data` values itself, so `"true"` arrives as a bool and numeric strings as ints.

A manifest's `secrets: string[]` names schema keys holding sensitive values —
validated at load (an entry that is not a schema key aborts the run). Secrets are
excluded from `persistable()`, re-prompted on replay via `fillSessionGaps`
(`requiredKeys() ∪ secrets`), and masked by `maskCommand()` / `maskVariables()`
wherever a command is printed. Deliberately a plain array rather than zod
metadata: `.meta()` and `.describe()` live in the per-copy `z.globalRegistry`, so
a manifest built by a different zod copy would look up empty — fail-open is
tolerable for a prompt label and not for a secret marker. See `docs/REFACTORING.md`
items 6 and 7.

### Cube contract

A cube directory holds `manifest.mjs` + `deploy.py`; anything else in it is
ignored by the loader but reachable from the script, which runs with the cube
directory as its cwd. Manifests are ESM, import `Manifest` from
`@bitsquare/nopy-cubes`, and declare `id`, `name`, a Zod `schema` (each field
`.describe()`d — the description is the prompt label — and `.default()`ed), plus
optional `secrets`/`dependencies`/`before`/`after`.

Import from **`@bitsquare/nopy-cubes`**, not `@bitsquare/nopy`. The authoring
surface is types and a factory, with zod as its only peer — no CLI, no prompts,
no process spawning — so a bundle can depend on it without dragging the CLI in.
`@bitsquare/nopy` re-exports all of it (`cubes.Manifest`, `cubes.uniqid`, …), so
the older form still works; every cube in `packages/nopy-cubes-core` has been moved to
the new one.

Manifests are resolved by ordinary Node resolution **from the manifest's own
directory**, which used to mean a hand-written local cube failed with
`ERR_MODULE_NOT_FOUND` unless you linked the package. `cubes/resolve-hook.mjs`
retires that: `loadCubes()` registers a `module.register()` resolve hook that
tries normal resolution *first* and only on failure falls back to resolving
`@bitsquare/nopy-cubes`, `@bitsquare/nopy` and `zod` from the running CLI's own
`node_modules`. Ordinary-resolution-first is the load-bearing part — a cube that
ships its own zod keeps it. The hook is a convenience, never load-bearing:
registration is wrapped in a `try`, and a bundle installed properly never reaches
it. `dist/cubes/*.mjs` is copied by the build, not compiled — hence
`"build": "tsc && cp src/cubes/*.mjs dist/cubes/"`.

Its tests must spawn a real `node` child process. Written inside the vitest
worker they prove nothing: vite resolves the dynamic import itself, so they pass
whether or not the hook is installed — verified by commenting the registration
out and watching them stay green.

## keyman architecture

Much smaller: `keyman.cli.ts` (wiring only — argv parsing lives in
`keyman.args.ts`, which is covered, and the CLI is the error boundary that turns a
`UsageError` into one line instead of a stack trace) → `keyman.main.ts`, an
inquirer menu loop dispatching to one module per operation
(`list`/`copy`/`generate`/`encrypt`/`decrypt`/`rotate`/`retire`/`clear`).
`keyman.config.ts` mirrors nopy's upward traversal for `.keymanrc.json` but not
its `resolution` merge: every keyman property is a string, so a child simply wins
and the strategies could not change an outcome — see `docs/AUDIT.md` §3.3. It
validates with Zod, falls back to defaults instead of throwing, and warns about a
key it does not know rather than letting Zod strip it silently. `VAULT_ROOT` in
the environment beats the config file. It shells out to `age`, `age-keygen`
(`-y`, to derive the recipient from the identity rather than trusting the
`# public key:` comment) and `ssh-keygen` (`-y`, to recover a missing `.pub`),
which must be on `PATH`; `runTool` tells a missing binary apart from a refusing
one. Nothing shells out to `cp` or `chmod` any more — `decrypt` copies and
chmods in-process, because the old spawn left a private key at age's 0644 for the
length of two processes.

The write path is one function, `storeInVault` (`keyman.vault.ts`), shared by
`encrypt`, `generate` and `rotate`; `listVaultKeys` is the one reader of the
`<keysDir>/<name>/id_<name>.age` layout. Rotation is deliberately two operations
(`rotate` adds a replacement under the next name in the series, `retire` deletes
the superseded key), because a rotation that replaces the key in place locks you
out of the host it was for. keyman never handles a passphrase: `ssh-keygen`
prompts for it with stdio inherited, since `-N <value>` put it in argv where `ps`
could read it.

`docs/AUDIT.md` is a full audit of the package with each finding marked closed as
it landed, and `docs/PLAN.md` the ten phases that closed them. Both are records
now, not plans.

### Updating

`nopy.update.ts` and `keyman.update.ts` are two near-identical copies of one
module: derive the channel from the running version (`-main.` → `main`, any
other prerelease → `next`, clean → `latest`), resolve the registry from
`npm config get @bitsquare:registry`, read `dist-tags` off the packument with a
plain `fetch`, compare with semver. Nothing about the channel is stored — the
version you are running is the one piece of state that is always right, so an
upgrade cannot silently move you to a different channel.

They back a `self-update` subcommand and a once-a-day startup check whose hint
goes to **stderr**, so `--json` and `--print-only` stay machine-readable. The
cache is `~/.nopy/update-check.json` / `~/.keyman/update-check.json`; a
mismatched channel or registry in the cache is never treated as fresh. The
check is disabled whenever `CI` is set.

The install command uses `--@bitsquare:registry=<url>`, never `--registry`:
Gitea serves the `@bitsquare` scope and does **not** proxy npmjs, so a global
`--registry` would send every transitive dependency to a registry that has never
heard of them. Verified — `npm i -g @bitsquare/nopy@main --@bitsquare:registry=…`
pulls `nopy-cubes` from Gitea and the other 55 packages from npmjs. pnpm accepts
the same flag; the `npm_config_@bitsquare:registry` env var does not work with
pnpm and is not used.

The duplication between the two modules is deliberate: keyman shares no internal
library with nopy, and a fifth workspace package for ~250 lines would add
another edge to the publish order. Extract it if a third CLI appears.

## Releasing

Tag-driven, one package at a time; see `README.PUBLISH.md`.

`pnpm run release` (`scripts/release.mjs`, zx + enquirer + commander) is the
front door: pick packages, pick versions, write notes into `CHANGELOG.md`, run
the gate **against the bumped tree before committing** so a failure leaves
nothing to unpick, then commit, tag and push. Tags go out dependency-first and it
polls npmjs for each version before pushing the next — which is what replaced the
CI-side linked-deps guard. Tags are annotated (`-a -m`), not lightweight: a
lightweight tag is rejected outright under `tag.forceSignAnnotated`.

### Registry resolution

The repo commits a root `.npmrc` mapping `@bitsquare:registry` to the Gitea
registry, so every npm/pnpm command run from the repo — global installs
included, since npm reads the project file for those too — resolves the scope
from Gitea. `.gitignore` ignores `.npmrc` generally (the workflows write
credentials to `.npmrc-gitea` / `.npmrc-release`) and carries a `!/.npmrc`
negation for the root file, which holds the mapping and no token.

Not a trade against npmjs: Gitea is a strict superset for this scope, since
`release.yml` publishes to both and `publish-snapshot.yml` adds a `main`
snapshot per push. It cannot affect `pnpm install` either — every `@bitsquare`
range in the workspace is `workspace:*` resolving to `link:`, so nothing in the
tree is fetched from that scope.

Two consequences: a bare `npm view @bitsquare/…` from the repo now answers for
**Gitea**, and an *untagged* install resolves to nothing, because Gitea
publishes no `latest` tag yet — always name `@main` or `@next`.
`pnpm run registry:status` prints both registries side by side and marks the
versions Gitea has that npmjs does not.

The sharp edge is in CI. `@scope:registry` is resolved *before* `registry` for a
scoped package, so the scoped key beats a `--registry` flag; and a project
`.npmrc` outranks the userconfig the workflows write. With the committed file in
place, `pnpm publish --registry <npmjs>` was measured uploading to **Gitea**, and
the `npm view --registry <npmjs>` guard answered from Gitea and skipped the npmjs
publish. Both workflows now `rm -f .npmrc` after checkout *and* pass
`--@bitsquare:registry=<url>` on every publish and lookup; either alone is
sufficient, and both were verified with `pnpm publish --dry-run`. This is the
same reason `self-update` never emits a bare `--registry`.

**Versions are `0.x.y`, not `1.0.0-alphaN`.** The dist-tag rule in `release.yml`
is mechanical — anything with a `-` goes out as `next` — so while every package
carried an `alphaN` suffix, `latest` never moved. `latest` on npmjs pointed at
`1.0.0-alpha5` only because npmjs sets it on a package's *first* publish
regardless of `--tag`; on Gitea it did not exist at all. Note that `npm view
<name>` against a registry with no `latest` tag prints nothing and exits **0**,
which is why this looked like a working lookup. (`npm view <name>@<version>`
does exit 1 for a missing version, so the workflows' idempotency guards are
fine.) All four packages were reset to `0.5.0`, and `nopy`, `nopy-cubes` and
`nopy-cubes-core` have since gone out as `1.0.1` — the first release where
`latest` actually moved on both registries. `keyman` is still `0.7.0` and on
neither.

- Push to `main` → `publish-snapshot.yml` publishes every package to the Gitea
  registry as `<version>-main.<run>.g<sha>` under the `main` dist-tag. The
  version is set on the runner with `npm pkg set` and never committed. It skips
  commits whose message starts with `release:` — see *Runner contention* below.
- `git tag <dir>-v<version>` (e.g. `nopy-v1.2.0` — the directory under
  `packages/`, not the npm name) → `release.yml` publishes to Gitea *and* npmjs.
  The tag chooses the package, `package.json` supplies the version, and the run
  fails if they disagree. A prerelease version goes out as `next`, otherwise
  `latest`.

So: bump `packages/<pkg>/package.json`, land it on `main`, then tag that commit.

Both workflows also stamp `buildInfo.commit` (the 7-char sha) into the manifest
with the same `npm pkg set`, never committed either — the snapshot loop stamps
every package, and the release step stamps whichever one the tag named. Both
CLIs append it to `--version` in parentheses — `0.5.0 (ab12cd7)` — and print the
bare version when the field is absent, which is every run from source. The
version string itself is untouched: `nopy.cli.ts` and `keyman.cli.ts` decorate
only the string they print, while `updateNotice()` and `selfUpdate()` keep
reading the raw `version`, so channel derivation never sees the annotation. An
unknown top-level key is ignored by npm and `package.json` is always packed, so
nothing in `files` had to change. The two CLIs are kept in step here for the
same reason their update modules are duplicated rather than shared.

Three things the `workspace:*` links added, all of them non-obvious:

- **`pnpm publish`, never `npm publish`.** `link-workspace-packages` is unset and
  pnpm 10+ defaults it to `false`, so `workspace:*` is mandatory in the manifests
   — and npm does not understand it. `npm pack` ships the literal string and the
  install fails with `EUNSUPPORTEDPROTOCOL`; `pnpm pack`/`pnpm publish` substitute
  the real version at pack time. Both directions were measured, not assumed.
- **`scripts/verify-pack.mjs`** packs every non-private package and fails if any
  `workspace:` range survived into a tarball. It runs in both publish workflows.
  Note `pnpm pack` has no `--ignore-scripts` flag, so `prepack` does rebuild —
  which means the artefact under test is the one publish ships.
- **Order.** `packages/*/` sorts `nopy` before `nopy-cubes`, which is backwards.
  `scripts/publish-order.mjs` topologically sorts over the `workspace:` edges;
  the snapshot workflow stamps *every* version first and only then publishes in
  that order, because `pnpm publish` reads the linked package's version at pack
  time. `release.yml` used to additionally refuse to ship a package whose linked
  dependency was not yet on npmjs (`scripts/linked-deps.mjs`); that step is gone,
  and `scripts/release.mjs` enforces the same ordering earlier instead — it
  pushes tags dependency-first and polls npmjs for each version before pushing
  the next. `linked-deps.mjs` survives as a hand-check. A tag pushed some other
  way is no longer caught, which is the accepted cost.

## Known drift

`logConfigToFlags()` is now consumed by `buildDeployCall`, so `log.verbosity` /
`log.debug` in `.nopyrc.json` finally do what the README says. Note the
consequence: `packages/nopy/.nopyrc.json` has always asked for
`"verbosity": "trace", "debug": true`, and a run from that directory now actually
gets `-vvv --debug`. Treat `docs/REFACTORING.md` as a plan, not a record.

The publish lane has now run against the Gitea registry: all four packages are
there under `@main`, and `pnpm run try:snapshot` installs them into a throwaway
project with npm and runs the binary. The npmjs lane has published `nopy`,
`nopy-cubes` and `nopy-cubes-core` at `1.0.1`; `keyman` has never been released
there. Ordering used to be enforced by the *check linked deps are released*
guard in `release.yml`; now it is `pnpm run release` that holds `nopy`'s tag back
until `nopy-cubes` answers on npmjs.

### Runner contention

`scripts/release.mjs` pushes the branch and then the tags seconds apart.
`publish-snapshot.yml` keys its concurrency group on the branch and `release.yml`
keys its own on the tag, so the two workflows never gate each other — on a
single runner they simply race for it, and the branch push always wins. The
1.0.1 release is what surfaced this: the snapshot job wedged extracting a layer
of `runner-images:ubuntu-latest`, the release job never started, `release.mjs`
gave up after its 20-minute wait, and two of the three tags were left unpushed
while the report still printed a bold **Done**. Three things changed as a
result — the snapshot job skips `release:` commits, the wait offers to keep
waiting rather than giving up (no timeout survives a wedged runner), and the
final header says **Blocked** when it is. The tags were pushed by hand
afterwards; all three packages are on npmjs.

Nothing checks that a bundle and the CLI reading it are compatible versions;
`nopy.engines` was considered and deferred. `docs/CUBE-PACKAGES.md` is where all
of this came from and is now a record of what was built, including what differed
from the plan.

`docs/API.md` was regenerated against the source and now covers every export in
`src/index.ts` plus the authoring package; its *Known gaps* section is the short
list of behaviour that surprises a reader (`--json` printing nothing on success,
`DeployCall.dependencies` always empty, `ExecutionResult.stdout` never populated,
and `self-update` reporting an empty dist-tag as an unreachable registry).
`DOCS-AUDIT.md` tracks the drift in the remaining
documents; §2.9 (the nopy README shipping yarn-workspace instructions to npmjs)
and §2.10 (the keyman README describing four of nine operations and inventing a
tenth) are both closed. The keyman README now quotes `helpText()` verbatim and a
test fails if the two diverge, which is the shape worth copying for nopy.
