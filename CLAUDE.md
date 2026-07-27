# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A pnpm workspace holding two independently published CLIs plus the pyinfra
deployment units one of them runs:

| Path              | Package             | Binary   | Role                                                     |
| ----------------- | ------------------- | -------- | -------------------------------------------------------- |
| `packages/nopy`   | `@bitsquare/nopy`   | `nopy`   | interactive pyinfra script management and execution      |
| `packages/keyman` | `@bitsquare/keyman` | `keyman` | SSH key management, shelling out to `age` / `ssh-keygen` |
| `cubes/`          | —                   | —        | the deployment units `nopy` runs (not published)         |

The root package is private; only `packages/*` ship. The two packages do not
depend on each other.

## Commands

```sh
pnpm install                 # also installs the git hooks via simple-git-hooks
pnpm run build               # tsc --build across both packages (project references)
pnpm run typecheck           # tsc --build --noEmit
pnpm run lint                # biome check .          (lint:fix / lint:ci variants)
pnpm test                    # vitest run, both packages
pnpm run test:coverage       # vitest with the coverage gate
pnpm run coverage:summary    # renders the last coverage run as a Markdown table
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

Both packages set `pool: 'forks'` because tests use `process.chdir()` — most
loader/config tests build a throwaway tree under `os.tmpdir()` and chdir into it,
since discovery is driven entirely by the working directory.

## nopy architecture

One pass per invocation, `nopy.main.ts` orchestrating:

1. **`nopy.config.ts`** — `loadConfig()` walks up from `process.cwd()` collecting
   every `.nopyrc.json` plus `~/.nopyrc.json`, then merges them root-first.
   Per-property strategy comes from the child's `resolution` block (`merge` is
   the default: arrays concatenate and dedupe, objects deep-merge; `override`
   replaces). Only properties listed in `PATH_PROPERTIES` (`cubeDirs`) get
   relative paths resolved against their own config file's directory. **Throws**
   if no config file exists anywhere — which is why `nopy.cli.ts` calls it lazily
   inside the action, so `--help`/`--version` work outside a project.
2. **`cubes/loader.ts`** — `findCubeDirectories()` unions `config.cubeDirs` with
   every ancestor directory holding a `.npcubes` marker, then scans each
   recursively (skipping dotted dirs and `node_modules`). A directory is a cube
   when it holds both a manifest (`manifest.mjs` or `*.manifest.mjs`) and a
   deploy script (`deploy.py` or `*.deploy.py`); manifests are loaded by dynamic
   `import()`. Cube id = `manifest.id` → a `[id]` prefix in `manifest.name` →
   the directory basename. Ids are flat and need not mirror the path
   (`cubes/network/tailscale` declares `net:tailscale`). Duplicate ids and bad
   manifests become entries in `errors`, which aborts the run.
3. **`nopy.workflow.ts`** — picks interactive, file-replay, or history-replay and
   normalises all three into a `WorkflowResult`. Replays never re-prompt except
   for passwords (never persisted) and a missing host.
4. **`cubes/dependencies.ts` → `BuildContext.resolveCube()`** — the core.
   Recursive, per (cube, host): assign params and schema defaults → collect
   variables (prompt, or read them back from the session on replay) → run
   `before` hooks → resolve `manifest.dependencies(vars)` (dynamic: it receives
   the *collected* variables) → emit the deploy call → run `after` hooks. There
   is no separate topological sort; ordering falls out of the recursion, and a
   `${cubeId}:${host}` set makes emission idempotent. Hooks get a `HookContext`
   whose `exec(id, vars)` re-enters `resolveCube`, so a hook can pull in a cube
   that is not a declared dependency.
5. **`nopy.executor.ts`** — runs the built `pyinfra <host> -y --data K=V ... --chdir <cubeDir> <script>`
   commands through execa with inherited stdio, sequentially, stopping at the
   first failure unless `continueOnError`.

### Variables

`Variables` (`nopy.common.ts`) keeps three per-cube scopes plus one global bag.
`get(id)` merges them lowest-to-highest: `global` (from config `env`) →
`defaults` (Zod `.default()`, and recorded session values on replay) → `prompts`
(what the user typed) → `params` (values passed by a dependency spec or hook).
Every schema key is guaranteed present on the pyinfra side; pyinfra parses
`--data` values itself, so `"true"` arrives as a bool and numeric strings as ints.

### Cube contract

A cube directory holds `manifest.mjs` + `deploy.py`; anything else in it is
ignored by the loader but reachable from the script, which runs with the cube
directory as its cwd. Manifests are ESM, import `cubes.Manifest` from
`@bitsquare/nopy`, and declare `id`, `name`, a Zod `schema` (each field
`.describe()`d — the description is the prompt label — and `.default()`ed), plus
optional `dependencies`/`before`/`after`.

**Gotcha:** those manifests resolve `@bitsquare/nopy` through ordinary Node
resolution from the manifest's own directory. Nothing in this repo links the
package into `cubes/` or `packages/nopy/cubes/`, so loading them fails with
`ERR_MODULE_NOT_FOUND` until you link it (`pnpm --filter @bitsquare/nopy run
link:local`, then `npm link @bitsquare/nopy` where you run from).

## keyman architecture

Much smaller: `keyman.cli.ts` (argv, plus a `--print-config` escape hatch) →
`keyman.main.ts`, an inquirer menu loop dispatching to one module per operation
(`list`/`copy`/`generate`/`encrypt`/`decrypt`). `keyman.config.ts` mirrors nopy's
upward-traversal + `resolution` merge for `.keymanrc.json`, but validates the
result with Zod and falls back to defaults instead of throwing. `VAULT_ROOT` in
the environment beats the config file. Encryption shells out to `age` /
`age-keygen` / `ssh-keygen`, which must be on `PATH`.

## Releasing

Tag-driven, one package at a time; see `README.PUBLISH.md`.

- Push to `main` → `publish-snapshot.yml` publishes both packages to the Gitea
  registry as `<version>-main.<run>.g<sha>` under the `main` dist-tag. The
  version is set on the runner with `npm pkg set` and never committed.
- `git tag <dir>-v<version>` (e.g. `nopy-v1.2.0` — the directory under
  `packages/`, not the npm name) → `release.yml` publishes to Gitea *and* npmjs.
  The tag chooses the package, `package.json` supplies the version, and the run
  fails if they disagree. A prerelease version goes out as `next`, otherwise
  `latest`.

So: bump `packages/<pkg>/package.json`, land it on `main`, then tag that commit.

## Known drift

`logConfigToFlags()` is exported and tested but nothing feeds its output into the
built pyinfra command, so `log.verbosity` / `log.debug` in `.nopyrc.json`
currently have no effect. Treat `docs/REFACTORING.md` as a plan, not a record.
