# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A pnpm workspace holding two independently published CLIs, the authoring package
their deployment units are written against, and one bundle of those units:

| Path                  | Package                | Binary   | Role                                                     |
| --------------------- | ---------------------- | -------- | -------------------------------------------------------- |
| `packages/nopy`       | `@bitsquare/nopy`      | `nopy`   | interactive pyinfra script management and execution      |
| `packages/keyman`     | `@bitsquare/keyman`    | `keyman` | SSH key management, shelling out to `age` / `ssh-keygen` |
| `packages/nopy-cube`  | `@bitsquare/nopy-cube` | —        | the authoring surface a `manifest.mjs` imports           |
| `packages/cubes-core` | `@bitsquare/cubes-core`| —        | the core cube bundle (22 cubes), no TypeScript           |

The root package is private; everything under `packages/` ships. `keyman` stands
alone, but `nopy` and `cubes-core` both depend on `nopy-cube` (`workspace:*`), so
publish order matters — see *Releasing*.

`cubes-core` is consumed the way a third party would consume it: the root
`.nopyrc.json` names it in `cubePackages`, and the loader reads it out of
`node_modules`. There is no `cubes/` directory at the repo root any more.

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

nopy's vitest config aliases `@bitsquare/nopy-cube` to that package's **source**,
not to the workspace link (which points at a `dist` that only exists after a
build), so the gate does not depend on build ordering and can never run against a
stale artefact. The same config excludes `**/nopy-cube/**` from coverage — without
it nopy's numbers absorb another package's files. `cubes-core` has no tests of its
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
   into a package root plus the directories its `nopy.cubes` field declares.
   Resolution goes through `createRequire(...).resolve.paths()` + `existsSync`,
   deliberately bypassing the `exports` map: a bundle ships directories and has
   no entry point to declare. `existsSync` also follows the symlink pnpm plants
   at `node_modules/<name>`, which a `readdir` scan skips outright (it reports
   `isSymbolicLink()`, not `isDirectory()`). A missing package, an unreadable
   manifest, a missing `nopy.cubes`, a directory that does not exist, and an
   entry pointing outside the package root are all errors, never silent skips.
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
   is no separate topological sort; ordering falls out of the recursion, and a
   `${cubeId}:${host}` set makes emission idempotent. Hooks get a `HookContext`
   whose `exec(id, vars)` re-enters `resolveCube`, so a hook can pull in a cube
   that is not a declared dependency.
6. **`nopy.executor.ts`** — runs the built `pyinfra <host> -y --data K=V ... --chdir <cubeDir> <script>`
   commands through execa with inherited stdio, sequentially, stopping at the
   first failure unless `continueOnError`.

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
`@bitsquare/nopy-cube`, and declare `id`, `name`, a Zod `schema` (each field
`.describe()`d — the description is the prompt label — and `.default()`ed), plus
optional `secrets`/`dependencies`/`before`/`after`.

Import from **`@bitsquare/nopy-cube`**, not `@bitsquare/nopy`. The authoring
surface is types and a factory, with zod as its only peer — no CLI, no prompts,
no process spawning — so a bundle can depend on it without dragging the CLI in.
`@bitsquare/nopy` re-exports all of it (`cubes.Manifest`, `cubes.uniqid`, …), so
the older form still works; every cube in `packages/cubes-core` has been moved to
the new one.

Manifests are resolved by ordinary Node resolution **from the manifest's own
directory**, which used to mean a hand-written local cube failed with
`ERR_MODULE_NOT_FOUND` unless you linked the package. `cubes/resolve-hook.mjs`
retires that: `loadCubes()` registers a `module.register()` resolve hook that
tries normal resolution *first* and only on failure falls back to resolving
`@bitsquare/nopy-cube`, `@bitsquare/nopy` and `zod` from the running CLI's own
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

Much smaller: `keyman.cli.ts` (argv, plus a `--print-config` escape hatch) →
`keyman.main.ts`, an inquirer menu loop dispatching to one module per operation
(`list`/`copy`/`generate`/`encrypt`/`decrypt`). `keyman.config.ts` mirrors nopy's
upward-traversal + `resolution` merge for `.keymanrc.json`, but validates the
result with Zod and falls back to defaults instead of throwing. `VAULT_ROOT` in
the environment beats the config file. Encryption shells out to `age` /
`age-keygen` / `ssh-keygen`, which must be on `PATH`.

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
pulls `nopy-cube` from Gitea and the other 55 packages from npmjs. pnpm accepts
the same flag; the `npm_config_@bitsquare:registry` env var does not work with
pnpm and is not used.

The duplication between the two modules is deliberate: keyman shares no internal
library with nopy, and a fifth workspace package for ~250 lines would add
another edge to the publish order. Extract it if a third CLI appears.

## Releasing

Tag-driven, one package at a time; see `README.PUBLISH.md`.

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
fine.) All four packages were reset to `0.5.0`; `1.0.0-alpha5` stays the
numerically highest version on npmjs, so install with an explicit `@latest`.

- Push to `main` → `publish-snapshot.yml` publishes every package to the Gitea
  registry as `<version>-main.<run>.g<sha>` under the `main` dist-tag. The
  version is set on the runner with `npm pkg set` and never committed.
- `git tag <dir>-v<version>` (e.g. `nopy-v1.2.0` — the directory under
  `packages/`, not the npm name) → `release.yml` publishes to Gitea *and* npmjs.
  The tag chooses the package, `package.json` supplies the version, and the run
  fails if they disagree. A prerelease version goes out as `next`, otherwise
  `latest`.

So: bump `packages/<pkg>/package.json`, land it on `main`, then tag that commit.

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
- **Order.** `packages/*/` sorts `nopy` before `nopy-cube`, which is backwards.
  `scripts/publish-order.mjs` topologically sorts over the `workspace:` edges;
  the snapshot workflow stamps *every* version first and only then publishes in
  that order, because `pnpm publish` reads the linked package's version at pack
  time. `release.yml` additionally refuses to ship a package whose linked
  dependency is not yet on npmjs (`scripts/linked-deps.mjs`) — npmjs is the
  registry you cannot take a mistake back from.

## Known drift

`logConfigToFlags()` is exported and tested but nothing feeds its output into the
built pyinfra command, so `log.verbosity` / `log.debug` in `.nopyrc.json`
currently have no effect. Treat `docs/REFACTORING.md` as a plan, not a record.

The publish lane has now run against the Gitea registry: all four packages are
there under `@main`, and `pnpm run try:snapshot` installs them into a throwaway
project with npm and runs the binary. The npmjs lane has only ever published
`@bitsquare/nopy`; `keyman`, `nopy-cube` and `cubes-core` have never been
released there, so the *check linked deps are released* guard in `release.yml`
will stop the first `nopy` release until `nopy-cube` ships.

Nothing checks that a bundle and the CLI reading it are compatible versions;
`nopy.engines` was considered and deferred. `docs/CUBE-PACKAGES.md` is where all
of this came from and is now a record of what was built, including what differed
from the plan.

`docs/API.md` was regenerated against the source and now covers every export in
`src/index.ts` plus the authoring package; its *Known gaps* section is the short
list of behaviour that surprises a reader (`--json` printing nothing on success,
`DeployCall.dependencies` always empty, `ExecutionResult.stdout` never populated,
no cycle detection, and `self-update` reporting an empty dist-tag as an
unreachable registry). `CubePackageRef` is referenced by the exported
`NopyConfig` but is not itself re-exported, so a consumer cannot name the type —
one line, not yet fixed. `DOCS-AUDIT.md` tracks the drift in the remaining
documents; §2.9 (the nopy README shipping yarn-workspace instructions to npmjs)
is closed, so the keyman README (§2.10) is now the worst of them.
