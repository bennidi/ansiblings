# Nopy API Reference

The public surface of **`@bitsquare/nopy`** (the CLI and its library exports) and
of **`@bitsquare/nopy-cubes`** (the authoring package a `manifest.mjs` imports).

Everything below was checked against the source. Where the code does something a
reader would not expect — a field that is always empty, a function nothing calls
— it is documented as it behaves, not as it reads. See
[Known gaps](#known-gaps) for the short list of those.

If you are writing cubes rather than calling nopy from code, you want
[CUBE-BUNDLES.md](CUBE-BUNDLES.md) and [HOOKS.md](HOOKS.md); only the
[Authoring API](#authoring-api-bitsquarenopy-cubes) section here applies to you.

---

## Table of Contents

- [Two packages](#two-packages)
- [Authoring API (`@bitsquare/nopy-cubes`)](#authoring-api-bitsquarenopy-cubes)
- [Main Module](#main-module)
- [Cubes Module](#cubes-module)
- [Variables Module](#variables-module)
- [Executor Module](#executor-module)
- [Workflow Module](#workflow-module)
- [Session Module](#session-module)
- [History Module](#history-module)
- [Config Module](#config-module)
- [Prompts Module](#prompts-module)
- [Update Module](#update-module)
- [CLI Usage](#cli-usage)
- [Creating a Cube](#creating-a-cube)
- [Known gaps](#known-gaps)

---

## Two packages

| Package | Contains | Depends on |
| --- | --- | --- |
| `@bitsquare/nopy-cubes` | `Manifest`, `Cube`, `Hook`, `uniqid`, the zod helpers | zod (peer) |
| `@bitsquare/nopy` | the CLI, the loader, config, sessions, execution | `@bitsquare/nopy-cubes` |

A `manifest.mjs` should import from **`@bitsquare/nopy-cubes`**: it is types and a
factory with no CLI, no prompts and no process spawning, so a cube bundle can
depend on it without pulling the whole tool into its dependency graph.

```javascript
import { Manifest } from '@bitsquare/nopy-cubes';  // prefer this
import { cubes } from '@bitsquare/nopy';          // cubes.Manifest — still supported
```

`@bitsquare/nopy` re-exports the entire authoring surface, so both forms work and
older manifests keep loading. The `cubes` namespace object
(`src/nopy.cubes.ts`) is marked `@deprecated` and exists only for that
compatibility; it also carries a `cubes.load` alias for `loadCubes`.

---

## Authoring API (`@bitsquare/nopy-cubes`)

### `Manifest(opts)`

Factory for a cube manifest. `name` is the only required option; everything else
is filled in.

```javascript
import { Manifest } from '@bitsquare/nopy-cubes';
import { z } from 'zod';

export default Manifest({
  id: 'apt:essentials',
  name: 'Install essential apt packages',
  secrets: [],
  dependencies: (vars) => (vars.WITH_BUILD_TOOLS ? ['apt:build'] : []),
  schema: z.object({
    PACKAGES: z.string().default('curl,git').describe('Comma-separated packages'),
  }),
});
```

Defaults applied by the factory: `id: ''`, `schema: z.object({})`,
`secrets: []`, `before: []`, `after: []`, `dependencies: undefined`.

`createManifest` and `manifest` are exported as identical aliases.
`ManifestFactory` is a third alias, marked `@deprecated` — and it is not
re-exported through `@bitsquare/nopy`, so it is only reachable from
`@bitsquare/nopy-cubes` directly.

#### `Manifest<Schema>` (interface)

```typescript
interface Manifest<Schema extends AnyObjectSchema = AnyObjectSchema> {
  /** Unique identifier, used for dependency references and as the session key. */
  id: string;
  /** Human-readable name, shown in the picker. */
  name: string;
  /** Zod object schema for the cube's variables. */
  schema: Schema;
  /** Schema keys whose values must never be persisted or printed. */
  secrets?: string[];
  /** Dependencies, computed from the *collected* variables. */
  dependencies?: (variables: z.infer<Schema>) => DependencySpec[];
  before?: Hook<Schema>[];
  after?: Hook<Schema>[];
}
```

`dependencies` is a **function**, not an array: it runs after the cube's
variables have been collected, so it can branch on what the user actually
answered.

`secrets` is a plain array rather than schema metadata on purpose. `.meta()` and
`.describe()` store into zod's global registry, which is per-copy — a manifest
that built its schema with its own copy of zod would write the marker somewhere
this process cannot read it. A missed `.describe()` costs an ugly prompt label; a
missed secret marker writes a password to disk, so this one cannot be allowed to
fail open. An entry naming a key that is not in the schema is a load error.

### `Cube<Schema>`

A loaded cube: its manifest, where it lives, and how it got into the run. This is
a **class**, constructed by the loader; the manifest's fields stay on
`.manifest` rather than being flattened onto it.

```typescript
class Cube<Schema extends AnyObjectSchema = AnyObjectSchema> {
  constructor(
    manifest: Manifest<Schema>,
    dir: string,             // absolute path to the cube directory
    deployScript: string,    // filename, e.g. 'deploy.py' — not a path
    source?: CubeSource,     // defaults to { type: 'dir', dir }
  );

  get id(): string;          // manifest.id
  get name(): string;        // manifest.name
  get secrets(): string[];   // manifest.secrets ?? []

  getDefaults(): z.infer<Schema>;
  schemaKeys(): string[];
  requiredKeys(): string[];
  isSecret(key: string): boolean;
}
```

`getDefaults()` parses `{}` against the schema, which resolves every default in
one pass — but that throws as soon as one field has no `.default()`. It then
falls back to a per-field read so the defaults that *are* declared survive; a
single required field used to leave the cube with no variables at all.

`requiredKeys()` returns the keys nothing can fill in on its own: no `.default()`
and not optional. A `--use-defaults` run that cannot supply one aborts by name
rather than deploying the cube with the value missing.

`schemaKeys()` returns every declared key, required or not. It answers a
different question — whether the cube *claims to know about* a key, rather than
whether it has a value for one — and that is what decides whether a secret in the
config `env` is allowed to reach it.

### `CubeSource`

Where a cube came from. Carried because a cube's directory does not say how it
got into the run — `/…/node_modules/@acme/cubes-net/cubes/x` could equally have
come from a `cubeDirs` entry pointing straight at it. It is what makes a
duplicate-id error legible when the collision is between a local tree and an
installed bundle.

```typescript
type CubeSource =
  | { type: 'dir'; dir: string }
  | { type: 'package'; packageName: string; dir: string };
```

The cube picker also uses it: a cube from a package is labelled
`id - name (@acme/cubes-net)`, and because the fuzzy filter matches on the label,
typing a package name narrows the list to that bundle.

### `Hook<Schema>` and `HookContext`

```typescript
type Hook<Schema extends AnyObjectSchema> = (
  ctx: HookContext,
  variables: z.infer<Schema>
) => void | Promise<void>;

interface HookContext {
  /** Pulls another cube into the run, optionally passing it variables. */
  exec: (key: string, variables: CubeVariables) => Promise<void> | void;
}
```

`exec()` re-enters the resolver, so a hook can pull in a cube that is not a
declared dependency. The `variables` argument is the cube's *effective* values,
not schema-validated output — see [Known gaps](#known-gaps). Full semantics in
[HOOKS.md](HOOKS.md).

### `DependencySpec` and `CubeVariables`

```typescript
type CubeVariables = Record<string, string | number | boolean>;
type DependencySpec = string | [id: string, variables?: CubeVariables];
```

The tuple form passes variables down, at `param` precedence:

```javascript
dependencies: (v) => ['apt:essentials', ['user:add', { USER: v.USER }]],
```

### `AnyObjectSchema`

```typescript
type AnyObjectSchema = z.ZodObject<Record<string, z.ZodType<any>>>;
```

Stands in for zod 3's `z.AnyZodObject`, which zod 4 removed.

### `zodKind(node)` / `zodInner(node)`

```typescript
function zodKind(zodType: unknown): string;      // node.def.type — 'default', 'boolean', …
function zodInner(zodType: unknown): z.ZodType;  // node.def.innerType
```

Schema introspection that survives a second copy of zod. `instanceof z.ZodDefault`
compares against the *running* copy; a manifest is free to build its schema with
its own, and then every `instanceof` quietly returns false and the caller falls
through to a wrong answer. Nothing that inspects a cube's schema may go back to
`instanceof`. `zodInner` is only valid for a node whose `zodKind` is a wrapper
(`default`, `optional`, `nullable`).

### `uniqid(length?)`

```typescript
const id = uniqid();     // 'Kx7Pm'
const long = uniqid(10); // 'Kx7PmQr2Yw'
```

An LCG seeded from `process.hrtime.bigint()`. Unique enough for an identifier,
not cryptographic. Note that using it in a `.default()` means a fresh value on
every run — fine for a session that gets recorded, surprising for anything else.

### `LoadResult`

```typescript
interface LoadResult {
  cubes: Record<string, Cube>;  // keyed by cube id
  errors: string[];
}
```

---

## Main Module

### `nopy(options?)`

Runs one full deployment pass: load config → load cubes → pick a workflow →
resolve cubes and their dependencies → execute.

```typescript
import { nopy } from '@bitsquare/nopy';

const result = await nopy({ useDefaults: true, dryRun: true });
```

**`NopyOptions`**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `useDefaults` | `boolean` | `false` | Skip the variable prompts. A cube with a required key nothing supplied aborts the run by name. |
| `useAuthKey` | `boolean` | `false` | Force SSH key auth, skipping the auth prompt. |
| `saveSession` | `string` | – | Path to write the session to. Honoured on a replay too. |
| `loadSession` | `string` | – | Path to a session file to replay. |
| `replaySession` | `NopySession` | – | A session object to replay, used by `-R` / `-H` from history. Takes precedence over `loadSession`. |
| `dryRun` | `boolean` | `false` | Print the execution plan instead of running it. |
| `printOnly` | `boolean` | `false` | Print the built pyinfra commands and return; the executor is never reached. |
| `continueOnError` | `boolean` | `false` | Keep going after a cube fails. |
| `saveToHistory` | `boolean` | `true` | Record the session in `.nopy.history.json`. |

**Returns:** `Promise<NopyResult | undefined>` — `undefined` when cube loading
produced errors, which is the one failure mode that returns rather than throws.

```typescript
interface NopyResult {
  success: boolean;          // summary.failed === 0
  results: ExecutionResult[];
  summary: {
    total: number;
    successful: number;
    failed: number;
    totalDuration: number;
  };
}
```

`--dry-run` and `--print-only` both return with an empty `results` array;
`--print-only` additionally reports `total` as the number of commands built.

---

## Cubes Module

### `loadCubes()`

Loads every cube from every discovered root.

```typescript
const { cubes, errors } = await loadCubes();
```

Roots come from three places, unioned:

1. `cubeDirs` from the merged configuration;
2. every ancestor of the working directory holding a `.npcubes` marker file;
3. the directories declared by each package in `cubePackages`.

A directory is a cube when it holds both a manifest (`manifest.mjs` or
`*.manifest.mjs`) and a deploy script (`deploy.py` or `*.deploy.py`). Scanning is
recursive and skips dotted directories and `node_modules`. Manifests are loaded
by dynamic `import()`.

The cube's id is `manifest.id`, falling back to an `[id]` prefix in
`manifest.name`, then to the directory's basename. Ids are flat and need not
mirror the path, and they are claimed **globally** — across `cubeDirs`,
`.npcubes` trees and every installed bundle at once.

`errors` is non-empty for:

- a duplicate id (the message names every claimant and how each got into the run);
- a manifest that throws on import, exports a non-object, or has no `name`;
- a `secrets` entry naming a key that is not in the schema;
- a package in `cubePackages` that is not installed, cannot be read, has neither a
  `cubes/` directory nor a `nopy.cubes` override, or whose `nopy.cubes` is not a
  non-empty array of strings;
- a `nopy.cubes` entry that does not exist or points outside its package root.

Any of them aborts the run (`nopy.main.ts` returns before the workflow). None is
a silent skip. Note that `cubes` is still populated when a duplicate is reported,
for callers that only want to display what was found.

`loadCubes()` also registers the resolve hook (`cubes/resolve-hook.mjs`) before
importing anything. The hook tries ordinary Node resolution first and only on
failure falls back to resolving `@bitsquare/nopy-cubes`, `@bitsquare/nopy` and
`zod` from the running CLI's own `node_modules` — so a hand-written cube in a
directory with no `node_modules` loads, while a cube shipping its own zod keeps
it. Registration is best-effort: it is a convenience, never load-bearing.

### `findCubeRoots()`

```typescript
const { roots, errors } = findCubeRoots();

interface CubeRoot {
  dir: string;
  source: CubeSource;
}
```

The roots `loadCubes()` would scan, each tagged with where it came from. A
missing `cubeDirs` entry is ignored; a missing package is not.

### `findCubeDirectories()`

`findCubeRoots().roots.map(r => r.dir)` — the paths alone. It **drops the
errors**, so anything that needs to know a named package was missing should call
`findCubeRoots()` instead.

### `getCube(cubeName)`

```typescript
const cube = await getCube('apt:essentials');  // Cube | undefined
```

Convenience wrapper over `loadCubes()`. It discards `errors` too.

### `resolveCubePackages(refs)`

Resolves `CubePackageRef[]` to installed packages and their cube directories.
Called by `findCubeRoots()`; exported because its failure modes are worth testing
on their own.

```typescript
const { packages, errors } = resolveCubePackages(config.cubePackages);

interface CubePackage {
  name: string;    // the name it was requested under
  root: string;    // absolute path to the package root
  dirs: string[];  // absolute paths: `<root>/cubes`, or the package's `nopy.cubes`
}
```

Resolution goes through `createRequire(...).resolve.paths()` plus `existsSync` on
`<dir>/<spec>/package.json`, deliberately bypassing the `exports` map: a bundle
ships directories and has no entry point to declare. `existsSync` also follows
the symlink pnpm plants at `node_modules/<name>` — which is why the loader cannot
simply scan `node_modules` instead, since `readdir` reports that entry as a
symlink rather than a directory and skips every package silently.

Duplicate refs are deduped here, last-wins: `mergeValue` only dedupes arrays of
primitives and these are objects, so a package named by both a parent and a child
config arrives twice. Configs merge root-first, so the last occurrence is the one
from the most specific config and carries the right resolution origin.

### `BuildContext`

The resolver. One instance per run; it accumulates rather than returning.

```typescript
const context = new BuildContext(
  cubes,        // Record<string, Cube>
  variables,    // Variables
  session,      // NopySession
  config,       // NopyConfig
  { method: 'ssh-key', username: undefined, password: undefined },
  { useDefaults: false, isSessionReplay: false }
);

for (const host of session.hosts!) {
  for (const cubeId of selectedCubes) {
    await context.resolveCube(cubeId, host);
  }
}

context.deployCalls;   // DeployCall[]  — in execution order
context.cubeSessions;  // CubeSession[] — what a session file would record
```

#### `resolveCube(cubeId, host, overrides?)`

Recursive, per (cube, host):

1. declare the cube's secrets, assign `overrides` at `param`, assign schema
   defaults at `default`;
2. collect variables — read them back from the session on replay (then prompt for
   the gaps), skip the prompts under `useDefaults`, otherwise prompt;
3. run `before` hooks;
4. call `manifest.dependencies(collectedVariables)` and recurse into each;
5. emit the deploy call;
6. run `after` hooks.

There is no separate topological sort — the ordering falls out of the recursion,
and a `${cubeId}:${host}` set makes emission idempotent. Consequently there is no
cycle detection either: two mutually dependent cubes recurse until the stack
overflows.

**Throws** when the cube id is unknown, when `useDefaults` cannot fill a required
key, when a replay would need a value only the user has (secrets are never
recorded), and when a cancelled prompt leaves a required key empty.

The command it builds:

```
pyinfra <host> -y [--user U --password P] --data "K=V" … --chdir <cubeDir> <cubeDir>/<deployScript>
```

---

## Variables Module

One `Variable` per (cube, key), holding every value it has ever been given.

### `Origin`

Where a value came from, in ascending precedence:

| Origin | Rank | Source |
|---|---|---|
| `default` | 0 | a `.default()` on the cube's schema |
| `env` | 1 | the `env` block of `.nopyrc.json` |
| `session` | 2 | read back from a recorded session on replay |
| `prompt` | 3 | what the user typed |
| `param` | 4 | a dependency spec or a hook's `exec()` |

The order used to be the field order of an object literal — load-bearing,
invisible, and one careless reformat away from silently changing which value
wins. It is stated once now and everything derives from it.

There are no scope bags: config `env` is seeded onto each cube as a real
assignment, and a replay assigns at `session` rather than being smuggled into the
prompts.

### `Variable`

```typescript
class Variable {
  readonly assignments: Assignment[];  // the raw trace, newest first, never reordered
  redacted: boolean;                   // declared a secret by the manifest

  get ordered(): Assignment[];         // the trace re-ranked by origin, winner first
  get effective(): Assignment;
  get value(): Value;
  get origin(): Origin;

  assign(assignment: Assignment): void;
  toJSON(): { cube: string; name: string; value: Value; origin: Origin };
}

interface Assignment { value: Value; origin: Origin }
type Value = string | number | boolean;
type TVariables = Record<string, Value>;
```

`ordered` is a **stable** sort of `assignments`. That stability is load-bearing:
the trace is newest-first and `Array.prototype.sort` is stable per spec, so two
assignments sharing an origin resolve to the newer one while the value it
displaced stays visible underneath. The trace is never persisted.

`toJSON()` yields `MASK` instead of the value when `redacted`.

### `Variables`

```typescript
class Variables {
  constructor(env?: TVariables, globalSecrets?: Iterable<string>);

  declareSecrets(cube: string, keys: readonly string[]): void;
  declareSchema(cube: string, keys: readonly string[]): void;
  isSecret(cube: string, name: string): boolean;

  assign(cube: string, origin: Origin, values?: TVariables): void;

  all(cube: string): Variable[];
  of(cube: string, name: string): Variable | undefined;

  get(cube: string): TVariables;          // effective values → the pyinfra command line
  persistable(cube: string): TVariables;  // the same, minus declared secrets
}

const MASK = '********';
```

`declareSecrets()` is retroactive as well as prospective, so it does not matter
whether the caller declares before or after the values arrive.

`globalSecrets` is every key *any* manifest declares secret, plus the config's
own `secrets` list. `nopy()` computes it once after `loadCubes()`, before the
first cube resolves, so resolution order cannot change whether a value is treated
as a credential. It does two things:

- `isSecret()` is true for such a key on **every** cube, so a manifest that lists
  `PASSWORD` in `schema` and forgets it in `secrets` still gets masking and still
  keeps the value out of the session.
- The config `env` stops being broadcast for it. Ordinary `env` keys are seeded
  onto every cube — deliberately, since a cube may read a key off `host.data`
  that it never declared — but a secret reaches only the cubes whose
  `schemaKeys()` include it.

`declareSchema()` is what supplies those keys, and it has an ordering
requirement: call it before anything assigns to the cube, because the first
assignment is what seeds `env`. `BuildContext.resolveCube` calls it immediately
after `declareSecrets()`. It deliberately does not create the cube's bucket
itself.

`persistable()` leaves a secret out entirely rather than masking it, so a replay
sees it as absent and asks for it again. That is why replaying a session whose
cubes declare secrets is interactive even under `-D` — a `-D` replay that would
need one fails by name instead of hanging.

---

## Executor Module

### `DeployCall`

```typescript
interface DeployCall {
  cube: string;
  host: string;
  cwd: string;
  command: string[];
  env: Record<string, unknown>;   // the cube's effective variables
  secrets?: string[];             // schema keys the manifest declared secret
  dependencies: DependencySpec[]; // always [] — see Known gaps
}
```

### `ExecutionResult` / `ExecutionOptions`

```typescript
interface ExecutionResult {
  cube: string;
  host: string;
  success: boolean;
  duration: number;   // ms
  stdout?: string;    // never populated — stdio is inherited
  stderr?: string;    // never populated — stdio is inherited
  error?: Error;
}

interface ExecutionOptions {
  continueOnError?: boolean;
  dryRun?: boolean;
  onProgress?: (result: ExecutionResult, completed: number, total: number) => void;
  onStart?: (cube: string, host: string) => void;
}
```

### `executeDeployCalls(calls, options?)`

Runs the calls **sequentially**, in the order they were built, through
`execa({ shell: true })` with `stdio: 'inherit'` so pyinfra's output reaches the
terminal live. Stops at the first failure unless `continueOnError`. With
`dryRun`, prints the plan and returns `[]` without executing.

```typescript
const results = await executeDeployCalls(calls, {
  continueOnError: false,
  onProgress: (result, completed, total) => console.log(`${completed}/${total}`),
});
```

### `outputExecutionPlan(calls)`

```typescript
outputExecutionPlan(deployCalls);
```

Prints the plan a `--dry-run` shows, with secrets masked. Went from
`(calls, asJson?)` to `(calls)` when `--json` was removed; the JSON branch was
unreachable from the CLI, since `executeDeployCalls` never passed the second
argument.

### `maskCommand(call)` / `maskVariables(call)`

```typescript
maskCommand(call);    // string — the command as it is safe to print
maskVariables(call);  // Record<string, string>
```

pyinfra takes its data on the command line, so the real values have to be in
`call.command`; these are the last point before they would reach a log, a
`--print-only` dump or a dry-run plan. `maskCommand` replaces the SSH
`--password` argument and every `--data "KEY=…"` whose key the manifest declared
a secret.

This covers nopy's own output only. The value still reaches pyinfra on its
command line, so it is visible in `ps` — inherent to pyinfra's `--data`
interface, not something nopy can mask.

### `summarizeResults(results)`

```typescript
const summary = summarizeResults(results);
// { total, successful, failed, totalDuration, failures: ExecutionResult[] }
```

---

## Workflow Module

Picks interactive, file-replay or history-replay and normalises all three into
one shape.

### `runWorkflow(sessionPath, cubes, config, options?, replaySession?)`

```typescript
const result = await runWorkflow(undefined, cubes, config, { useDefaults: false });
```

Dispatch order: `replaySession` (history) → `sessionPath` (file) → interactive.

```typescript
interface WorkflowResult {
  session: NopySession;
  selectedCubes: string[];   // ids chosen, or the session's cube keys on replay
  authMethod: string;
  username?: string;
  password?: string;
  replaySource?: 'file' | 'history';   // undefined on a fresh interactive run
}

interface WorkflowOptions {
  useDefaults?: boolean;
  useAuthKey?: boolean;
}
```

### `runInteractiveWorkflow(cubes, config, options?)`

Cube picker → host picker → auth. A host matching `@vagrant` or `@docker` skips
the auth prompt and uses `ssh`.

### `runReplayWorkflow(sessionPath, cubes, config)`

Loads and replays a session file. Re-prompts only for a missing host and for a
password (never persisted); a cube in the session that no longer exists is warned
about here and fails later in `resolveCube`.

### `runSessionReplayWorkflow(session, cubes, config)`

The same, from a session object rather than a path — the `-R` / `-H` path.

---

## Session Module

### Types

```typescript
interface NopySession {
  cubes: CubeSession[];     // required
  auth: AuthSession;        // required
  version?: string;
  timestamp?: string;       // ISO 8601
  name?: string;
  hosts?: string[];
  env?: TVariables;
}

interface CubeSession {
  key: string;          // the cube id
  variables: TVariables;
}

interface AuthSession {
  method: 'ssh-key' | 'password' | 'ssh';
  username?: string;
  // password is intentionally absent — never persisted
}
```

`version` and `timestamp` are stamped on every session nopy writes and demanded
of none it reads — an older file, or a hand-written one, simply lacks them.
Nothing validates compatibility beyond a warning on an unrecognised `version`;
the constant is exported as `SESSION_VERSION`.

A `CubeSession` records every value the cube settled on, whatever its origin —
not just the prompted ones — minus anything the manifest declared a secret. So a
`--use-defaults` run records a usable session instead of an empty one, and a
replay reproduces the run rather than re-deriving it from whatever the defaults
and `env` happen to say later.

### `saveSession(session, filePath)`

Writes JSON, creating the directory if needed.

### `loadSession(filePath)`

```typescript
const session = await loadSession('./deployment.session.json');
const session = await loadSession('./deployment.session.mjs');  // default export
```

Dispatches on the extension; `.json` and `.mjs` only. Validates that `cubes` is
an array, that `hosts` (if present) is an array, and that `auth` exists. A
`version` other than `SESSION_VERSION` warns on stderr and loads anyway.

### `createSession(params)`

```typescript
const session = createSession({
  cubes: [{ key: 'apt:essentials', variables: {} }],
  hosts: ['localhost'],
  auth: { method: 'ssh-key' },
});
```

Stamps `version` and `timestamp`; pass `timestamp` to override the latter. It
does not derive a `name` — that needs the resolved cube list, which does not
exist yet at the point the session is created, so `nopy()` fills it in at save
time.

### `describeSession(session, timestamp)`

The one-line `date - cubes → hosts` description, shared with the history list so
that the two cannot drift.

### `listSessions(dirPath?)`

Non-recursive; matches `*.nopysession.json`, `*.nopysession.mjs`,
`*.session.json` and `*.session.mjs`.

---

## History Module

Sessions are recorded automatically, into `.nopy.history.json` in the working
directory, before the deploy commands run — so a failed run is recorded too.

```typescript
const HISTORY_FILE = '.nopy.history.json';
const DEFAULT_HISTORY_SIZE = 10;

interface HistoryEntry {
  id: string;          // base36 timestamp + random suffix
  name: string;        // "MM/DD/YYYY, HH:mm - cube1, cube2 → host"
  timestamp: string;   // ISO
  session: NopySession;
}

interface SessionHistory {
  entries: HistoryEntry[];  // newest first
}
```

| Function | Returns | Notes |
|---|---|---|
| `getHistoryPath()` | `string` | `<cwd>/.nopy.history.json` |
| `loadHistory()` | `SessionHistory` | empty history if absent or unparseable |
| `saveHistory(history)` | `void` | |
| `addToHistory(session, maxEntries?)` | `HistoryEntry` | prepends, then trims to `maxEntries` |
| `getLastSession()` | `HistoryEntry \| undefined` | |
| `getSessionById(id)` | `HistoryEntry \| undefined` | |
| `listHistory()` | `HistoryEntry[]` | |
| `clearHistory()` | `void` | |
| `removeFromHistory(id)` | `boolean` | `false` if the id was not found |
| `formatHistoryList(entries)` | `string` | what `nopy history` prints |

Recording is suppressed for a dry run, a print-only run, a `-R`/`-H` replay out
of history, a run that built no deploy calls, `--no-history`, and
`history.autoSave: false` in the config. A `--load-session` run **is** recorded: it is not in history already, and
without the entry `-R` would have nothing to repeat.

---

## Config Module

### `NopyConfig`

The merged result. A config *file* is `NopyConfigFile`, which is this partial
plus a `resolution` block, and which lists `cubePackages` as plain strings.

```typescript
interface NopyConfig {
  hosts: string[];
  cubeDirs: string[];
  cubePackages: CubePackageRef[];
  env: TVariables;
  secrets?: string[];     // env keys to treat as sensitive that no manifest declares
  log?: LogConfig;
  history?: HistoryConfig;
  execution?: ExecutionConfig;
}

interface LogConfig {
  verbosity?: 'silent' | 'info' | 'verbose' | 'trace';
  debug?: boolean;
}

interface HistoryConfig {
  maxSessions?: number;   // default 10
  autoSave?: boolean;     // default true
}

interface ExecutionConfig {
  continueOnError?: boolean;
}

type ResolutionStrategy = 'merge' | 'override';
type ResolutionConfig = { [K in keyof NopyConfig]?: ResolutionStrategy };
```

### `CubePackageRef`

A package named in `cubePackages`, paired with where it was named. In the file an
entry is just a string (`"@bitsquare/nopy-cubes-core"`); `loadConfig()` normalises it.

```typescript
interface CubePackageRef {
  /** The package name, as written in the config. */
  spec: string;
  /** Directory of the `.nopyrc.json` that named it — resolution starts here. */
  from: string;
}
```

`from` is what makes a package named in a parent config resolve against *that*
config's `node_modules` rather than the working directory's. It is the same
problem `PATH_PROPERTIES` solves for relative `cubeDirs`, with a different answer:
a reference to resolve later instead of a rewritten path.

> The `CubePackageRef` name is currently not re-exported from the package root,
> though `NopyConfig` refers to it. Import it from `@bitsquare/nopy` and you get
> `NopyConfig` but not this type by name.

### `loadConfig()`

```typescript
const config = loadConfig();
```

Collects every `.nopyrc.json` from the working directory up to the filesystem
root, plus `~/.nopyrc.json`, and merges them **root-first** — so the most
specific file wins. The home config is applied first, at the lowest priority.

Per-property strategy comes from the child's `resolution` block, defaulting to
`merge`: arrays concatenate (and dedupe, when every element is a primitive),
objects deep-merge, primitives are replaced. `override` replaces outright.

```json
{
  "hosts": ["local-host"],
  "cubePackages": ["@bitsquare/nopy-cubes-core"],
  "resolution": { "hosts": "override" }
}
```

Only `cubeDirs` has its relative paths resolved against its own config file's
directory. `cubePackages` gets the origin recorded instead, as above.

**Throws** when no config file exists anywhere — which is why `nopy.cli.ts` calls
it lazily inside the action, so `--help` and `--version` work outside a project.

### `getConfigPaths()`

The config files that would be loaded, in merge order. Used for the banner.

### `saveConfig(data, configPath?)`

```typescript
saveConfig({ hosts: ['server.local'] });                    // <cwd>/.nopyrc.json
saveConfig({ hosts: ['server.local'] }, '/etc/.nopyrc.json');
```

Shallow-merges over whatever the target file already holds. The second parameter
is a **path**, not a boolean.

### `logConfigToFlags(logConfig?)`

```typescript
logConfigToFlags({ verbosity: 'verbose', debug: true });  // ['-vv', '--debug']
```

`silent → []`, `info → ['-v']`, `verbose → ['-vv']`, `trace → ['-vvv']`.
Nothing feeds the result into the built command — see
[Known gaps](#known-gaps).

---

## Prompts Module

### `CubeSelection(cubes)`

```typescript
const { selectedCubes } = await CubeSelection(cubes);  // string[] of ids
```

Multi-select with fuzzy filtering on the rendered label. A prompt dismissed with
Escape returns an empty array rather than throwing.

### `HostSelection(hosts)`

Offers `docker`, `vagrant`, the configured hosts, and `custom`, returning
`@vagrant/<vm>` or `@docker/<container>` where applicable.

### `AuthSelection(useAuthKey?)`

```typescript
const { authMethod, username, password } = await AuthSelection();
```

Returns `{ authMethod: 'ssh-key' }` immediately when `useAuthKey` is set.

### `PasswordSelection(username)`

Masked single prompt; returns the password.

### `VariableAssignment(cube, variables, opts?)`

```typescript
await VariableAssignment(cube, variables);                  // every schema key
await VariableAssignment(cube, variables, { keys: gaps });  // a subset
```

**Returns `Promise<void>` and mutates the `Variables` instance**, assigning at
`prompt`. Answers are coerced back to the schema's declared type — booleans from
`true`/`yes`/`1`, numbers where parseable — via `zodKind`, not `instanceof`.

It reads what to offer out of `variables`, so the caller is expected to have
assigned the schema defaults first (which `BuildContext.resolveCube` does). It
deliberately does not fall back to `cube.getDefaults()`: calling that a second
time re-evaluates every lazily declared default, so a cube generating one would
show a value different from the one the run already recorded.

Every schema key is offered, not just the defaulted ones — a field without a
default is precisely the field that has to be asked about. Keys already supplied
at `param` are skipped, since the operator's answer could not win anyway. A
cancelled form leaves the existing values in place.

---

## Update Module

`src/nopy.update.ts`. Backs `nopy self-update` and the one-line notice printed
before an install run. Every network call, clock read and process spawn is an
injectable option (`fetchImpl`, `now`, `run`, `spawn`), which is what makes the
module testable without a registry.

`@bitsquare/keyman` carries a near-identical copy (`keyman.update.ts`,
`KEYMAN_*` env vars, `~/.keyman/` cache). The duplication is deliberate: a fifth
workspace package would add a publish-order edge for ~250 lines.

### Channels

There is no stored channel — **the running version is the state**.

```typescript
channelForVersion('0.5.0');              // 'latest'
channelForVersion('0.6.0-rc.1');         // 'next'
channelForVersion('0.5.0-main.42.gabc'); // 'main'
```

`channelForVersion(version)` returns `'main'` when any prerelease part is the
literal `main`, `'next'` for any other prerelease, and `'latest'` otherwise —
including for an unparseable version, where the worst case is a check that finds
nothing newer. It is the mirror image of the rule `release.yml` publishes under,
so a binary always checks the tag it came from.

### `resolveRegistry(options?)`

`NOPY_REGISTRY` → `npm config get @bitsquare:registry` → `NPMJS_REGISTRY`.
Asking npm is the load-bearing part: a CLI installed from Gitea checks Gitea for
its own updates with nothing else configured, because the scope mapping that
installed it is still in `.npmrc`. npm prints the literal string `undefined` for
an unset key, which is treated as unset; a missing npm is swallowed. Returns
trailing-slash form (`normalizeRegistry`).

### `fetchChannelVersion(options)`

```typescript
await fetchChannelVersion({ registry, channel, timeoutMs?, token?, fetchImpl?, packageName? });
```

One `GET ${registry}${encodeURIComponent(name)}` with the abbreviated-packument
accept header, returning `body['dist-tags'][channel] ?? null`. A non-`ok`
response is `null`, not a throw. Deliberately `fetch` rather than shelling out to
`npm view`: one request, a real timeout, and immune to npm's startup cost.
`token` (from `NOPY_REGISTRY_TOKEN`) becomes a bearer header for a private
registry.

### `checkForUpdate(options)` → `UpdateStatus`

```typescript
interface UpdateStatus {
  current: string;          // the running version
  latest: string | null;    // what the channel points at, null if undeterminable
  channel: Channel;
  registry: string;
  updateAvailable: boolean; // semver.gt(latest, current)
  fromCache: boolean;
}
```

Cached in `~/.nopy/update-check.json` for `DEFAULT_CHECK_INTERVAL_MS` (24 h). An
entry counts as fresh only when its channel **and** registry match the current
question and its age is finite, `>= 0` (a future timestamp is rejected) and under
the interval. A failed lookup degrades to the applicable cached answer rather
than to no answer.

### `buildSelfUpdateCommand(options)`

```typescript
buildSelfUpdateCommand({ packageManager: 'npm', channel: 'main', registry: gitea });
// → npm install --global @bitsquare/nopy@main --@bitsquare:registry=https://…/npm/
```

The registry flag is **scope-mapped, never bare `--registry`**: the Gitea
registry serves `@bitsquare` only and does not proxy npmjs, so a bare
`--registry` breaks the install's transitive dependencies. It is omitted
entirely when the registry is already npmjs. `pnpm add --global`,
`yarn global add` and `bun add --global` are the other three forms.

### `detectPackageManager(options?)`

`NOPY_PACKAGE_MANAGER` wins; otherwise the install path is the evidence —
`/pnpm/`, `/.bun/`, `/.yarn/`|`/yarn/`, else npm. The point is that
`self-update` re-runs whatever installed the CLI instead of leaving two copies
on `PATH`.

### `updateNotice(options)` / `formatUpdateNotice(status, pm?)`

`updateNotice()` is the startup path: returns the string to print or `null`, and
**never throws** — it sits in front of every command the user actually asked
for. Returns `null` immediately when `isUpdateCheckDisabled(env)`:
`NOPY_NO_UPDATE_CHECK` set to anything but `0`/`false`, or `CI` set at all. The
CLI prints it to **stderr**, so a piped `--print-only` stays clean.

### `selfUpdate(options)` → `SelfUpdateResult`

Always checks with `force: true` — the user asked, so a cached answer will not
do. Returns `{status, command, ran}`; `ran` is `false` for `dryRun`, and for
"already current" unless `force`. The install inherits stdio.

| Env var | Effect |
| --- | --- |
| `NOPY_REGISTRY` | registry to check and install from |
| `NOPY_REGISTRY_TOKEN` | bearer token for a private registry |
| `NOPY_NO_UPDATE_CHECK` | suppress the startup notice |
| `NOPY_PACKAGE_MANAGER` | override install-command detection |
| `CI` | suppresses the notice implicitly |

---

## CLI Usage

```bash
nopy install                  # interactive (the default command; `nopy` alone works, as does `nopy i`)
nopy install -D               # use defaults, no variable prompts
nopy install -K               # force SSH key auth
nopy install -R               # repeat the last session from history
nopy install -H <id>          # replay a specific session from history
nopy install -s ./sess.json   # save the session after deploying
nopy install -l ./sess.json   # replay a session file
nopy install -n               # dry run — print the plan, execute nothing
nopy install -P               # print the built pyinfra commands and exit
nopy install -c               # continue after a failure
nopy install --no-history     # do not record this run

nopy history                  # list recorded sessions (alias: h; -j for JSON)
nopy clear-history            # drop them all

nopy self-update              # install the newest version on the current channel (alias: upgrade)
nopy self-update -n           # print the install command, run nothing
nopy self-update -f           # reinstall even when already current
nopy self-update --channel next --registry <url>
```

`--continue-on-error` overrides `execution.continueOnError` from the config.
Exit code is 1 when any cube failed.

`self-update` prints Installed / Channel / Registry / Available, then one of
"Updated to X.", "Would run: …", or "Already up to date." When `latest` is
`null` it reports `Could not reach <registry>` and exits 1 — deliberately not
"up to date", since an unanswerable check is not a negative answer. See
[Known gaps](#known-gaps) for what that message conflates.

> `-H <id>` and `--no-history` share one Commander destination, so passing both
> discards the id and falls through to an interactive run.

---

## Creating a Cube

### File structure

A cube is a directory holding both a manifest and a deploy script:

```
cubes/
└── apt/
    └── essentials/
        ├── manifest.mjs
        └── deploy.py
```

Directories may be nested for grouping, and any extra files alongside the pair
are reachable from the deploy script, which runs with the cube directory as its
working directory. The prefixed forms `<name>.manifest.mjs` and
`<name>.deploy.py` are still recognised.

### Manifest

```javascript
// manifest.mjs
import { Manifest } from '@bitsquare/nopy-cubes';
import { z } from 'zod';

export default Manifest({
  id: 'apt:essentials',
  name: 'Install essential packages',
  dependencies: () => ['apt:update'],
  schema: z.object({
    PACKAGES: z.string().default('curl,git').describe('Comma-separated packages'),
    ENABLE_FEATURE: z.boolean().default(false).describe('Enable the optional feature'),
  }),
  before: [(ctx, vars) => console.log('before', vars.PACKAGES)],
  after: [(ctx, vars) => ctx.exec('admin:report', { STAGE: 'apt' })],
});
```

> **Call `.default()` before `.describe()`.** In zod 4, `.default()` returns a
> `ZodDefault` wrapper that does not inherit `.description` from the type it
> wraps, and the prompt reads the description off the outer node. So
> `z.boolean().describe('Update cache').default(false)` prompts with the bare key
> `UPDATE`, while `z.boolean().default(false).describe('Update cache')` prompts
> with the sentence. Verified against zod 4.4.3.

Every schema key reaches pyinfra as `--data KEY=value`, so `host.data.KEY` is
always defined. pyinfra parses the values itself: `"true"` arrives as a bool and
numeric strings as ints.

### Deploy script

```python
# deploy.py
from pyinfra import host
from pyinfra.operations import apt, server

PACKAGES = host.data.PACKAGES.split(',')
ENABLE_FEATURE = host.data.ENABLE_FEATURE

apt.packages(name='Install packages', packages=PACKAGES, update=True, _sudo=True)

if ENABLE_FEATURE:
    server.shell(name='Enable feature', commands=['my-package --enable-feature'])
```

For packaging cubes as an installable npm bundle, see
[CUBE-BUNDLES.md](CUBE-BUNDLES.md).

---

## Known gaps

Real behaviour that a reader would otherwise take on trust. Tracked in
`DOCS-AUDIT.md` and summarised in `CLAUDE.md`.

- **`logConfigToFlags()` is never consumed.** It is exported and unit-tested, but
  nothing feeds its output into the built pyinfra command, so `log.verbosity` and
  `log.debug` in `.nopyrc.json` have no effect today.
- **No cycle detection.** Ordering is a side effect of recursion, not a
  topological sort. Two mutually dependent cubes overflow the stack.
- **`DeployCall.dependencies` is always `[]`.** The field is populated nowhere;
  dependency information lives in the emission order.
- **`ExecutionResult.stdout` / `.stderr` are always `undefined`,** because the
  executor inherits stdio rather than capturing it. This is also why `install`
  has no `--json`: during a run nopy does not own its own stdout, so there is no
  stream to put a machine-readable answer on. Use `--print-only` for the plan and
  the exit code for the verdict.
- **Hook variables are not schema-validated.** The second argument to a hook is
  the effective values as collected. `schema.parse()` runs in exactly one place —
  `Cube.getDefaults()`, against `{}` — and prompt input is type-coerced, which is
  not the same thing.
- **Nothing checks bundle/CLI compatibility.** A cube package declares no
  supported nopy range and the loader scans whatever directories it finds.
- **`self-update` reports an empty channel as unreachable.** `latest === null`
  means either the request failed *or* the registry answered normally and the
  dist-tag simply has no version — the second is exactly what a Gitea package
  with no `latest` looks like — and both print `Could not reach <registry>`.
  The distinction exists in `fetchChannelVersion` (a non-`ok` response returns
  `null` rather than throwing) but is not carried out to the message.
