# Documentation audit

Every claim in the repository's Markdown was checked against the source it
describes. Findings are grouped by *kind of divergence*, because the fix differs:
a phantom feature needs a decision (build it or delete the docs), a wrong claim
needs an edit, a gap needs prose.

Severity is about what it costs a reader:

- **🔴 broken** — following the documentation produces a wrong result or a crash.
- **🟠 misleading** — the documentation states something the code does not do.
- **🟡 gap** — the code does something real that no document mentions.

Verified against the working tree at commit `fcc1817`. Line numbers are from that
state.

Findings closed since are marked **✅ … fixed** and keep their original text as
the record of what was wrong. So far: §1.1 (`--use-defaults`), §2.2
(`getDefaults()`), §2.1 (precedence — the second half closed differently than
proposed), §3 in full (`docs/API.md`, regenerated), §4.2 (password on stdout —
points 1 and 2 of 3), §4.3 (what a session records), §2.9 (the nopy README's
yarn install instructions), §2.4 (`version` / `timestamp`, implemented rather
than deleted), §2.5 (`listSessions`' filename filter), §4.5 (`-s` on a replay,
plus `-l` and history), §6.7 (a secret written to the session in plaintext), and
one bullet of §6.4.

Closing §3 also settled the documentation half of several findings elsewhere
without touching their underlying cause: §1.3, §1.5, §2.3, §2.7, §4.4 and
§6.5 are each now stated accurately in `docs/API.md`, but the code still behaves
as those findings describe and they stay open. §1.2 was closed outright by
removing the flag.

## Where the drift is

A field run against a fresh VM sorted the findings for us, and they cluster on
one seam. **Everything a human reads on screen matched the documentation.
Everything machine-facing had drifted** — `--json`, the session format, `-s` on a
replay, `-l` and history, `runtime:nodevm`'s parameters, the bundle's install
command.

That is not random rot. The interactive surface is maintained by daily use: a
wrong prompt label is noticed the next time someone runs the thing. The scripting
surface was documented from intent and then never exercised, so nothing pushed
back when it changed or was never built.

Corrections come in the two shapes that distinction implies. `--json` was
documented from intent and never built, so it was removed (§1.2). The rest was
built and then drifted, so it was fixed. Keeping it fixed means what remains of
the scripting surface — `--print-only`, sessions, history — needs tests that
assert on **stdout**, not prose.

---

## Contents

- [Where the drift is](#where-the-drift-is)
- [1. Documented features that do not exist](#1-documented-features-that-do-not-exist)
- [2. Documented behaviour that differs from the code](#2-documented-behaviour-that-differs-from-the-code)
- [3. ✅ `docs/API.md` — systematic drift — fixed](#3--docsapimd--systematic-drift--fixed)
- [4. Undocumented behaviour](#4-undocumented-behaviour)
- [5. Cube documentation](#5-cube-documentation)
- [6. Defects found while verifying](#6-defects-found-while-verifying)
- [7. Checked and accurate](#7-checked-and-accurate)
- [Suggested order of attack](#suggested-order-of-attack)

---

## 1. Documented features that do not exist

These are the same class of problem as the `--parallel` flag that was removed
earlier: documented in detail, absent from the source.

### 1.1 ✅ `-D, --use-defaults` does nothing — **fixed**

> **Resolved.** The flag is now implemented; see `docs/REFACTORING.md` item 5.
> `BuildContext.resolveCube` skips the prompts, `env` in `.nopyrc.json` outranks
> the schema default so a non-interactive run can be configured, and a cube with
> a variable nothing can fill aborts the run by name instead of deploying it
> blank. The finding below is kept as the record of what was wrong.

| | |
|---|---|
| **Docs say** | `README.md:291` "Install with defaults (no prompts for customization)"; `docs/API.md:39` "Skip variable prompts, use defaults"; `nopy.cli.ts:54` "Run cubes with default values without prompts" |
| **Code does** | Nothing. |

The option is threaded through four layers and then dropped. `nopy.cli.ts:95` →
`nopy.main.ts:125` → `nopy.main.ts:174` → `BuildContext.options.useDefaults`
(`cubes/dependencies.ts:35`), where it is **never read**. The only branch that
skips prompting is `isSessionReplay` (`cubes/dependencies.ts:62`).
`runInteractiveWorkflow` destructures only `useAuthKey` and ignores its
`useDefaults` too (`nopy.workflow.ts:50`).

Every documented `-D` invocation — including
`nopy install -D --save-session automated-deployment.nopysession.json`
(`README.md:226`), which is presented as the way to do an unattended run —
prompts for every variable of every cube.

```
$ grep -rn "useDefaults" packages/nopy/src/
nopy.workflow.ts:19    useDefaults?: boolean;      # declared
nopy.main.ts:94        useDefaults?: boolean;      # declared
nopy.main.ts:125       useDefaults = false,        # defaulted
nopy.main.ts:158       { useDefaults, useAuthKey },# passed
nopy.main.ts:174       useDefaults,                # passed
nopy.cli.ts:95         useDefaults: options...     # passed
cubes/dependencies.ts:35  useDefaults?: boolean;   # declared — and that is all
```

### 1.2 🔴 `-j, --json` produces no output on success — **closed by removal**

| | |
|---|---|
| **Docs say** | `README.md:18` "**JSON output** for CI/CD integration"; `README.md:360-367` "Machine-readable JSON output for scripting and CI/CD integration"; `docs/API.md:573` |
| **Code does** | Emits JSON **only** on failure. |

`jsonOutput` reaches three places in `nopy.main.ts` (140, 150, 219) and none of
them prints a result. It suppresses the config banner, prints
`{success: false, errors}` when cube *loading* fails, and suppresses progress
lines. The success path at `nopy.main.ts:226-236` returns the `NopyResult` object
to the caller, and `nopy.cli.ts:107-110` inspects `result.success` without
printing it.

A CI job running `nopy install --json` gets pyinfra's inherited stdio and nothing
machine-readable. The exit code is the only usable signal.

Related: `--dry-run --json` prints the **text** plan, not JSON.
`executeDeployCalls` calls `outputExecutionPlan(calls)` without the `asJson`
argument (`nopy.executor.ts:172`), even though the function supports it
(`nopy.executor.ts:110`).

**Closed by deleting the flag, not by implementing it.** `executeDeployCalls`
runs pyinfra with *inherited* stdio, so during a run nopy does not own its own
stdout — pyinfra does. A JSON blob appended after an unbounded amount of another
process's output is not machine-readable by any definition a caller could rely
on; making it so means capturing pyinfra's output and giving up live progress.
Same root cause as `ExecutionResult.stdout` never being populated. What replaced
it is a promise a test can hold to: **stdout carries the deploy commands and
pyinfra's own output, everything nopy says about itself goes to stderr**, and the
exit code is the verdict. `nopy history --json` is a different flag, it works,
and it stays.

### 1.3 🟠 `log.verbosity` and `log.debug` have no effect

Pre-existing known drift, recorded in `CLAUDE.md`, but the README still presents
it as a working feature — two tables, a recommendation paragraph, and a slot in
the config example (`README.md:127-130`, `143-163`).

`logConfigToFlags()` (`nopy.config.ts:352`) is exported and has 8 unit tests, but
nothing calls it. `buildDeployCall` (`cubes/dependencies.ts:105-124`) constructs
the pyinfra argv without consulting `config.log` at all.

This is live in the repo's own config: `packages/nopy/.nopyrc.json` sets
`"verbosity": "trace", "debug": true` and gets neither.

### 1.4 🟠 Manifest `env` property

`README.md:14` lists "**Default values** with optional customization via manifest
`env`". `env` was removed from `Manifest` — see `docs/REFACTORING.md` item 3, and
the current interface at `cubes/types.ts:43-56`, which has `id`, `name`,
`schema`, `dependencies`, `before`, `after` and nothing else.

### 1.5 🟠 Topological sorting

`README.md:11` ("Dependency resolution with **topological sorting**"),
`README.md:25` ("Topologically sorts cubes based on dependencies") and
`README.md:381` ("because cubes are topologically sorted") describe an algorithm
that does not exist.

There is no sort. `BuildContext.resolveCube` recurses depth-first and pushes each
cube after its dependencies, with a `${cubeId}:${host}` set for idempotence
(`cubes/dependencies.ts:43-100`, `105-143`). The ordering is a side effect of the
recursion order.

This matters beyond vocabulary: a topological sort detects cycles, and this does
not. Two cubes that depend on each other recurse until the stack overflows —
`resolvedCubes` is only consulted in `buildDeployCall`, which runs *after* the
recursive call. `docs/API.md:160` still promises `Error` "if ... circular
dependency detected".

> The `API.md` promise is gone (§3): the regenerated file states that ordering
> falls out of the recursion and that there is no cycle detection. The README
> claims and the missing detection itself both stand.

---

## 2. Documented behaviour that differs from the code

### 2.1 ✅ Variable precedence is wrong in both directions — **fixed**

> **Resolved, though the second pair closed the opposite way to the README's
> original claim.** `env` now outranks the Zod defaults, as documented — that was
> a prerequisite for `--use-defaults` being configurable at all.
>
> Dependency/hook params still outrank prompts, deliberately. They do not compete
> in practice: `VariableAssignment` leaves out any key a dependency supplied, so
> the operator is never asked about it and there is no typed value to override.
> The README documents the real order rather than the old promise.
>
> The underlying complaint — that precedence was the field order of an object
> literal and so could be neither named nor questioned — is what
> `docs/REFACTORING.md` item 6 addresses. `Origin` now ranks
> `default < env < session < prompt < param` as data, and every value carries the
> origin it came from.

`README.md:107-113` stated:

> **Priority order (lowest to highest):**
> 1. Zod schema `.default()` values
> 2. Global `env` from `.nopyrc.json`
> 3. Accumulated variables from dependencies
> 4. User prompts / session replay

`Variables.get()` (`nopy.common.ts:33-39`) does:

```typescript
return {
  ...this.global,             // 1. config env        (lowest)
  ...this.defaults[id],       // 2. Zod defaults
  ...this.prompts[id],        // 3. what the user typed
  ...this.params[id],         // 4. dependency / hook  (highest)
};
```

Two pairs are inverted, and both have consequences:

- **Zod defaults beat `env`, not the other way round.** So `README.md:114` —
  "allowing users to override them globally via `.nopyrc.json`" — is backwards.
  Setting `"env": {"UPDATE": false}` cannot override a cube declaring
  `.default(true)`; the `env` value is only visible for keys the schema does not
  define. This is why `KEY_DIR` works in `packages/nopy/.nopyrc.json` (no cube
  declares it) and why anything else would not.
- **Dependency/hook parameters beat user prompts.** A value passed as
  `[['user:add', {USER: 'deploy'}]]` silently overrides what the operator just
  typed at the form. The docs promise the opposite.

### 2.2 ✅ "Every key ... is guaranteed to be present on `host.data`" — not when a field lacks `.default()` — **fixed**

> **Resolved.** `getDefaults()` falls back to a per-field read, so one required
> field no longer wipes out the rest; `VariableAssignment` prompts for every
> schema key rather than only the defaulted ones; and `--use-defaults` refuses
> to deploy a cube whose required key nothing supplied. Verified against all 22
> cubes in `cubes/`: 19 build a complete `-D` run, the 3 below abort by name.
>
> Re-measured against the 25 cubes now in `packages/nopy-cubes-core/cubes`: 20 build a
> complete `-D` run and 5 abort by name. Two of the additions are deliberate —
> `user:add` lost its `PUBKEY` default (it was a specific personal key), and
> `ssh:keygen` inherits that failure because it declares `dependencies: () =>
> ['user:add']` and passes no parameters. See §6.6.

`README.md:99` states it outright; `README.md:105` claims defaults ensure "every
cube has a predictable starting state".

`Cube.getDefaults()` (`cubes/types.ts:106-112`) is:

```typescript
try {
  return this.manifest.schema.parse({});
} catch {
  return {} as z.infer<Schema>;
}
```

One field without a `.default()` makes `parse({})` throw, and the `catch`
discards the defaults of **every other field in the cube**. `VariableAssignment`
then iterates over that empty object and returns before prompting
(`nopy.prompts.ts:175-181`), so the user is never asked. The cube deploys with no
`--data` flags at all and every `host.data.X` is `None`.

Three cubes in this repo are in that state today:

| Cube | Field(s) without `.default()` | Result |
|---|---|---|
| `net:wifi:connection` | `SSID`, `PASSWORD` | no prompt, no `--data`, all 4 vars lost |
| `service:autostart` | `APP` | no prompt, no `--data`, all 3 vars lost |
| `user:edit` | `USER` | no prompt, no `--data`, all 4 vars lost |

The failure is silent — no error, no warning, just a pyinfra run with an empty
data set.

### 2.3 🔴 `.describe()` before `.default()` loses the prompt label

`CLAUDE.md` and the cube contract state that each schema field is `.describe()`d
and "the description is the prompt label". `nopy.prompts.ts:184-185` reads it as:

```typescript
const zodType = schema[key];
const description = zodType?.description || key;
```

In zod 4, `.default()` returns a `ZodDefault` **wrapper** that does not inherit
`.description` from the type it wraps. Ordering therefore decides whether the
label survives:

```
z.boolean().describe('Update package cache').default(false)   →  description undefined
z.boolean().default(false).describe('Update package cache')   →  description preserved
```

The README's own manifest example (`README.md:67-68`) uses the losing order, so
anyone copying it gets bare `UPDATE` / `PACKAGES` keys as prompt labels instead
of the sentences they wrote. `docs/API.md:610` happens to use the working order —
the two documents disagree, and neither mentions that it matters.

> `docs/API.md` now says so explicitly, next to its manifest example, with the
> zod 4.4.3 measurement (§3). The README example and the 15 affected manifests
> are untouched, and the one-line fix in `nopy.prompts.ts` — read through the
> `ZodDefault` wrapper — is still the better answer.

15 of the 22 cubes in `cubes/` are affected; among them
`net:tailscale` (all 4 fields), `runtime:nodevm` (all 4), `user:add` (all 4),
`ssh:keygen` (all 4) and `admin:locale` (all 4).

### 2.4 ✅ Session files claim `version` and `timestamp` fields — **fixed**

Closed by implementing them rather than deleting the claim. `createSession`
stamps `version: '1.0.0'` (exported as `SESSION_VERSION`) and an ISO
`timestamp`; `nopy()` fills in a default `name` at save time, using the same
`describeSession()` the history list uses — one implementation, so the two
cannot drift. `loadSession` still requires only `cubes` and `auth`, so every
session written before this, and every hand-written one, keeps loading; an
unrecognised `version` is a warning on stderr, never a refusal. The interface
and both documents now mark the three fields optional, which is what they are.

The original finding follows.


`README.md:179-181` shows a session with `"version": "1.0.0"` and
`"timestamp": "2025-10-13T10:30:00Z"`, and `docs/SESSION_FORMAT.md:305-306`
declares both **required** in the `NopySession` interface. Every MJS example in
that file sets them.

`NopySession` (`nopy.session.ts:44-55`) has neither. `createSession`
(`nopy.session.ts:183-197`) does not add them, `saveSession` writes the object
verbatim (`nopy.session.ts:68-79`), and `loadSession`'s validation
(`nopy.session.ts:146-155`) checks only `cubes`, `hosts` and `auth`. The
repository's own `packages/nopy/example.nopysession.json` omits both — it does
not match the format its own documentation prescribes.

Consequence: a `version` field implies a compatibility check that does not exist.
Nothing reads it, so an incompatible old session fails later and more obscurely
than a version check would.

### 2.5 ✅ Session filename convention does not match `listSessions()` — **fixed**

`listSessions` now matches `*.nopysession.json` and `*.nopysession.mjs` as well
as the two shorter suffixes — `saveSession` writes whatever path it is handed,
so files under the old name exist and there was no reason to stop finding them.

The original finding follows.


The READMEs consistently use `*.nopysession.json` (`README.md:223`, `330`, `338`;
`docs/DOCKER.md:54`; the shipped `example.nopysession.json`).
`docs/SESSION_FORMAT.md` consistently uses `*.session.json` / `*.session.mjs`.

`listSessions()` (`nopy.session.ts:173`) matches only the second form:

```typescript
.filter((file) => file.endsWith('.session.json') || file.endsWith('.session.mjs'))
```

`"my-deployment.nopysession.json"` does not end in `".session.json"`, so the
file naming the README recommends is invisible to the function documented at
`docs/API.md:430`. `loadSession` is unaffected (it switches on `.json`/`.mjs`),
so this only bites the listing API.

### 2.6 ✅ `docs/DOCKER.md` container name contradicts the file it points at — **fixed**

> **Resolved.** `example.nopysession.json` now targets
> `@docker/nopy-test-container`, matching the guide, `packages/nopy/.nopyrc.json`
> and the session example in the nopy README. `nopy-test-ubuntu` was the outlier.
> Worth knowing why it silently "worked": an identifier with no matching
> container is read as an *image*, so the run built and committed a throwaway
> image instead of failing — the mode `docs/DOCKER.md` now documents at the end.
> The finding below is kept as the record of what was wrong.

`docs/DOCKER.md:35` and `:45`:

> We explicitly name it `nopy-test-container` because the
> `example.nopysession.json` is configured to target this specific container name.

`packages/nopy/example.nopysession.json` targets `@docker/nopy-test-ubuntu` —
the *image* tag from the build step, not the container name. Following the guide
exactly produces a pyinfra run against a container that does not exist.

(`packages/nopy/.nopyrc.json` does list `@docker/nopy-test-container` in `hosts`,
so the guide was probably written against the config rather than the session.)

### 2.7 🟠 `docs/HOOKS.md` — hook parameters are not validated

`docs/HOOKS.md:48` describes the hook's second argument as "The final,
**validated** variables for the current cube".

`cubes/dependencies.ts:71` passes `this.variables.get(cubeId)` — a plain merge of
the four scopes. `schema.parse()` is called in exactly one place,
`Cube.getDefaults()` on an empty object, to extract defaults. Values from
prompts, `env`, dependencies and hooks are never validated against the schema at
any point in the pipeline. `coerceValue` (`nopy.prompts.ts:145-159`) type-coerces
prompt input, which is not the same as validation and does not apply to the other
three scopes.

### 2.8 🟠 `docs/HOOKS.md` — dependencies can pass variables too

The comparison table at `docs/HOOKS.md:83` says variable passing is
"Inherited from env" for dependencies versus "Explicitly passed via `exec()`" for
hooks, presenting explicit parameters as a hook-only capability.

`DependencySpec` is `string | [id, variables?]` (`cubes/types.ts:23`) and
`cubes/dependencies.ts:86-88` unpacks the tuple and forwards it into the same
`params` scope that `exec()` writes to. The two mechanisms are identical in this
respect; per §2.1 both outrank user prompts.

### 2.9 ✅ nopy README installation section describes the wrong package manager — **fixed**

> **Resolved.** The yarn-workspace block is gone. The section now opens with
> `npm install -g @bitsquare/nopy` (and the pnpm equivalent), documents the
> `latest` / `next` / `main` channels, shows the `@bitsquare` scope mapping
> needed to install from Gitea, and gains an *Upgrading* section covering
> `nopy self-update` and the `NOPY_*` env vars. The finding below is kept as the
> record of what was wrong.

`README.md:248-279` says "This package is part of a **yarn** workspace monorepo",
then gives `yarn install`, `yarn workspace @bitsquare/nopy build`,
`yarn workspace @bitsquare/nopy nopy`, and `yarn nopy`.

The repo is a **pnpm** workspace: `packageManager: "pnpm@11.17.0"` in the root
manifest, `pnpm-workspace.yaml`, a `pnpm-lock.yaml`, and every other document
(root `README.md`, `README.PUBLISH.md`, `CLAUDE.md`) uses pnpm. There is no
`yarn.lock`.

The section is also the wrong content for the file. `README.md` is one of three
files shipped in the npm tarball (`files: ["dist", "README.md", "LICENSE"]`), so
this is what a reader sees on npmjs.com — build-from-monorepo instructions
instead of `npm install -g @bitsquare/nopy`, which is what the root README and
`README.PUBLISH.md:314` correctly tell people to run.

### 2.10 ✅ keyman README: two operations missing, one operation invented — **fixed**

> **Resolved.** The README was rewritten against the code (`packages/keyman/docs/PLAN.md`
> Phase 9). All nine menu entries are documented, and a test asserts it contains
> every label `keyman.main.ts` offers, so a tenth cannot arrive undocumented.
> Encrypt is described as the union of `~/.ssh` and the tmp directory, which is
> what it does. The Quick Start now points at the Generate operation instead of
> `ssh-keygen`. Rotation stopped being an invention in Phase 10: it exists, in two
> halves (`keyman.rotate.ts`), and the README documents the sequence. The whole CLI
> surface is there too — `helpText()` quoted verbatim, with a test that fails if the
> two diverge — which was the other half of this, tracked as
> `packages/keyman/docs/AUDIT.md` §5.3. The finding below is kept as the record.

`packages/keyman/README.md:90-96` lists four menu entries: List, Encrypt,
Decrypt, Quit. The menu (`keyman.main.ts:54-61`) has six:

```
📋 List keys      📝 Copy public key      🆕 Generate key
🔒 Encrypt keys   🔓 Decrypt keys         ❌ Quit
```

`Copy public key` and `Generate key` are undocumented — the latter being the only
way to create a key inside the tool, which is why the Quick Start
(`packages/keyman/README.md:33`) tells the user to shell out to `ssh-keygen`
manually.

Conversely `packages/keyman/README.md:11` advertises "🔄 Support for key
rotation". There is no rotation anywhere: `grep -rn "rotat" packages/keyman/src/`
returns nothing.

`packages/keyman/README.md:93` also says encrypt takes keys "from `vault/tmp/`".
`encryptKeys` (`keyman.encrypt.ts:12-22`) unions `~/.ssh` and `vault/tmp`, and
offers both in the checkbox.

### 2.11 🟡 Root README understates the coverage gate

Root `README.md:57-58` describes "a hard **85 % branch** floor". Both
`vitest.config.ts` files set four thresholds: branches 85, functions 85, lines
80, statements 80. `README.PUBLISH.md:135` and `CLAUDE.md` both state all four —
the root README is the odd one out, and it is the file a new contributor reads
first.

### 2.12 ✅ `docs/DOCKER.md` relative link is broken — **fixed**

> **Resolved.** The link is now `../README.md`.

`docs/DOCKER.md:8` links `[README.md](./README.md)`, which resolves to
`packages/nopy/docs/README.md` — nonexistent. It should be `../README.md`.

---

## 3. ✅ `docs/API.md` — systematic drift — **fixed**

> **Resolved by regenerating the file**, which is what §3's own recommendation
> asked for — the drift was structural rather than a set of stale lines, so
> patching would have left the shape wrong. Every export in `src/index.ts` was
> re-read against its source and the file now covers all of them: the authoring
> package as its own section, `BuildContext` in place of the phantom Builder
> Module, and the variables, history and prompts modules that had no entry at
> all. The findings below are kept as the record of what was wrong.
>
> Three things were deliberately added rather than merely corrected. A
> **Known gaps** section states the behaviour a reader would otherwise take on
> trust — `logConfigToFlags` being unconsumed (§1.3), the absent cycle detection (§1.5, §6.5), `DeployCall.dependencies`
> always being `[]`, `ExecutionResult.stdout`/`stderr` never being populated, and
> hook variables not being schema-validated (§2.7). The `.describe()`/`.default()`
> ordering hazard (§2.3) is called out where the manifest example lives, with the
> zod 4.4.3 measurement. And `-P` is documented alongside the rest of the CLI
> (§4.4 — the README half of that finding stands).
>
> One thing surfaced while writing it and is **not** fixed: `CubePackageRef` is
> referenced by the exported `NopyConfig` but is not itself re-exported from
> `src/index.ts`, so a consumer cannot name the type. Recorded in the file as a
> note.

`docs/API.md` documents an earlier architecture. It is not a matter of
individual stale lines: the two central type definitions, one whole module, and
two of the documented functions describe code that no longer exists. Anyone
building against this file writes code that will not compile.

Recommendation: regenerate rather than patch.

### 3.1 🔴 Functions that do not exist

| Documented | Reality |
|---|---|
| `resolveDependencies(cubes, selectedCubeNames)` (`API.md:142-160`) | No such export. Resolution is `BuildContext.resolveCube` and returns nothing — it accumulates into `deployCalls`. |
| `buildDeployCalls(cubeNames, hosts, context)` (`API.md:286-313`) | No such export. The entire "Builder Module" section, and its `BuildResult` interface, describes code replaced by `BuildContext` (`docs/REFACTORING.md` item 2). Still listed in the table of contents at `API.md:12`. |

### 3.2 🔴 `Cube<Schema>` — wrong shape entirely

`API.md:75-84` documents an interface with `key`, `dependencies: string[]`,
`schema`, `defaults()`, `before`, `after`.

`Cube` (`cubes/types.ts:88-113`) is a **class**: constructor `(manifest, dir,
deployScript)`, getters `id` and `name`, method `getDefaults()`. Everything else
lives behind `.manifest`. Not one documented member name is correct — `key` is
`id`, `defaults()` is `getDefaults()`, and `dependencies`/`schema`/`before`/
`after` are on `cube.manifest`, not on `cube`.

### 3.3 🔴 `Manifest<Schema>` — wrong shape

`API.md:92-100` documents `key`, `dependencies: string[]`, `defaults: () => ...`.

`Manifest` (`cubes/types.ts:43-56`) has `id` (not `key`), no `defaults` member at
all, and `dependencies` is a **function of the collected variables**:

```typescript
dependencies?: (variables: z.infer<Schema>) => DependencySpec[];
```

That signature change is the headline of `docs/REFACTORING.md` item 2. The
`API.md` example at `:171` does use the function form, so the file contradicts
itself two paragraphs apart. Both `Cube` and `Manifest` are additionally shown
as generic over `z.AnyZodObject`, which zod 4 removed; the codebase defines
`AnyObjectSchema` for exactly this reason (`cubes/types.ts:13`).

### 3.4 🟠 Incorrect signatures and examples

| Location | Documented | Actual |
|---|---|---|
| `API.md:486-492` | `saveConfig(data, local?)`, example passes `false` | `saveConfig(data, configPath?: string)` (`nopy.config.ts:323`). Passing `false` writes nothing useful. |
| `API.md:481-484` | Search order `./nopyrc.json` then `~/.nopyrc.json` | Filename is `.nopyrc.json` (leading dot). Home is applied **first** (lowest priority, `nopy.config.ts:117-120`), all ancestors are collected and merged root-first, and the function **throws** when none is found (`nopy.config.ts:285-289`). The `resolution` merge strategy is not mentioned. |
| `API.md:534-540` | `VariableAssignment(cube, env)` returning vars | `VariableAssignment(cube, variables: Variables)` returns `Promise<void>` and mutates the `Variables` instance (`nopy.prompts.ts:167`). The example's return value is always `undefined`. |
| `API.md:321-331` | `runWorkflow(sessionPath, cubes, config, options?)` | Takes a fifth parameter `replaySession?: NopySession` (`nopy.workflow.ts:206-212`) — the entire history-replay path. |
| `API.md:337-344` | `WorkflowResult.cubesWithDependencies` | Field is `selectedCubes` (`nopy.workflow.ts:31`). |
| `API.md:202-209` | `DeployCall.dependencies: string[]` | `DependencySpec[]` (`nopy.executor.ts:27`) — and always `[]` in practice (`cubes/dependencies.ts:132`). |
| `API.md:452-457` | `NopyConfig` with 4 fields | Missing `history` and `execution` (`nopy.config.ts:68-81`). |
| `API.md:37-45` | 7 `NopyOptions` parameters | Missing `printOnly`, `replaySession`, `saveToHistory` (`nopy.main.ts:93-104`). |
| `API.md:169-175` | `cubes.Manifest` example | Omits `id`, the field that determines the cube's identity. |

### 3.5 🟡 Exported and undocumented

Public API in `src/index.ts` with no `API.md` entry: the entire history module
(`addToHistory`, `listHistory`, `getLastSession`, `getSessionById`,
`clearHistory`, `removeFromHistory`, `loadHistory`, `saveHistory`,
`getHistoryPath`, `formatHistoryList`, `HISTORY_FILE`, `DEFAULT_HISTORY_SIZE`,
plus `HistoryEntry` / `SessionHistory`), `BuildContext`,
`runSessionReplayWorkflow`, `getConfigPaths`, `findCubeDirectories`, `getCube`,
~~`filterInternalVariables`, `separateEnvAndCubeVariables`~~ — those last two were
dead on arrival (nothing called them once the session recorder stopped splitting
`env` out) and have since been deleted rather than documented. `maskCommand`,
`maskVariables`, `Variable`, `Variables`, `MASK` and the `Origin` / `Assignment`
types are newly exported and also have no `API.md` entry.

The CLI cheat-sheet (`API.md:554-578`) omits `-R`, `-H`, `-P`, `--no-history`,
and the `history` / `clear-history` commands.

`ManifestFactory` (`cubes/factories.ts:28`) is marked `@deprecated` but is not
re-exported from `cubes/index.ts`, so it is unreachable dead code.

---

## 4. Undocumented behaviour

### 4.1 🔴 Cubes in this repo cannot be loaded

`CLAUDE.md` records the `@bitsquare/nopy` linking gotcha; the package README does
not mention it at all, and the gotcha is incomplete.

Cube manifests are loaded by dynamic `import()` from their own directory
(`cubes/loader.ts:75`), so they resolve their imports through ordinary Node
resolution from `cubes/…`. Nothing in the tree provides either dependency:

```
node_modules/@bitsquare/          → absent
packages/nopy/node_modules/@bitsquare/ → absent
cubes/node_modules/               → absent
```

`@bitsquare/nopy` is the documented half. **`zod` is the other half** — 20 of 22
manifests `import { z } from 'zod'`, and that fails independently of the nopy
link. Verified by loading every manifest with a resolver hook: with only
`@bitsquare/nopy` mapped, 20 of 22 fail `ERR_MODULE_NOT_FOUND: zod`.

Because `loadCubes` turns each failure into an `errors` entry and `nopy.main.ts:147-152`
aborts when `errors.length > 0`, a fresh clone cannot run a single cube. Neither
README mentions a setup step.

### 4.2 🟠 The SSH password is printed in plaintext — **mostly fixed**

> **Points 1 and 2 resolved; point 3 stands.** `maskCommand()`
> (`nopy.executor.ts`) rewrites the SSH `--password` and every `--data` value the
> manifest declared a secret, and it is applied at all three places the command
> string is printed: the debug log, the dry-run plan, and `--print-only`. The
> name heuristic described in point 2 is gone — the manifest's `secrets` array
> says which keys are sensitive, so `TOKEN`, `PSK` and `AUTH_KEY` are covered
> too, and it no longer matters that a key merely *looks* like a password.
>
> Point 3 is unchanged and now documented instead: the value still reaches
> pyinfra on its command line, so it is visible in `ps`. That is inherent to
> pyinfra's `--data` interface, not something nopy can mask. The shell-quoting
> concern in the same point is also still open. See `docs/REFACTORING.md` item 7.

Not stated in any document, and it sits directly against the security notes at
`README.md:217` and `:325` (which are narrowly about *storage*, and are correct
as far as they go).

`buildDeployCall` embeds the password in the command string
(`cubes/dependencies.ts:112-113`):

```typescript
parts.push(`--user ${this.auth.username} --password ${this.auth.password}`);
```

That string is then:

1. logged at debug level — `log.debug(\`Command: ${commandStr}\`)`
   (`nopy.executor.ts:76`) — and the `nopy` logger is configured with
   `lowestLevel: 'debug'` (`nopy.main.ts:41-44`), so it **prints to the console
   on every deployment**;
2. printed unmasked by `--dry-run` — `outputExecutionPlan` masks values whose key
   contains "password" in the `--data` section (`nopy.executor.ts:134`) but prints
   `call.command.join(' ')` verbatim one line earlier (`nopy.executor.ts:127`);
3. passed through `execa({shell: true})` (`nopy.executor.ts:79`), making it
   visible in the process list and, without quoting, vulnerable to shell
   metacharacters in the password.

### 4.3 ✅ History and session files record only prompted values — **fixed**

> **Resolved.** `buildDeployCall` records `Variables.persistable(cubeId)` — every
> value the cube settled on, whatever its origin — so a `--use-defaults` run no
> longer records an empty object, and a replay reproduces the run rather than
> re-deriving it from whatever the defaults and `env` say at replay time. The one
> deliberate exclusion is a key the manifest declared a secret; those are prompted
> for again on replay, and a `-D` replay that would need one fails by name.
>
> The divergence noted at the end of this finding narrows but does not vanish: a
> dependency graph that resolves differently can still produce a different
> command, because `param` outranks `session` by design.

`README.md:414` says an entry records "the variable values that were answered at
the prompts" — accurate, but the consequence is not drawn out.
`buildDeployCall` records `this.variables.get(cubeId, 'prompts')`
(`cubes/dependencies.ts:138`) — the prompts scope alone. Values that came from a
dependency spec, a hook's `exec()`, `env`, or a schema default are **not** in the
entry.

Combined with §2.1 (dependency params outrank prompts) this means a replay can
legitimately produce a different command than the run it replays, if the
dependency graph resolved differently.

### 4.4 🟡 `-P, --print-only` is undocumented

Implemented (`nopy.cli.ts:61`, `nopy.main.ts:202-213`), listed in the CLI's own
help examples (`nopy.cli.ts:38`), and absent from `README.md` and `docs/API.md`.
It prints the built pyinfra commands grouped by cube and exits.

Worth documenting alongside `--dry-run`, since the difference is not obvious:
`--print-only` returns a `NopyResult` with `successful: 0` and skips execution
entirely, while `--dry-run` goes through the executor.

### 4.5 ✅ `--save-session` is ignored during a replay — **fixed**

The guard is gone: the resolved cube set is exactly what the user asked to
capture, and a session written from a replay is no less valid than one written
from a fresh run. The README's "Recording a Session" examples now include the
replay form.

Fixed alongside it, from the same field run: a `--load-session` run was excluded
from history along with `-R`/`-H`, which was right for the latter two and wrong
for the first — a session file has never been in history, so `nopy history`
reported nothing afterwards and `-R` had nothing to repeat. `WorkflowResult`
now carries `replaySource: 'file' | 'history' | undefined` instead of a boolean,
which is the distinction the boolean could not express.

The original finding follows.


`nopy.main.ts:191` guards with `saveSessionPath && !workflow.isReplay`, so
`nopy install -R -s out.json` writes nothing and says nothing. The
"Recording a Session" section (`README.md:219-227`) does not mention it.

### 4.6 🟡 `.npcubes` is documented but unused in this repo

`README.md:43` shows a `cubes/.npcubes` marker in the layout diagram and
`README.md:244` documents the mechanism. `find . -name .npcubes` returns nothing
— discovery here runs entirely off `cubeDirs` in `.nopyrc.json`. The feature
exists in `findCubeDirectories` (`cubes/loader.ts:26-30`); the diagram just shows
a file that no reader will find if they go looking.

### 4.7 🟡 `ssh:keyman` depends on a global `env` value

`cubes/ssh/keyman/deploy.py` reads `host.data.get('KEY_DIR')`, which no manifest
declares — it comes from `env` in `.nopyrc.json`. This works (§2.1: `env` is
visible for keys the schema does not define) and it is the only cube relying on
the mechanism, but nothing documents the coupling. Anyone running that cube from
a project without `KEY_DIR` in their config gets `None`.

---

## 5. Cube documentation

Two cubes have **no README at all**: `cubes/admin/hostname` and `cubes/git/clone`
(20 of 22 have one).

### 5.1 🔴 `cubes/service/autostart/README.md` documents a different cube

The file is titled **"TypeStack Install Cube"** and describes cloning a git
repository, `yarn install`, `yarn build`, `docker compose up -d`, and PM2 process
management. The manifest (`service:autostart`, "Manage systemd service
autostart") does none of that — it has three fields and calls `systemd.service`.

| README documents | In the schema? |
|---|---|
| `USER` | ❌ |
| `REPO` | ❌ |
| `ENV` | ❌ |
| `NODE_PATH` | ❌ |
| `APP` | ✅ |
| `AUTOSTART` | ✅ |
| — | `SERVICE_NAME` (undocumented) |

Every "Requirements" entry (Git, Yarn, Docker, PM2, NVM, SSH keys) is inapplicable.
It reads as a leftover from a cube that was split or renamed.

### 5.2 🟠 `cubes/network/wifi/access-point/README.md` — four wrong parameters

| README | Manifest |
|---|---|
| `NETWORK_DEVICE` (default `wlan0`) | does not exist |
| `CHANNEL` | does not exist — **but `deploy.py` reads it** (see §6.3) |
| `IP_ADDRESS` (default `192.168.50.1`) | field is `AP_IP`, default `192.168.4.1` |
| `CONNECTION_NAME` default `net:wifi:ap` | default is `pi-point` |
| SSID / PASSWORD listed as "Required" | both have defaults (`PiPoint` / `1223334444`) |

Both worked examples set keys that will be ignored.

### 5.3 🟠 Two cubes claim to have no parameters

| Cube | README says | Schema has |
|---|---|---|
| `cubes/runtime/docker` | "This cube currently has no configurable parameters." | `DISTRO` (`ubuntu` \| `debian`) |
| `cubes/runtime/nodevm` | "This cube currently has no configurable parameters." | `VERSION`, `USER`, `ALIAS`, `GLOBAL_PACKAGES` |

`nodevm`'s README also describes installing "the latest LTS via the official
NodeSource setup script", while the manifest is named "Install nvm and nodejs
with global packages" and takes an explicit `VERSION`.

(`admin/cockpit` and `armor/fail2ban` make the same claim and are correct — both
have empty schemas.)

### 5.4 🟡 Cube id conventions are inconsistent

- `cubes/caddy/base` declares `id: 'caddy'` while its sibling declares
  `caddy:spa`. Every other nested cube uses the `group:name` form.
- `net:wifi:connection` sets `name: 'network:wifi:connection - Connect to a WiFi
  network'` and `user:edit` sets `name: 'user:edit - Modify an existing user
  account'` — the id is baked into the display name. Since the picker renders
  `${cube.id} - ${cube.name}` (`nopy.prompts.ts:43`), these show as
  `net:wifi:connection - network:wifi:connection - Connect to a WiFi network`.
  `README.md:54` documents `[id]`-in-name as a *fallback* for a missing `id`
  field, not as a prefix to carry alongside one.

---

## 6. Defects found while verifying

Not documentation issues, but found while checking the docs and worth recording.

### 6.1 🔴 `cubes/service/autostart/deploy.py` cannot run

```python
from pyinfra.operations import systemd     # `server` is never imported
from pyinfra import host

APP = host.data.APP                        # AUTOSTART and SERVICE_NAME never read

if AUTOSTART:                              # NameError
    ...
    server.shell(...)                      # NameError, in the else branch
```

`AUTOSTART` and `SERVICE_NAME` are declared in the manifest and never pulled off
`host.data`; `server` is used but not imported. The script raises `NameError` on
the `if`. Per §2.2 this cube also gets no `--data` at all, so it fails twice over.

### 6.2 🔴 `-H <id>` and `--no-history` share one destination

Both options write to `options.history` (`nopy.cli.ts:57` and `:64`). Verified
with Commander:

```
argv=[]                             -> {}                        # undefined → saves
argv=["--no-history"]               -> {"history":false}         # correct
argv=["-H","abc123"]                -> {"history":"abc123"}      # correct
argv=["-H","abc123","--no-history"] -> {"history":false}         # id destroyed
```

In the last case the `-H` argument is silently discarded and nopy falls through
to a full interactive run instead of replaying. `saveToHistory: options.history
!== false` (`nopy.cli.ts:104`) works only because the two meanings happen not to
collide in the common cases.

### 6.3 🟠 `access-point/deploy.py` reads an undeclared variable

`host.data.get('CHANNEL')` — no manifest declares `CHANNEL`, so it is always
`None`. The README documents it as a supported optional parameter (§5.2). One of
the three has to give.

### 6.4 🟡 Debug output left in the shipped code

- ~~`nopy.common.ts:22` — `console.log('Assigning', artefactId, scope, values)`
  fires on every variable assignment, printing values to the console. Combined
  with §4.2 this is a second path by which secrets reach stdout.~~ **Removed**
  alongside the `--use-defaults` work; it would have made an unattended run
  unreadable. The two other paths in §4.2 are untouched.
- ~~`keyman.encrypt.ts:19-20` — `console.log(tmpKeys); console.log(sshKeys);`
  before the prompt.~~ **Removed** in Phase 2 of the keyman remediation, along
  with a third one nobody had noticed: a `console.log` *inside* a `filter`
  callback in `keyman.decrypt.ts`, printing a line per vault directory.

### 6.5 🟡 No cycle detection

Covered under §1.5. `docs/API.md:160` documents the error; there is no code that
raises it. Mutually dependent cubes recurse until the stack overflows.

### 6.6 🟠 `ssh:keygen` depends on `user:add` but shares nothing with it

`ssh:keygen` declares `dependencies: () => ['user:add']` with no parameters, so
the two cubes resolve their `USER` independently:

- `ssh:keygen` defaults `USER` to `vagrant`;
- `user:add` defaults `USER` to `` user${uniqid(5)} `` — a fresh random name.

So the dependency creates an account the dependent then ignores, and generates a
key for a `vagrant` user it never created. Passing the value through
(`[['user:add', {USER}]]`) is what the dependency spec exists for; `param`
outranks `default`, so it would take effect.

Surfaced by removing `user:add`'s `PUBKEY` default: `ssh:keygen` now fails a `-D`
run with `Cube "user:add" cannot run with --use-defaults: PUBKEY has no default
value`, naming a cube the operator did not select. The underlying mismatch is
older than that change and is not fixed here.

Related: `user:add`'s `USER` default is generated (`` user${uniqid(5)} ``), the
same shape as the `PASSWORD` default that was removed. It is recorded in the
session, so replays are stable, but each fresh `-D` run still creates a
differently-named account.

### 6.7 ✅ A declared secret was written to the session file in plaintext — **fixed**

Found in the acceptance run, not by reading. `README.md` promises that a session
holds no secret: "Passwords are never stored in session files. This covers both
the SSH password ... and any schema key a cube's manifest lists under `secrets`."
The `variables` block honoured that — `persistable()` leaves a declared secret
out entirely. The `env` block, one key higher in the same file, was a verbatim
copy of `.nopyrc.json`'s, so a credential declared there was written to the
session **and** to `.nopy.history.json` in plaintext.

Two of the fixes above widened the blast radius before it was noticed: §4.5 made
`--save-session` work on a replay, and §3.2 started recording `--load-session`
runs to history. Both write more files than before.

`Variables.persistableEnv()` applies the same rule to `env` that `persistable()`
applies to `variables`, and `nopy()` uses it instead of `config.env`. Verified in
the field: with `SSH_PASSWORD` declared under `secrets` and set in `env`, neither
the written session nor the history file contains the value.

### 6.8 ✅ `--print-only` was recorded in history — **fixed**

Also found in the acceptance run. `--dry-run` is excluded from history because it
deploys nothing; `--print-only`, which also deploys nothing, was not. Four
interactive runs against the VM produced four history entries, two of them from
`-P` passes that had only printed a command — and since `-R` repeats the head of
the list, the safe look-before-you-leap flag displaced the last real deployment
as the thing a bare `-R` would re-run.

One condition, `!printOnly`, alongside the `!dryRun` it belongs with. The
`README` list of "a run is *not* recorded when" and `docs/API.md` say so now.

### 6.9 ✅ Deploy order is the dependency tree; `CubeSelection` decides only the ties — **write-up corrected**

Found in the acceptance run, and the first write-up of it here was wrong. It
claimed a fix "has to decide what the right order even is — the order they were
picked in, or a topological one over `dependencies()`". Neither: the order is the
dependency tree, and that is already what nopy does. `resolveCube` resolves
`dependencies()` before emitting the cube itself, so emission is DFS post-order —
a topological order by construction. The recursion *is* the sort, which is what
`docs/API.md` means by "no separate topological sort", and `nopy.main.ts` walking
`selectedCubes` cannot break it: a cube listed ahead of its own dependency still
drags that dependency in first, and the second visit is deduped by `callKey`
rather than re-emitted at the tail. Pinned by *deploy order across several
selected cubes* in `tests/cubes.dependencies.test.ts`, both ways round.

This does not reopen §1.5, which stands: the *output* is a topological order but
there is no sort *algorithm*, and the price of that is still no cycle detection —
two mutually dependent cubes recurse until the stack overflows.

What list order does decide is where a cube with **no** edge lands, and that is
the whole of the real finding. `CubeSelection` returns enquirer's `selected`,
which is `choices.filter(enabled)` — display order, sorted by cube id, not the
order you ticked them. So picking `user:add` and `runtime:nodevm` yields
`['runtime:nodevm', 'user:add']`, and nothing reorders them because
`runtime:nodevm` declares `dependencies: () => []`. The acceptance run split them
into two invocations.

That missing edge is deliberate and stays missing: `user:add` *creates* a user,
so declaring it would make installing Node into an existing account silently
provision a new one. The prerequisite `SHELL=fish` really has is "fish and Oh My
Fish exist for `USER`", which no cube offers on its own — `user:add` only
provides it in passing. §5.3's `DeployError` is the answer for that, and it fires
before anything is changed. Ordering cannot fix an edge nobody can honestly
declare.

One residue, verified and left alone: an `after` hook's `exec(id)` runs after its
own cube is emitted, so it expresses "B after A" — but if B is also selected and
listed first, B is emitted first and the intent inverts. `after` hooks are not
the dependency graph and no cube in the bundle relies on this.

### 6.10 ✅ `runtime:nodevm` installed apt packages without refreshing the index — **fixed**

The same defect as §5.3 one operation earlier, and it only surfaced once §5.3 was
fixed and the cube could be run on a box where nothing else had. `apt.packages`
was called without `update`, alone among the six cubes in the bundle that install
packages. On a fresh `bento/ubuntu-24.04` the shipped index names .deb versions
the mirror has already superseded, so the fetch 404s and pyinfra reports
`executed 0 commands` before nvm is ever reached.

It passed on the first VM only because `user:add` had run there and pulled in
`apt:essentials`, which does pass `update`. Fixed with `update=True` on the call.

---

## 7. Checked and accurate

Recording what was verified and found correct, so a future pass need not redo it.

- **`README.PUBLISH.md`** — checked against `.gitea/workflows/*.yml` and both
  manifests. Workflow triggers, the `files` array, dist-tag rules, the snapshot
  version format, `upload-artifact@v3`, `cache@v4`, the `npm pack --dry-run`
  step, `retention-days: 7`, and all four coverage thresholds are right. The
  only file that states the coverage gate completely.
- **Root `README.md`** — pnpm/corepack, Node ≥ 22 with `.nvmrc` pinning 24, the
  script table, and both git hooks match the root `package.json`. Only the
  coverage line is incomplete (§2.11).
- **`CLAUDE.md`** — accurate throughout, including the `logConfigToFlags` drift
  note and the resolution/merge description. Two additions worth making: `zod` is
  missing from the cube-linking gotcha (§4.1), and `-D` being a no-op (§1.1)
  belongs under "Known drift".
- **`README.md` history section** (`:392-429`) — the recording rules, the
  fail-then-`-R` flow, replay-does-not-re-record, the four suppression cases, the
  `defaults`-layer replay semantics, and the `Cube not found` failure mode all
  check out against `nopy.history.ts`, `nopy.main.ts:195-200` and
  `cubes/dependencies.ts:62-69`.
- **`README.md` continue-on-error section** (`:369-390`) — fail-fast, no
  rollback, skipped-cubes-absent-from-results, exit code 1, and CLI-over-config
  precedence match `nopy.executor.ts:180-193` and `nopy.cli.ts:67-68`.
- **`README.md` cube layout and discovery** — the directory-pair rule, recursive
  scan, dotted/`node_modules` skipping, the prefixed `*.manifest.mjs` fallback,
  and the three-step id resolution match `cubes/loader.ts` exactly.
- **pyinfra `--data` type coercion** (`README.md:101`) — correct.
- **keyman config** — priority (`VAULT_ROOT` > file > defaults) and the four
  default values match `keyman.config.ts`. The third clause of this entry used to
  read "and the vault layout match[es] … `keyman.encrypt.ts`", which was true only
  because `encrypt.ts` hardcoded `keys` and ignored the config — checking a
  documented layout against the file that ignores the configuration is what kept
  that defect invisible here. Both are honest now: the layout is configurable and
  `encrypt` reads the configuration (`packages/keyman/docs/AUDIT.md` §1.1, §5.1).

---

## Suggested order of attack

**1 — ~~Decide on the three phantom features.~~ Two left.** §1.1 (`-D`) is
**done** — implemented, tested, and verified against every cube in `cubes/`.
That closed §2.2 and half of §2.1 with it, since neither could be left standing
under a run that never prompts. §1.2 (`--json`) is **done** — removed rather
than implemented, for the reason recorded there. §1.3 (`log.*`) is still
"documented, wired up, never read": a small implementation or a small deletion,
but it cannot stay documented as working.

**4 — Decide the `.describe()`/`.default()` ordering (§2.3).** Either read
through the `ZodDefault` wrapper in `nopy.prompts.ts`, or fix the ordering in all
14 manifests and the README example. The first is one line and cannot regress.

**5 — ~~Regenerate `docs/API.md` (§3).~~ Done.** Rewritten against the source
rather than patched, and extended to the exports that never had an entry
(variables, history, prompts, the authoring package). One new finding came out of
it: `CubePackageRef` is not re-exported from `src/index.ts` although `NopyConfig`
refers to it — a one-line fix, left for whoever next touches the export list.

**6 — Cube docs (§5) and the two missing READMEs.** `service/autostart` is the
worst — its README belongs to a different cube, and its `deploy.py` does not run
at all (§6.1).

**7 — Secrets on stdout (§4.2, §6.4).** The `console.log` in `Variables.assign`
is gone. Still open: mask the password in the executor's debug line and in the
dry-run plan, and pass `--user`/`--password` as argv rather than interpolating
into a shell string.
