# Cube bundles as npm packages

Status: **All six phases have landed. This document is now a record, not a plan.**
The one thing still unproven is the publish lane against a real registry — see
*Risks*.
`cubePackages` resolves and loads end to end, `@bitsquare/nopy-cubes` exists and
the publish lane can ship a linked package. What is missing is a bundle to point
`cubePackages` at.

Distributing cubes as npm packages so a project can `pnpm add @acme/cubes-net`
and have its cubes show up in `nopy` alongside local ones.

## Goals

- A cube bundle is an ordinary npm package, publishable to npmjs or Gitea
  through the existing release lanes.
- A consuming project opts into a bundle explicitly, by name, in `.nopyrc.json`.
- Existing manifests, dependency specs (`dependencies: () => ['apt:essentials']`)
  and stored session history keep working untouched.
- The in-repo `cubes/` tree becomes the first published bundle, proving the path.

## Non-goals

- Automatic discovery of bundles from the dependency tree. Cubes run privileged
  deploy scripts against real hosts; a transitive dependency contributing one
  silently is a supply-chain hole. Opt-in per package, always.
- Namespacing or id rewriting. Ids stay flat and global (see *Decisions*).
- Version compatibility checks between a bundle and the `nopy` running it.
  Noted as a risk, deferred.

## Decisions

| Question | Decision |
| --- | --- |
| Duplicate cube ids across sources | **Hard error.** No precedence, no shadowing. Mitigation is a good error message, not a fallback. |
| Id format | Unchanged, flat. The id is the session key (`dependencies.ts:135`); changing it breaks `--repeat-last` and `--history`. |
| Discovery | Explicit `cubePackages` list in `.nopyrc.json`. |
| Migrate in-repo `cubes/` | Yes — `packages/nopy-cubes-core`, as the proof of concept. |
| Split an authoring package (`@bitsquare/nopy-cubes`) | **Yes.** Bundles take a regular dependency on it; `@bitsquare/nopy` re-exports it for backwards compatibility. See *Phase 4*. |

## Current state

What already works, unchanged:

- `--chdir <cubeDir>` (`nopy.executor.ts`) means a `deploy.py` under
  `node_modules` runs fine; pyinfra only needs the path.
- `scanDirectory` skips `node_modules` when *descending* (`loader.ts:101`), not
  for the root it is handed. So `"cubeDirs": ["./node_modules/@acme/cubes-net/cubes"]`
  works today. That is the escape hatch until this lands, and it stays working
  afterwards.

What blocks a clean story:

1. **Manifest imports.** `manifest.mjs` does `import { cubes } from '@bitsquare/nopy'`,
   resolved by ordinary Node resolution from the manifest's own directory. From
   inside `node_modules/@acme/cubes-net/`, that resolves upward into the
   consumer's `node_modules` — fine if the consumer installed `@bitsquare/nopy`,
   `ERR_MODULE_NOT_FOUND` if `nopy` is only installed globally. Same gotcha
   CLAUDE.md already documents for the local `cubes/` tree.
2. **No way to name a package** in config, only paths.
3. **Recursively scanning `node_modules` is not a workaround.** pnpm symlinks
   direct deps, and `readdir(withFileTypes)` reports a symlink as
   `isSymbolicLink()`, not `isDirectory()` — the scan would skip every package.
   Package roots must be resolved explicitly.

## Phase 0 — fixes that land first — **done**

Independent of packaging, and the duplicate-id work depends on them.

**0.1 `scanDirectory` drops subtrees on duplicates.** `loader.ts:84-87` pushed
the error and `return`ed, which exited before the recursive descent at line 100.
Cubes nested below a duplicate never got scanned, so the error report was
incomplete: you fix one collision, re-run, find the next.

**0.2 Duplicate detection is order-dependent.** `loadCubes()` ran `Promise.all`
over folders into a shared `cubes` object, so which source was "first" and which
was "the duplicate" varied run to run.

Both are one restructure. Scanning and id resolution are now separate passes:
each root fills its own `ScanResult`, the lists are concatenated in root order
(`Promise.all` preserves input order regardless of completion order), and a
grouping pass builds `cubes` and the errors. `scanDirectory` no longer decides
anything about ids, so it always descends. Directory entries are sorted, and a
directory reachable from two roots is deduped by path — one cube seen twice is
not a collision, which it used to be reported as.

**0.3 `apt:essentials` is already declared twice.** `cubes/apt/essentials`
declares it via `id`; `packages/nopy/cubes/apt/essentials` declared it via an
`[apt:essentials]` prefix in `name`. `cubeDirs` merges root-first, so running
`nopy` from `packages/nopy` collected both and aborted. Confirmed against the
real trees before the rename:

```
Duplicate cube id 'apt:essentials' from 2 sources:
  /…/ansiblingz/cubes/apt/essentials
  /…/ansiblingz/packages/nopy/cubes/apt/essentials
Rename one of them, or remove a source from .nopyrc.json.
```

The three `packages/nopy/cubes` fixtures are now `[test:apt-essentials]`,
`[test:apt-all]` and `[test:apt-more]`; all 25 cubes load with no errors. Their
`dependencies` were stale too — they named `apt/more` and `apt/essentials`,
which are not ids anything declares — so they now point at the renamed ids.

**0.4 `coerceValue` breaks if zod is ever duplicated.** `nopy.prompts.ts:147-154`
discriminated with `instanceof z.ZodDefault`, `z.ZodBoolean`, `z.ZodNumber` and
friends — checks against the *running CLI's* zod instance. The moment a bundle
resolves its own copy of zod (entirely possible once manifests arrive from
`node_modules`; see Phase 4), every check returns false and `coerceValue` falls
through to the raw string, silently. Booleans stop being booleans.

`defaultValueOf` in `cubes/types.ts` had the same breakage, reached whenever a
schema has one field without a `.default()` — `getDefaults()` tries
`safeParse({})` first, which is instance-agnostic, and only then drops to the
per-field read.

Both now discriminate on `def.type`, a plain string that holds across instances,
via two exported helpers (`zodKind`, `zodInner`). Verified on the installed zod
4.4.3:

```
z.boolean().default(false).def.type        → 'default'
z.boolean().default(false).def.innerType   → { def: { type: 'boolean' } }
z.number().def.type                        → 'number'
```

`tests/helpers/foreign-zod.ts` rebuilds a schema as plain objects carrying zod's
`def` but not its prototype — structurally what a second copy of zod produces,
and `instanceof`-blind, so neither call site can regress.

Worth noting for Phase 4: zod 4 exposes `def.defaultValue` as a getter that
already invokes a lazily declared default, so the `typeof === 'function'` branch
in `defaultValueOf` is now dead. It is kept as insurance against that changing.

## Phase 1 — the bundle contract

A cube bundle is an npm package with a `nopy` field:

```json
{
  "name": "@acme/cubes-net",
  "version": "1.0.0",
  "type": "module",
  "files": ["cubes", "README.md", "LICENSE"],
  "keywords": ["nopy", "nopy-cubess", "pyinfra"],
  "dependencies": {
    "@bitsquare/nopy-cubes": "^1.0.0",
    "zod": "^4.4.3"
  },
  "publishConfig": { "access": "public" }
}
```

Rules:

- **Cube location is a convention, `<root>/cubes`.** *(Amended after Phase 5;
  originally `nopy.cubes` was a required field.)* The field bought nothing a
  convention does not: it is not a discovery marker — naming the package in
  `cubePackages` already is one — and it says nothing about whether the
  directories were actually packed, which is the failure authors really hit.
  `nopy.cubes` remains as an **override**, directories relative to the package
  root, for the bundle whose cubes are elsewhere (`dist/cubes` after a build).
  Absent means the default; present-and-malformed is an error rather than a fall
  back. Finding no cube directory at all is still an error, not a silent skip:
  listing a package means the user expects cubes from it.
- Both dependencies are **regular dependencies, not peers**, and both are
  load-bearing: a manifest imports `Manifest` from `@bitsquare/nopy-cubes` and `z`
  from `zod`. `@bitsquare/nopy-cubes` peer-depends on zod, so the bundle's copy is
  the one everybody uses — see Phase 4.
- The package needs no `exports` entry for this to work — resolution reads
  `package.json` off disk (Phase 2), so the `exports` map is irrelevant.
- **A bundle's directory is read-only at runtime.** Under pnpm, `node_modules`
  content is hardlinked into the global store; a cube writing next to its own
  `deploy.py` corrupts that store for every project on the machine. Cubes must
  write to `/tmp` or the remote host, never their own dir.
- A bundle must not ship a `.nopyrc.json`. Config discovery walks up from
  `process.cwd()`, never from cube directories, so it would never be read.

## Phase 2 — resolution — **done**

### Config surface

```json
{
  "cubePackages": ["@acme/cubes-net", "@acme/cubes-caddy"]
}
```

Merges through the existing `resolution` machinery for free — arrays concat and
dedupe — so a parent config supplies the org baseline and a child adds to it.

**Resolution origin.** A package must be resolved from *the directory of the
config file that declared it*, not from `process.cwd()`. Otherwise a bundle
listed in `~/.nopyrc.json` cannot resolve unless every project happens to depend
on it. This is the same problem `PATH_PROPERTIES` solves for `cubeDirs`, but the
output is a tagged reference rather than a rewritten string:

```ts
export interface CubePackageRef {
  spec: string;   // '@acme/cubes-net'
  from: string;   // dirname of the .nopyrc.json that declared it
}
```

So the file format and the loaded format diverge for this one key:

```ts
interface NopyConfigFile extends Omit<Partial<NopyConfig>, 'cubePackages'> {
  cubePackages?: string[];
  resolution?: ResolutionConfig;
}

interface NopyConfig {
  cubePackages: CubePackageRef[];
  // ...
}
```

`resolveConfigPaths()` performs the `string → CubePackageRef` conversion, next to
where it resolves `PATH_PROPERTIES`. Two consequences to handle:

- `mergeValue`'s array dedupe only fires when every element is a primitive
  (`config.ts:142`), so refs fall through to plain concat. Dedupe by `spec` in
  the resolver instead.
- Dedupe is **last-wins**: merge order is root-first, so the last occurrence is
  the most specific config, and its `from` is the right resolution origin.

### Resolver

New file `packages/nopy/src/cubes/packages.ts`:

```ts
export interface CubePackage {
  name: string;
  root: string;
  dirs: string[];   // absolute, from nopy.cubes
}

export function resolveCubePackages(
  refs: CubePackageRef[]
): { packages: CubePackage[]; errors: string[] };
```

Locate the package root without going through `exports` and without tripping on
pnpm symlinks:

```ts
const req = createRequire(path.join(ref.from, 'noop.js'));
for (const dir of req.resolve.paths(ref.spec) ?? []) {
  const manifest = path.join(dir, ref.spec, 'package.json');
  if (fs.existsSync(manifest)) return path.dirname(manifest);
}
```

`resolve.paths()` walks the `node_modules` chain upward from `ref.from` plus the
global paths; `existsSync` follows symlinks, so pnpm's
`node_modules/@acme/cubes-net → ../.pnpm/…` resolves correctly.

Errors (each aborts the run, consistent with the existing `errors` contract):

- package not found on any candidate path
- `package.json` unparseable
- neither a `cubes/` directory nor a `nopy.cubes` override
- `nopy.cubes` present but not a non-empty array of strings
- a `nopy.cubes` entry escapes the package root, or does not exist

### Wiring

`findCubeDirectories()` currently returns `string[]`. It becomes the union of
three sources, each tagged so the loader can attribute a cube to it:

```ts
export type CubeRoot =
  | { type: 'dir'; dir: string }                              // cubeDirs, .npcubes markers
  | { type: 'package'; dir: string; packageName: string };    // cubePackages

export function findCubeRoots(): { roots: CubeRoot[]; errors: string[] };
```

Keep `findCubeDirectories()` as a thin wrapper returning `roots.map(r => r.dir)` —
it is exported from `src/cubes/index.ts` and covered by tests. The
`node_modules` skip inside `scanDirectory` stays and is now *correct*: a
bundle's own `node_modules` should not be scanned.

## Phase 3 — hard errors with attribution — **done**

`Cube` gains a source, as an optional fourth constructor parameter so the public
signature stays backwards compatible:

```ts
export type CubeSource =
  | { type: 'dir'; dir: string }
  | { type: 'package'; packageName: string; dir: string };

class Cube {
  constructor(
    manifest: Manifest<Schema>,
    dir: string,
    deployScript: string,
    source: CubeSource = { type: 'dir', dir }
  ) {}
}
```

The duplicate error carries both sources and is order-independent (Phase 0.2):

```
Duplicate cube id 'apt:essentials' from 2 sources:
  package @bitsquare/nopy-cubes-core  /…/node_modules/@bitsquare/nopy-cubes-core/cubes/apt/essentials
  directory                      /repo/packages/nopy/cubes/apt/essentials
Rename one of them, or remove a source from .nopyrc.json.
```

There is deliberately no override, alias or precedence rule. If two bundles ever
claim the same id they are mutually exclusive, and the fix is upstream.

Surface the source in the interactive picker so a user can see where a cube came
from before running it.

## Phase 4 — `@bitsquare/nopy-cubes`, the authoring package — **done**

The problem: a manifest does `import { cubes } from '@bitsquare/nopy'`, resolved
by ordinary Node resolution from the manifest's own directory. From inside
`node_modules/@acme/cubes-net/`, that only resolves if the consumer installed
`@bitsquare/nopy` locally — a globally-installed CLI leaves nothing to find.

The fix is to give bundles something they can depend on *normally*, so resolution
is plain, boring, spec-compliant Node with no loader tricks in the critical path.

### The package

`packages/nopy-cubes` — the `Manifest` factory, the `Cube` class, and the types
from `cubes/types.ts`. No CLI, no `execa`, `inquirer`, `enquirer`, `zx`, or
`commander`. Today a cube manifest — a file that ships nothing but data — drags
the entire CLI in as a transitive dependency; this makes the authoring surface
honest about how small it is, and gives the *contract* a version number that
moves independently of the CLI's.

```json
{
  "name": "@bitsquare/nopy-cubes",
  "version": "1.0.0-alpha0",
  "type": "module",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "peerDependencies": { "zod": "^4.4.3" },
  "files": ["dist", "README.md", "LICENSE"]
}
```

**zod is a peer, deliberately.** Bundles declare zod as a regular dependency, so
exactly one zod instance serves the manifest, the schema it builds, and the
`Manifest` factory. Phase 0.4 removes the CLI's `instanceof` dependence on that
being the *same* copy the CLI uses, but keeping the bundle side single-instance
is still the right default.

### Moving `cubes/types.ts`

`@bitsquare/nopy` re-exports everything from `@bitsquare/nopy-cubes` — through
`src/cubes/index.ts` and the `cubes` namespace in `src/nopy.cubes.ts`, both
already coverage-excluded barrels — so `import { cubes } from '@bitsquare/nopy'`
in every existing manifest keeps working unchanged. Nothing in `cubes/` has to be
touched at migration time.

`cubes/types.ts` and `cubes/factories.ts` moved wholesale, with
`tests/cubes.types.test.ts` and `tests/cubes.factories.test.ts` behind them.
`tests/helpers/foreign-zod.ts` is duplicated rather than shared — fifteen lines,
and the alternative is a test-only dependency edge between the packages.

Repo plumbing it took:

- `tsconfig.base.json`: `"@bitsquare/nopy-cubes": ["./packages/nopy-cubes/src"]`.
- Root `tsconfig.json` and `packages/nopy/tsconfig.json`: the project reference.
  This is the first reference edge in the repo, and it broke the gate
  immediately: **`tsc --build --noEmit` is not legal once a project has
  references** — TS6310, "referenced project may not disable emit", because a
  composite project has to emit the declarations its dependents read. The root
  `typecheck` script is now plain `tsc --build`. It still fails on a type error,
  and it now also proves the build works; the cost is that it writes `dist`,
  which is gitignored.
- `packages/nopy/package.json`: `"@bitsquare/nopy-cubes": "workspace:*"`.
- `packages/nopy/vitest.config.ts`: a `resolve.alias` for `@bitsquare/nopy-cubes`
  pointing at `../nopy-cubes/src/index.ts`. Without it the workspace link
  resolves through `exports` to `dist`, so `pnpm test` on a clean checkout would
  fail until something had built it, and a stale `dist` would silently be what
  the tests ran against. The same config excludes `**/nopy-cubes/**` from
  coverage — the aliased files were being counted against nopy's thresholds.
- A `vitest.config.ts` for the new package with the same thresholds. It sits at
  100 % statements/functions/lines, 91 % branches.

### The release lane needed fixing first

This is the part that is easy to miss. `link-workspace-packages` is unset and
pnpm 10+ defaults it to `false`, so a plain semver range would resolve
`@bitsquare/nopy-cubes` from the registry instead of linking the workspace copy —
the dependency has to use `workspace:*`.

But **both workflows publish with `npm publish`**, and npm does not understand
the `workspace:` protocol. `@bitsquare/nopy` would ship a manifest carrying
`"@bitsquare/nopy-cubes": "workspace:*"`, which fails on install with
`EUNSUPPORTEDPROTOCOL`. This has never mattered because the two current packages
do not depend on each other; `nopy → nopy-cubes` is the first edge, and the PoC
bundle in Phase 5 adds a second.

Pick one before publishing anything:

- **Switch to `pnpm publish --no-git-checks`**, which rewrites the protocol to a
  concrete version on pack. Cleanest, but changes the publish step in both
  workflows and pulls in pnpm's own lifecycle behaviour.
- **Rewrite the range with `npm pkg set` before publishing**, extending the
  pattern `publish-snapshot.yml` already uses for `version`. In `release.yml` one
  package ships at a time, so it pins to whatever version `packages/nopy-cubes/package.json`
  declares at that commit. In `publish-snapshot.yml` the loop needs to become two
  passes — compute every snapshot version first, then publish — so `nopy` can pin
  the exact `nopy-cubes` snapshot from the same run.

**Measured, both directions.** `npm pack` in `packages/nopy` produces a tarball
whose manifest still reads `"@bitsquare/nopy-cubes": "workspace:*"`; `pnpm pack`
produces one that reads `"1.0.0-alpha0"`. So the failure was real and the fix
works.

Went with `pnpm publish --ignore-scripts --no-git-checks` in both workflows.
`--no-git-checks` is not optional in either: `release.yml` runs on a detached
HEAD, and `publish-snapshot.yml` dirties the tree by stamping versions.
(`pnpm pack` has no `--ignore-scripts`, only `pnpm publish` does.)

Three small scripts carry the parts that are easy to get wrong, all runnable
locally:

- **`scripts/verify-pack.mjs`** — packs every publishable package and fails if a
  `workspace:` range survived into the tarball. Runs between build and publish
  in both workflows. Turns "npm would have shipped a broken manifest" from an
  install-time surprise into a red run.
- **`scripts/publish-order.mjs`** — topologically sorts the publishable packages.
  `packages/*/` alphabetically puts `nopy` ahead of the `nopy-cubes` it depends
  on; the snapshot workflow now iterates this instead.
- **`scripts/linked-deps.mjs`** — lists a package's workspace links as
  `<name> <version>`, resolved by package name rather than by directory.
  `release.yml` uses it to refuse a release whose linked dependency is not on
  npmjs yet, which is the one mistake that cannot be taken back after 72 hours.

`publish-snapshot.yml` also became two passes over the packages: stamp every
version first, then publish. `pnpm publish` substitutes the version the linked
package declares *at pack time*, so `nopy-cubes` has to be carrying its snapshot
version before `nopy` is packed.

Still unverified: none of this has run against the Gitea registry. Worth a
throwaway version before the first real release.

### Also: the resolve hook — built

Independent of the split, and worth building anyway — it retires the
`ERR_MODULE_NOT_FOUND` gotcha CLAUDE.md documents for the local `cubes/` tree,
where manifests import `@bitsquare/nopy` from a directory that has no link to it.

With the split, the hook is a convenience rather than load-bearing: bundles
resolve `@bitsquare/nopy-cubes` through their own `node_modules` and never reach
it.

**The gotcha is bigger than CLAUDE.md says: it is two specifiers, not one.**
Measured by linking `@bitsquare/nopy` into the root `node_modules` and loading
the real tree — every manifest then failed on `Cannot find package 'zod'`
instead. Manifests import `z` directly to build their schema, and pnpm's
isolated layout puts zod under `packages/nopy/node_modules`, not the root. A
hook that only covers `@bitsquare/nopy` moves the error rather than fixing it,
so it has to fall back for `zod` too. With both linked, all 25 cubes load.

Falling back for `zod` hands local cubes the *CLI's* zod instance, so no
duplication arises there. Bundles are the case that duplicates it, and Phase 0.4
is what makes that safe.

`packages/nopy/src/cubes/resolve-hook.mjs`, registered once from `loadCubes()`
before the first `import(manifestPath)`:

```ts
module.register('./resolve-hook.mjs', import.meta.url, { data: { from: import.meta.url } });
```

`from` is a URL inside the running CLI's own package; the hook thread builds a
`createRequire` from it and resolves the fallbacks out of the CLI's own
dependencies.

The hook tries `next(specifier, ctx)` **first** and only falls back on failure.
That ordering matters: a consumer that has its own copy installed keeps using
it, so the hook never silently introduces version skew. There is a test for
exactly that — a stub `zod` beside the cube wins over the CLI's real one.

Constraints, as built:

- `module.register()` is process-global and cannot be undone. Installed once,
  behind a module-level guard, and wrapped in a `try` — the hook is a
  convenience, so a registration failure must not abort a run.
- The hook file runs on a separate thread; the `data` payload must be
  structured-cloneable (a string URL is).
- The `.mjs` has to reach `dist`, and `tsc` does not copy it: nopy's `build` is
  now `tsc && cp src/cubes/*.mjs dist/cubes/`. `files` already covers it via the
  `dist` entry.
- It covers **three** specifiers, not the two the plan named: `zod`,
  `@bitsquare/nopy`, and `@bitsquare/nopy-cubes` — a hand-written local cube is
  as entitled to the new authoring package as to the old one. Subpaths count
  (`@bitsquare/nopy/package.json`), anything else stays a hard failure.

**The tests have to spawn a real `node`.** Written inside the vitest worker they
pass whether or not the hook is installed: vite resolves the dynamic import
itself and finds `zod` from the project root. `tests/cubes.resolve-hook.test.ts`
therefore runs each case in a child process, and the first case asserts the
*failure* without the hook so the rest cannot silently stop proving anything.

**Verified end to end.** From a plain `node` at the repo root, with nothing
linked, the built loader reads all 22 cubes under `cubes/` with zero errors. The
`ERR_MODULE_NOT_FOUND` gotcha in `CLAUDE.md` is retired.

## Phase 5 — proof of concept: `packages/nopy-cubes-core` — **done**

Depends on Phase 4 shipping first — the bundle cannot declare
`@bitsquare/nopy-cubes` as a dependency until it exists, and the publish-lane fix
has to be in place before either package is published.

1. `git mv cubes packages/nopy-cubes-core/cubes` — preserves per-file history.
2. Add `packages/nopy-cubes-core/package.json` per the Phase 1 contract. Version
   `1.0.0-alpha0`, tracking the current alpha train. Not private. Its
   `@bitsquare/nopy-cubes` dependency uses `workspace:*` in the repo, which is
   exactly the case the Phase 4 publish fix has to handle.
   Migrating the manifests' `import { cubes } from '@bitsquare/nopy'` to
   `import { Manifest } from '@bitsquare/nopy-cubes'` is optional — the re-export
   keeps the old form working — but doing it here is what proves the bundle
   resolves without the CLI present at all.
3. Root `.nopyrc.json`: **replace** `"cubeDirs": ["./cubes"]` with
   `"cubePackages": ["@bitsquare/nopy-cubes-core"]`. Replace, not add — keeping both
   means every id resolves from two sources and the hard error fires on every
   run.
4. Root `package.json`: add `"@bitsquare/nopy-cubes-core": "workspace:*"` to
   `devDependencies`, so pnpm symlinks it into the root `node_modules`. This is
   what makes the PoC exercise the real pnpm symlink resolution path rather than
   a plain directory.
5. `packages/nopy/.nopyrc.json` keeps `"cubeDirs": ["./cubes"]` for its fixtures.
   Config merges root-first, so running from `packages/nopy` now pulls in
   `@bitsquare/nopy-cubes-core` *and* the fixtures — which is exactly the collision
   Phase 0.3 renames away.
6. Workflow changes are limited to the publish-lane fix from Phase 4.
   `publish-snapshot.yml` loops `for dir in packages/*/` and picks both new
   packages up automatically; `release.yml` resolves `packages/<pkg>` from the
   tag, so `nopy-cubes-core-v1.0.0` and `nopy-cubes-v1.0.0` work as-is. Verify on the
   first snapshot run that a package with no `build` script is skipped cleanly by
   `pnpm -r run build` (it is) and that publishing is happy with no lifecycle
   scripts.
7. No `tsconfig` reference for `nopy-cubes-core` — the bundle has no TypeScript. (The
   `nopy-cubes` references from Phase 4 are separate.)
8. Biome already lints `cubes/**/*.mjs` from the root; only the path changes.

### What differed from the plan

- **Step 2's optional migration was done.** All 22 manifests now import
  `{ Manifest }` from `@bitsquare/nopy-cubes`, not `{ cubes }` from
  `@bitsquare/nopy`. Optional for correctness, but it is the only version of the
  PoC that proves anything: leaving the old import in place would have resolved
  through the CLI that happens to sit in the same tree.
- **`uniqid` had to move too.** Two manifests use it (`admin:hostname` bare,
  `user:add` via `cubes.uniqid`), so `src/cubes/utils.ts` and its test went to
  `nopy-cubes` alongside `types.ts`, and `uniqid` joined the authoring barrel.
  Otherwise one migrated manifest would still have been importing the CLI.
- **`files` needs a log exclusion.** Cubes that have been run leave a gitignored
  `pyinfra-debug.log` next to `deploy.py`; gitignore does not filter an npm
  tarball. `"files": ["cubes", "!cubes/**/*.log", …]` does. Verified: 22
  manifests, 22 deploy scripts, 0 logs in the packed artefact.
- **`verify-pack.mjs` picks the bundle up for free** — it walks every non-private
  `packages/*`, so `nopy-cubes-core`'s `workspace:*` edge is checked like nopy's.

### Verifying the PoC — done

- **In-workspace:** the built loader, run from the repo root against the new
  root `.nopyrc.json`, reads 22 cubes with 0 errors and reports
  `source: { type: 'package', packageName: '@bitsquare/nopy-cubes-core', dir:
  '…/node_modules/@bitsquare/nopy-cubes-core/cubes' }` — the pnpm symlink path, not a
  plain directory.
- **Out-of-workspace (the real test):** `pnpm pack` for `nopy-cubes`, `nopy` and
  `nopy-cubes-core`, then **`npm install`** of all three tarballs into a throwaway
  directory with a `.nopyrc.json` naming only the bundle. npm is the strict test
  here — it does not understand `workspace:`, so a leaked range fails the install
  outright. It installed clean, and the installed
  `@bitsquare/nopy/package.json` carries `"@bitsquare/nopy-cubes":
  "1.0.0-alpha0"`. `nopy install -l session.json -P -D` then resolved
  `apt:essentials` and printed a `--chdir` into
  `node_modules/@bitsquare/nopy-cubes-core/cubes/apt/essentials`. Since the loader
  aborts on any manifest error and this run did not, all 22 manifests imported
  `@bitsquare/nopy-cubes` and `zod` successfully from a tree containing no
  workspace links.

  Note for anyone repeating this: `-P` on its own is interactive, and a replay
  still prompts for anything a manifest declares in `secrets` (they are never
  persisted to a session) — `net:tailscale` will sit there waiting. Use a
  session file with a cube that has no secrets, or answer the prompt.

## Phase 6 — documentation — **done**

- `CLAUDE.md`: the repo table gains two rows (`packages/nopy-cubes`,
  `packages/nopy-cubes-core`) and loses the `cubes/` one; "The two packages do not
  depend on each other" is no longer true; the loader section in *nopy
  architecture*; and the *Gotcha* paragraph, which the resolve hook retires.
- `packages/nopy/docs/CUBE-BUNDLES.md` (new): authoring guide — package shape,
  read-only constraint, id collision policy, publishing.
- `packages/nopy/docs/API.md` + `README.md`: `cubePackages`.
- `README.PUBLISH.md`: `nopy-cubes-v*` and `nopy-cubes-core-v*` as new tag prefixes,
  plus the ordering constraint — `nopy-cubes` releases before anything that
  depends on it.

Beyond the list: `CLAUDE.md` also needed the `typecheck` command corrected
(`tsc --build`, not `--noEmit` — see Phase 4), a note on the vitest source alias
and the coverage exclusion, and three entries under *Known drift*. `README.PUBLISH.md`
absorbed the whole publish-lane rework, not just the tag prefixes: `pnpm publish`
over `npm publish` and why, the two-pass version stamping, `verify-pack.mjs`,
`publish-order.mjs`, `linked-deps.mjs`, and a local rehearsal recipe that uses
**npm** to install the tarballs precisely because npm is the one that rejects a
leaked `workspace:` range.

One workflow change came out of writing this up: `ci.yml` now runs
`verify-pack.mjs` too. It was only in the two publish workflows, which means a
leaked range would have failed the release rather than the pull request that
introduced it — the wrong end of the process for a mistake that is free to catch
early.

## Testing

The coverage gate (85 % branches/functions, 80 % lines/statements, per package)
is not a CI flag — new modules without tests fail the gate locally and on the
runner alike.

`tests/cubes.packages.test.ts` (new) — build a fake `node_modules` tree under
`os.tmpdir()` and `chdir` into it, as the existing loader/config tests do:

- resolves a scoped and an unscoped package
- resolves through a symlinked package directory (mimicking pnpm)
- resolves from the declaring config's directory, not `cwd`
- missing package → error naming the spec
- package without `nopy.cubes` → falls back to `cubes/`
- package with neither → error; malformed `nopy.cubes` → error, no fall back
- `nopy.cubes` entry that does not exist, and one that escapes the root → errors
- last-wins dedupe when parent and child config both name a package

`tests/cubes.loader.test.ts` — package-sourced cubes load; `source` attribution
is correct for all three root types.

`tests/cubes.loader.edge.test.ts` — duplicate across a dir and a package errors
and names both; cubes nested below a duplicate still get scanned (Phase 0.1);
the error is identical regardless of scan order (Phase 0.2).

`tests/config.test.ts` — `cubePackages` merge, `override` resolution strategy,
`CubePackageRef` provenance.

`tests/prompts.test.ts` — `coerceValue` against schemas built by a *different*
zod instance, so Phase 0.4 cannot silently regress to `instanceof`.

`packages/nopy-cubes/` — its own `vitest.config.ts` at the same thresholds. The
`Manifest()` / `Manifest.create()` / `Cube.getDefaults()` cases move over from
`tests/cubes.factories.test.ts`; what stays behind is whatever tests the
re-export surface.

Resolve hook — `module.register()` is process-global, so this cannot be unit
tested in-process. Add an integration test that spawns the CLI as a child process
against a fixture tree, under the existing `test:integration` script.

## Risks

1. **`module.register()` is irreversible and process-wide.** It affects
   everything loaded afterwards, including the CLI's own lazy imports. Guarded
   single install, `next()`-first ordering.
2. **Hard-error duplicates have no escape hatch.** Two bundles claiming one id
   cannot be used together, full stop. If that bites in practice the follow-up is
   a `cubeAliases` map or a per-package id prefix — explicitly out of scope here.
3. **Store corruption.** A bundled cube writing to its own directory damages the
   pnpm global store for every project on the machine. Documented in Phase 1;
   a runtime warning is a possible follow-up.
4. **No version compatibility check.** A bundle authored against a future `nopy`
   loaded by an older one fails at manifest-import time with a confusing error.
   A `nopy.engines` field checked at resolution time would fix it. Deferred.
5. **Bundles vendoring cubes in their own `node_modules`** will not be found, by
   design.
6. **`workspace:*` escaping into a published manifest.** The failure is silent at
   publish time and only shows up when someone installs the package. Phase 4
   fixes the lane; a `postpack` assertion that no dependency range starts with
   `workspace:` would make it impossible to regress.
7. **Three packages, three version lines.** `nopy-cubes` is the contract, so a
   breaking change there ripples to every published bundle in the wild — which is
   the point of versioning it separately, but it means the compatibility question
   from risk 4 gets more pressing, not less.
