# Field-report implementation plan

Turns the findings of the wild-run field report into work. Ordered by severity,
then by whether a fix unblocks a later one. Every phase is independently
shippable and ends at the existing gate (`lint:ci` → `typecheck` →
`test:coverage`).

Findings the field run confirmed that `DOCS-AUDIT.md` already tracks keep their
audit number, so the two documents stay in step: closing an item here closes it
there.

## Contents

- [0. Retractions](#0-retractions) — two findings were harness artefacts
- [1. The secret leak](#1-the-secret-leak) — `env` broadcasts a credential in the clear
- [2. Remove `--json`](#2-remove---json) — audit §1.2, closed by deletion
- [3. Replay and session correctness](#3-replay-and-session-correctness) — audit §2.4, §2.5, §4.5
- [4. The first five minutes](#4-the-first-five-minutes)
- [5. Cube defects](#5-cube-defects) — audit §5.3
- [6. Documentation sweep](#6-documentation-sweep)
- [7. Harness fix and acceptance run](#7-harness-fix-and-acceptance-run)

---

## 0. Retractions

Two findings in the field report were caused by the PTY driver I used to script
the TUI, not by nopy. The driver called `pty.fork()` and never issued
`TIOCSWINSZ`, so the child saw a **0×0 terminal**.

`enquirer`'s `utils.height` (`lib/utils.js:80-86`) computes a sane fallback and
then throws it away:

```js
let rows = (stream && stream.rows) ? stream.rows : fallback;   // fallback = 25
if (stream && typeof stream.getWindowSize === 'function') {
  rows = stream.getWindowSize()[1];                            // ← unconditional
}
```

A TTY always has `getWindowSize`, so `height` becomes `0`, and
`ArrayPrompt.limit` (`lib/types/array.js:604`) returns `Math.min(limit, 0)`.
`visible` is then empty for every array prompt.

Re-run with a 50×200 window, both work correctly:

| Field report | Actual |
| --- | --- |
| §3.6 multi-field forms never render their fields | All four fields render, accept input, and submit: `RESULT {"USER":"X","PASSWORD":"changeme","GROUPS":"","PUBKEY":""}` |
| §3.14 cube filter says "No matching choices" while matching fine | Filter renders correctly, highlights the matched substring, and returns `["user:add"]` |

**What survives, and it is worth fixing.** nopy has no defence against a
terminal that reports a degenerate size: the form silently submits `{}`, and the
run proceeds with every variable absent. That is [§4.4](#44-survive-a-terminal-that-reports-no-size)
and [§4.5](#45-never-deploy-a-cube-with-a-missing-required-variable). Field
report §3.7 (a required key dropped from the command) was reached through the
0×0 form, but the hole it exposed is real and independent: nothing on the
interactive path checks that a cube's required variables were actually filled.

Everything else in the field report stands.

---

## 1. The secret leak

Highest severity: following the documentation as written prints a credential in
plaintext, and the workaround it is prescribed for does not work either.

### 1.1 A declared secret must never be broadcast to cubes that do not declare it

**What happens.** `Variables.bucket()` (`nopy.common.ts:193-203`) seeds *every*
key of config `env` onto *every* cube as an `env`-origin assignment, and
`isSecret` (`nopy.common.ts:135-137`) is keyed per cube. So with `PASSWORD` under
`env`, a dry run prints:

```
Step 1: apt:essentials …  --data "PASSWORD=wildpass123"     ← unmasked
Step 2: user:add …        --data "PASSWORD=********"        ← masked
Step 3: runtime:nodevm …  --data "PASSWORD=wildpass123"     ← unmasked
```

**Why the obvious fix is wrong.** "Seed `env` only onto cubes whose schema
declares the key" breaks a shipped cube: `ssh/keyman/deploy.py:28` reads
`host.data.get('KEY_DIR')`, a key its manifest does not declare and that exists
only in `.nopyrc.json` `env` (`packages/nopy/.nopyrc.json:5`). Broadcast is
load-bearing.

**Fix.** Narrow the rule to secrets only — broadcast stays, secrets stop
travelling:

1. In `nopy.main.ts`, after `loadCubes()`, collect the union of every loaded
   manifest's `secrets` and hand it to `Variables`:

   ```ts
   const declaredSecrets = new Set(Object.values(cubes).flatMap((c) => c.secrets));
   const variables = new Variables(config.env, declaredSecrets);
   ```

   Deterministic and ordering-free: it is computed before the first
   `resolveCube`, so it does not depend on which cube resolves first.

2. In `bucket()`, skip seeding an `env` key that is in `declaredSecrets` unless
   the cube itself declares that key in its schema. `Variables` needs the cube's
   schema keys for this — add `declareSchema(cube, keys)`, called from
   `BuildContext.resolveCube` immediately after `declareSecrets`
   (`cubes/dependencies.ts:121`), before any assignment creates the bucket.

3. Mark globally, mask globally: a key in `declaredSecrets` is `redacted` on
   whichever cube it does land on, even if that cube's own manifest forgot to
   list it. Cheap defence against a manifest that declares `PASSWORD` in `schema`
   and omits it from `secrets`.

4. New optional `.nopyrc.json` key, for an `env` secret no manifest declares
   (an API token a hook uses, say):

   ```json
   { "secrets": ["DEPLOY_TOKEN"], "env": { "DEPLOY_TOKEN": "…" } }
   ```

   Unions into `declaredSecrets`. Validate it in `nopy.config.ts` alongside the
   other properties.

**Verify.** New test in `tests/common.test.ts`: `env` carrying a key that cube A
declares secret and cube B does not → B's `get()` does not contain the key; A's
does and is redacted. New test in `tests/executor.test.ts`: the printed plan for
B contains no occurrence of the value.

### 1.2 `env` must satisfy the `--use-defaults` gap check

**What happens.** `fillSessionGaps` (`cubes/dependencies.ts:79-89`) builds
`gaps` as `missingRequired ∪ cube.secrets` — *unconditionally* including every
secret, regardless of whether anything supplied a value. Under `-D` it throws,
and the message tells you to do the thing you have already done:

```
Error: Cube "user:add" cannot be replayed with --use-defaults: PASSWORD would
have to be entered. … set the values under "env" in .nopyrc.json.
```

The value **was** read — without `-D` the prompt came pre-filled from `env`.

**Fix.** Under `useDefaults`, a gap is satisfied when something outside the
session supplied it deliberately:

```ts
const unsatisfied = gaps.filter((key) => {
  const origin = this.variables.of(cube.id, key)?.origin;
  return origin !== 'env' && origin !== 'param';
});
if (unsatisfied.length > 0) throw new Error(…);
```

`default` is deliberately **not** accepted for a secret. On a replay the
recorded value is gone by design, so falling through to a manifest default would
deploy a different credential than the run being replayed — silently. The
message says so, instead of repeating advice that already failed:

> `Cube "user:add" cannot be replayed with --use-defaults: PASSWORD is a secret
> and secrets are never recorded in a session. Set it under "env" in
> .nopyrc.json (a schema .default() is not accepted for a secret), pass it from
> a dependency, or replay without --use-defaults.`

**Verify.** `tests/cubes.dependencies.test.ts`: `-D` replay with the secret under
`env` succeeds and the value reaches the deploy call; with only a schema
`.default()` it throws and the message names the key. Both are new cases.

### 1.3 Documentation

`README.md:291` currently prescribes exactly the leak. After 1.1 and 1.2 the
advice becomes true; add one sentence under *Secrets* stating the new rule — a
declared secret in `env` reaches only the cubes that declare it — so the
interaction between the two features is written down once, in the place a reader
of either lands.

---

## 2. Remove `--json`

Audit §1.2, independently confirmed: `nopy install -R --json > j.out` →
`json.load()` raises; stdout carries seven ANSI-coloured log lines and no JSON.
**Closed by deletion, not by implementation.**

**Why removal is the right call and not just the cheap one.** `executeDeployCalls`
runs pyinfra through execa with *inherited* stdio (`nopy.executor.ts:117`), so
during a real run nopy does not own its own stdout — pyinfra does, and writes an
unbounded amount to it. A JSON blob appended after that is not machine-readable
by any definition a caller could rely on; making it so means capturing pyinfra's
output and giving up live progress, which is a real feature traded for a
speculative one. That is the same root cause as the documented gap that
`ExecutionResult.stdout` is never populated. The CI case the flag was for is
already covered: `--print-only` for the plan and the exit code for the verdict
(`nopy.cli.ts:138-140` exits 1 on any failure). Nothing can depend on the current
behaviour, because there is no current behaviour.

### 2.1 The flag, from the `install` command

- `nopy.cli.ts:91` — drop the `.option('-j, --json', …)` line.
- `:133` — drop `jsonOutput: options.json` from the `nopy()` call.
- `:147-160` — the `if (options.json)` error branch collapses to the single
  `console.error`. This is the same statement [§4.3](#43-routine-errors-print-a-raw-node-stack-trace)
  rewrites, so whichever phase lands first does both; the other just reads it.

### 2.2 `jsonOutput`, from the library

- `NopyOptions.jsonOutput` (`nopy.main.ts:110`) and its destructure (`:141`).
  This is a **breaking change to an exported interface** — `docs/API.md:273`
  documents it. It is a `0.x` minor bump, and an unknown property is a type error
  rather than a silent behaviour change, so a consumer finds out at compile time.
- `:148` — the banner guard becomes `if (!replaySession && !loadSessionPath)`.
- `:158` — the JSON error dump goes; `log.error` on `:156-157` already reported
  the same errors.
- `:227` — the `onProgress` callback loses its guard and always logs.
- `outputExecutionPlan(calls, asJson?)` (`nopy.executor.ts:148-158`) — drop the
  parameter and the dead JSON branch. Exported and documented (`docs/API.md:588`);
  nothing in `src/` passes the second argument, only a test does.

### 2.3 stdout hygiene — the one fix that survives, and now matters more

With `--json` gone, `--print-only` is the machine-readable surface, so it has to
be clean. Two writers currently pollute it, and `jsonOutput` was the only thing
holding either back:

- `configureLogtape`'s console sink uses `console.log` (`nopy.main.ts:34`),
  against `README.md:409`, which promises stderr. Switch to `console.error`.
- `printActiveConfig` ends in `console.log` (`nopy.main.ts:95`) and is suppressed
  today only by `jsonOutput` and by replay. Same switch.

Write the rule down once, in the README: **stdout carries the deploy commands and
pyinfra's own output; everything nopy says about itself goes to stderr.** That is
a promise a test can hold to, which the old `--json` claim never was.

Ripple worth knowing before starting: `tests/main.test.ts` spies on `console.log`
(`logSpy`) throughout, so moving logtape to `console.error` means moving those
spies. Mechanical, but it touches most of the file.

### 2.4 Documentation — most of the work

| File | Change |
| --- | --- |
| `packages/nopy/README.md:537-544` | Delete the *JSON output (for CI/CD)* block. Replace with the CI recipe that works: `--print-only` for the plan, exit code `1` for the verdict, `--continue-on-error` when you want every failure in one run. |
| `packages/nopy/README.md:409` | The stderr promise stays and is now load-bearing; reword its reason from `--json` to `--print-only` and piped stdout. |
| `docs/API.md:273` | Remove the `jsonOutput` row from the `NopyOptions` table. |
| `docs/API.md:588-596` | `outputExecutionPlan(calls, asJson?)` → `outputExecutionPlan(calls)`; the note that `--dry-run --json` prints the text plan goes with it. |
| `docs/API.md:1034` | Reword the stderr note the same way as `README.md:409`. |
| `docs/API.md:1170-1173` | *Known gaps*: the `--json` entry disappears — that is the point. `ExecutionResult.stdout` is never populated **stays**, and gains the reason (stdio is inherited), since that is now the honest answer to "how do I capture output?". |
| `docs/CUBE-PACKAGES.md:317` | Future-work line proposes surfacing a cube's source "in the interactive picker and in `--json` output"; drop the second half. |
| `nopy.exit.ts:77` | Comment cites `--json` and `--print-only` as the reason for the exit discipline; leave the discipline, drop the `--json` half. |
| `DOCS-AUDIT.md:85` | Mark §1.2 closed **by removal** and say so in one line — a reader of that document should not go looking for the fix. Also touch its back-references at `:446` and `:854`. |

### 2.5 `nopy history --json` is a different flag — keep it

`nopy.cli.ts:169-177` is a second, unrelated `-j, --json`, on the `history`
command, and it works: `JSON.stringify(listHistory())`. It was never part of
audit §1.2 — the field run used it successfully. Keep it. Nothing else writes to
stdout during `history`, so it has none of the problem above, it is three lines,
and it is how a script finds the id to pass to `-H`.

If the intent is that nopy has no JSON surface at all, removing it is
`nopy.cli.ts:169` plus `:173-177`, and `README.md:541` and `:573`. Flagging it
rather than deciding it: this one is a working feature, so deleting it is a
different kind of change from deleting one that never worked.

### 2.6 Tests

Delete, rather than adapt — they assert behaviour that no longer exists:

- `tests/main.test.ts:162-168` — *emits the errors as JSON when jsonOutput is set*
- `tests/main.test.ts:224-227` — *is suppressed for JSON output* (the sibling
  `replaySession` / `loadSession` suppression cases stay and still cover `:148`)
- `tests/main.test.ts:366-373` — *stays silent on progress when jsonOutput is set*
- `tests/executor.test.ts:129` — the `outputExecutionPlan(calls, true)` case

Add one that holds the new rule: run with `printOnly` and assert `console.log`
received the command block and **nothing else** — banner and progress lines on
`console.error`. Deleting a covered branch moves coverage up, not down, so the
gate is not at risk here.

---

## 3. Replay and session correctness

### 3.1 `--save-session` no-ops on a replay (audit §4.5)

`nopy.main.ts:199` guards with `!workflow.isReplay`, so
`nopy install -R -s out.json` exits 0 and writes nothing. Drop the guard: the
resolved cube set is exactly what the user asked to capture, and a replay's
session is no less valid than a fresh run's.

### 3.2 A `--load-session` replay is not recorded

`nopy.main.ts:203` excludes every replay from history. For `-R` and `-H` that is
right and documented (`README.md:494`) — repeating must not push the original
out of the list. For `-l` it is wrong: the run is not already in history, so
after deploying from a session file `nopy history` says *"No sessions in
history"* and `-R` has nothing to repeat. That is what happened in the field run.

Record `-l` runs; keep `-R`/`-H` non-recording. `WorkflowResult` needs to
distinguish them — replace the boolean `isReplay` with
`replaySource: 'file' | 'history' | undefined`, or add a second flag. Then fix
`README.md:496-500`, whose explicit *"a run is not recorded when"* list omits
replays entirely and so contradicts `:494`.

### 3.3 The written session does not match the documented format (audit §2.4)

Documented (`README.md:224-254`, `docs/SESSION_FORMAT.md`) versus written:

| Field | Documented | Written |
| --- | --- | --- |
| `version` | `"1.0.0"` | absent |
| `name` | `"My Deployment Session"` | absent |
| `timestamp` | ISO 8601 | absent |
| `auth.method` | `"ssh-key"` | `"ssh"` |
| `auth.username` | `"root"` | absent |

This is what you consult in order to hand-write a session, which is what the
field run had to do.

Implement rather than delete — all three fields are cheap and two are useful:

- `createSession` (`nopy.session.ts:183-197`) stamps `version: '1.0.0'` and
  `timestamp: new Date().toISOString()`, and derives a default `name` the way
  `generateEntryName` already does for history (`nopy.history.ts:84-102`).
- `loadSession` (`:130-158`) keeps accepting sessions without them — every
  existing file and every hand-written one must stay loadable. Warn on a
  `version` it does not know; do not fail.
- `auth.method: 'ssh'` is real, not a bug: `runInteractiveWorkflow:64-67` uses it
  for `@vagrant/` and `@docker/` hosts, where the connector owns authentication.
  It is simply undocumented. Document the third value and when it appears.

### 3.4 `listSessions` does not match the documented filename (audit §2.5)

Docs say `.nopysession.json`; `listSessions` (`nopy.session.ts:166-175`) filters
for `.session.json` / `.session.mjs`, which `wild.nopysession.json` does not
match. Widen the filter to `.nopysession.json` / `.nopysession.mjs` and keep the
old suffixes.

---

## 4. The first five minutes

The four roughest edges a new user meets all sit before anything that works
well.

### 4.1 The documented install command 404s

`packages/nopy-cubes-core/README.md:9`, `packages/nopy/README.md:317` and `:344`
all open with:

```sh
pnpm add -D @bitsquare/nopy-cubes-core
```

```
[ERR_PNPM_FETCH_404] GET https://registry.npmjs.org/@bitsquare%2Fnopy-cubes-core: Not Found
```

The bundle has never been published to npmjs, and an *untagged* Gitea install
resolves to nothing because Gitea publishes no `latest` tag. What rescued the
field run was pnpm's own error listing `main: 0.5.0-main.17.gda84523`.

Replace both snippets with the form that works, and say why:

```sh
pnpm add -D @bitsquare/nopy-cubes-core@main \
  --@bitsquare:registry=https://gitea.bitsquare.dev/api/packages/BitSquare/npm/
```

`nopy-cubes-core`'s README does not mention Gitea at all; nopy's mentions it only
in a *Channels* section framed around installing the CLI. Both need the tag
requirement stated where the install command is, not two sections away. Revisit
when `release.yml` first ships the bundle to npmjs — the guard in that workflow
blocks the first `nopy` release until it does.

### 4.2 pyinfra is an unstated prerequisite

Nothing in the README says pyinfra must be installed separately and on `PATH`;
`nopy.executor.ts:117` spawns it directly. The field run only worked because it
happened to be there. Add a *Requirements* block next to the install command:
Node ≥ 22, `pyinfra` on `PATH` (`pipx install pyinfra`), plus whatever the chosen
connector needs (`vagrant`, `docker`). Optionally probe for it once at startup
and fail with one line instead of a spawn error.

### 4.3 Routine errors print a raw Node stack trace

`nopy.cli.ts:159` passes the error object as a third argument:

```ts
console.error('Error:', error instanceof Error ? error.message : error, error);
```

so the message prints, then the whole error prints again with frames into
`dist/`. Running outside a project — the most likely first-run mistake — yields:

```
Error: No .nopyrc.json found. Create one in your project directory or any parent directory.
    at loadConfig (…/dist/nopy.config.js:187:15)
    at Command.<anonymous> (…/dist/nopy.cli.js:74:24)
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
```

Drop the third argument; print the stack only under `NOPY_DEBUG`. Adopt keyman's
shape (`keyman.cli.ts` is the error boundary that turns a `UsageError` into one
line) so the two CLIs stay in step: a `NopyUsageError` for the errors that are
the user's to fix — no config, no cubes, missing required variable, unknown
session — and a stack for everything else.

### 4.4 Survive a terminal that reports no size

Per [§0](#0-retractions): with `stdout.rows === 0`, every enquirer array prompt
renders "No matching choices", the form submits `{}`, and nopy deploys with every
variable defaulted. Reachable outside a test harness — some CI pseudo-terminals,
`script -q`, and editor terminals during startup all report 0 rows.

Passing an explicit `limit` does **not** help (measured): enquirer clamps it with
`Math.min(limit, this.height)`. But `height` itself has an escape hatch one line
above the bug — `prompt.js:396`:

```js
get height() { return this.options.rows || utils.height(this.stdout, 25); }
```

`options.rows` short-circuits the broken function entirely, so the fix is to pass
a floored size rather than to fake a stdout:

```ts
const MIN_ROWS = 24, MIN_COLS = 80;
const terminalSize = (out = process.stdout) => ({
  rows: Math.max(out.rows || 0, MIN_ROWS),
  columns: Math.max(out.columns || 0, MIN_COLS),
});
```

Measured, 2×2:

| PTY | without | with |
| --- | --- | --- |
| 0×0 | `RESULT {}` | `RESULT {"USER":"X","PASSWORD":"changeme","GROUPS":"","PUBKEY":""}` |
| 50×200 | full result | full result (`rows` passes through as 50) |

Apply to both enquirer call sites — `CubeSelection` (`nopy.prompts.ts:61-68`) and
`VariableAssignment` (`:238-243`) — and derive `pageSize` (`:55-56`) from the same
helper, where `process.stdout.rows || 24` already fails for `0` only to be clamped
away again.

*(An earlier draft of this section proposed a `Proxy` over `process.stdout`
reporting the floor. It works — also measured — but it fakes a stream object to
reach a value the prompt will take directly. `options.rows` is the same fix
without the impersonation.)*

enquirer 2.4.1 is the last release (2023) and this is its bug. Worth a comment at
the call site so nobody "simplifies" the sizes away later.

### 4.5 Never deploy a cube with a missing required variable

Field report §3.7. `README.md:99` guarantees *"Every key defined in the manifest
`schema` is guaranteed to be present on `host.data`"*, and the interactive path
does not enforce it: `resolveCube` calls `VariableAssignment`
(`cubes/dependencies.ts:138`) and goes straight to `buildDeployCall`.
`assertVariablesComplete` exists and runs **only** under `useDefaults` (`:136`).
`buildDeployCall` then emits `--data` for whatever variables exist
(`:186-189`), so a key nothing ever assigned is absent from the command
entirely and the deploy script reads `None`.

Two ways in, both real: a form that submits nothing (§4.4), and a form the user
cancels — `VariableAssignment`'s `catch {}` (`nopy.prompts.ts:252-254`) swallows
cancellation and returns as though it succeeded.

- Call the completeness check on the interactive path too, with a message that
  fits: `Cube "user:add" is missing PUBKEY. It has no default value and nothing
  supplied one.` (The replay path already does this at
  `cubes/dependencies.ts:94-100`.)
- Distinguish cancel from error in `VariableAssignment` and route a cancel
  through `nopy.exit.ts` like the other prompts, instead of continuing with a
  half-filled cube.

**Verify.** `tests/cubes.dependencies.test.ts`: a cube with a required
no-default key, with the form stubbed to return `{}` → resolution throws and
names the key. This test fails today.

### 4.6 `self-update` prints a command that cannot work

From a project with no scope mapping in `.npmrc`:

```
Channel:   main
Registry:  https://registry.npmjs.org/
Available: unknown
Would run: npm install --global @bitsquare/nopy@main
```

`main` snapshots exist only on Gitea, and `buildSelfUpdateCommand`
(`nopy.update.ts:378-381`) deliberately omits the registry flag when the registry
*is* npmjs — correct in general, wrong for this combination. The channel is
derived from the running version, so nopy already knows the command is
unrunnable.

Detect `channel === 'main' && registry === NPMJS_REGISTRY` in the CLI action and
refuse with a line that fixes it:

> `You are running a main snapshot, which is published to Gitea only, but
> @bitsquare resolves to npmjs. Re-run with --registry <url>, or set it once:
> npm config set @bitsquare:registry <url>`

**Verify.** `tests/update.test.ts` already covers `buildSelfUpdateCommand`'s
registry logic; add the combination case.

---

## 5. Cube defects

### 5.1 `GLOBAL_PACKAGES` is accepted and then ignored

`runtime/nodevm/deploy.py:9` reads `GLOBAL_PACKAGES` off `host.data` and never
uses it; `:49` hardcodes the list. The field run passed
`GLOBAL_PACKAGES=npm-check-updates`, watched it appear in the plan and on the
command line, and found it absent from `npm ls -g`.

```python
"npm install -g pm2 yarn local-web-server node-gyp inquirer execa @dotenvx/dotenvx"
```

Fix both halves so behaviour does not change for anyone who never set the
variable — use the parameter in the deploy, and make the manifest default the
list that is hardcoded today:

```python
f"npm install -g {GLOBAL_PACKAGES}"
```

```js
GLOBAL_PACKAGES: z.string()
  .describe('Space-separated list of global npm packages to install')
  .default('pm2 yarn local-web-server node-gyp inquirer execa @dotenvx/dotenvx'),
```

The current default (`npm-check-updates`) is not what the cube installs, so
today's default is wrong in both directions.

### 5.2 `runtime/nodevm/README.md` describes a different cube (audit §5.3)

| README says | Manifest / `deploy.py` |
| --- | --- |
| "This cube currently has no configurable parameters" (`:44`) | `VERSION`, `USER`, `ALIAS`, `GLOBAL_PACKAGES`, and `SHELL` after [§5.3](#53-runtimenodevm-has-an-undeclared-shell-dependency--add-a-shell-parameter) |
| "official NodeSource setup script" (`:22`) | `nvm` — `deploy.py:34-37` |
| "Installs the latest LTS version" (`:23`) | whatever `VERSION` says, default `v22.20.0` |
| "npm@11.1.0" in the global list (`:33`) | not installed |
| "Node.js is installed system-wide" (`:80`) | per-user under `~/.nvm` for `USER` |

Rewrite against the manifest. It is the only file that would tell a reader
`VERSION` or `USER` exist. `runtime/docker/README.md` makes the same
"no configurable parameters" claim with a `DISTRO` field — same fix, same commit.

### 5.3 `runtime:nodevm` has an undeclared shell dependency — add a `SHELL` parameter

`dependencies: () => []`, but `deploy.py` runs `omf install nvm` (`:35`) and sets
`_shell_executable='/usr/bin/fish'` (`:43`) — it needs fish **and** Oh My Fish
already installed for `USER`. In the field run it worked only because `user:add`
ran first and installs both. Declaring `user:add` as a dependency would be wrong:
it would create a user that is usually meant to already exist.

**Fix.** Make the shell a parameter — `SHELL: 'fish' | 'bash'` — so the cube can
be standalone, as its manifest already claims, without taking fish away from
anyone using it today.

```js
SHELL: z
  .enum(['fish', 'bash'])
  .describe('Login shell to install through. fish needs Oh My Fish; bash needs nothing')
  .default('fish'),
```

**Default stays `fish`, deliberately.** nvm wires itself into whichever shell
installed it, so switching the default would leave an existing user — whose login
shell `user:add` set to fish — with node installed and invisible. Additive
change; the escape hatch for a fresh host is one variable.

Three places differ, and only three:

| | `fish` | `bash` |
| --- | --- | --- |
| `_shell_executable` | `/usr/bin/fish` | `/bin/bash` |
| Loading nvm | `omf install nvm` — the plugin defines `nvm` as a fish function that every login shell loads | `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"` |
| Making `npm` reachable | the plugin activates the `default` alias on load | `nvm use <ALIAS>` first |

The bash arm has one non-obvious constraint: **every entry in `commands` is its
own shell**, so sourcing `nvm.sh` and using `nvm` have to be a single entry.
Sourcing cannot be skipped either — nvm's installer appends to `~/.bashrc`, and
Ubuntu's `~/.bashrc` returns at line 1 for a non-interactive shell, so the hook
never runs under `su -c`. fish has no equivalent problem, which is presumably why
it was chosen.

That same constraint makes `set -gx NVM_DIR $HOME/.nvm` (`:38`) **dead today** —
its own shell, exported, exits. Drop it; the fish plugin sets `NVM_DIR` itself.

**Guard.** With `SHELL: 'fish'` on a host without fish, fail early and legibly
rather than inside `omf`:

```python
if SHELL == 'fish' and not host.get_fact(Which, 'fish'):
    raise DeployError(
        f'runtime:nodevm: SHELL is "fish" but fish is not installed for {USER}. '
        'Run user:add first, or set SHELL=bash.'
    )
```

Deliberately checks the binary only. Oh My Fish is a set of fish functions with
no binary to probe and no fixed path, so a check for it would be guesswork; if
fish is present and omf is not, `omf install nvm` fails with its own clear
message. Half a guard that is certain beats a whole one that is not.

**While in the file** — `deploy.py:1-6` imports `npm` and `python` and never uses
them, and assigns `hasNode = host.get_fact(Which, 'node')`, also unused. The
`Which` import stops being dead the moment the guard lands.

**Verify.** No test harness reaches a cube deploy script, so this is acceptance,
not unit: [§7.3](#7-harness-fix-and-acceptance-run) runs `runtime:nodevm` with
`SHELL=bash` on a **fresh** VM where `user:add` has not run, and confirms
`node -v` and the `GLOBAL_PACKAGES` list for `USER`. That is the case the cube has
never survived.

### 5.4 `VERSION` accepts `null` and would install `None`

`z.nullable(z.string()).default('v22.20.0')`, and `deploy.py:36` interpolates it
straight into `nvm install {VERSION}`. Either drop `nullable`, or handle `None`
as "latest LTS" — which is what the README claims the cube does anyway.

### 5.5 `user/add/README.md` — trim, do not rewrite

Every claim it makes was verified true in the field run, and its notes on *why*
`PUBKEY` has no default and *why* the generated password was removed are the best
documentation in the repo. Its last ~50 lines are generic Fish keybinding tips
(`Ctrl+L` → clear the terminal) unrelated to the cube. Move them somewhere they
belong or delete them; leave the rest alone.

---

## 6. Documentation sweep

Small, mechanical, no code.

| File | Change |
| --- | --- |
| `docs/VAGRANT.md` | Never states the `@vagrant/<name>` host syntax — the field run inferred it from an unrelated `@docker/` example. Add `"hosts": ["@vagrant/nopytestvm"]` and one line tying the VM name to it. Add `vagrant destroy -f` for cleanup. |
| `README.md` (root) | Lists a `cubes/` directory at the repo root that no longer exists (`:10`); describes `typecheck` as `tsc --build --noEmit` (`:31`), which TS rejects outright for a project with references. |
| `packages/nopy/README.md` | Top-level `--help` lists only `-V`/`-h`, then the *Examples* block uses `-R`, `-n`, `-P`, `-l`, `-s` — all of which live on `install`. Either add a "these are `install` options" line to the help text (`nopy.cli.ts:56-76`) or promote the common ones. |
| `packages/nopy/README.md` | The host picker offers `docker`, `vagrant`, `@vagrant/…`, `custom`; the first two appear in no document. Add the two connector shortcuts and what they prompt for. |
| `docs/SESSION_FORMAT.md` | Uses `.session.json` throughout while the README uses `.nopysession.json`. Pick one — `.nopysession.json` — and align both, together with [§3.4](#34-listsessions-does-not-match-the-documented-filename-audit-25). |

Also worth stating once, somewhere prominent: the accuracy failures cluster on
one seam. Everything a human reads on screen matched the docs; everything
machine-facing had drifted — `--json`, the session format, `-s` on replay, `-l`
and history, `nodevm`'s parameters, the install command. That is not random rot,
it is the interactive surface being maintained by daily use while the scripting
surface was documented from intent. Phases 2 and 3 are the correction, in the two
ways available: `--json` was documented from intent and never built, so it goes;
the rest was built and then drifted, so it gets fixed. Keeping it corrected means
what remains of the scripting surface — `--print-only`, sessions, history —
needs tests that assert on **stdout**, not prose.

---

## 7. Harness fix and acceptance run

**7.1** Fix the PTY driver before it lies again: `drive.py` and `expect.py` must
issue `TIOCSWINSZ` after `pty.fork()`.

```python
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
```

Worth keeping the drivers — they are the only way to test the TUI end to end —
so they belong in the repo under `scripts/`, not in a temp folder.

**7.2** Add a 0-rows regression test that exercises §4.4 directly: spawn the CLI
under a 0×0 PTY and assert the form still yields values. It has to be a real
child process for the same reason `cubes.resolve-hook.test.ts` does — inside a
vitest worker there is no TTY to misreport.

**7.3** Acceptance: re-run the field scenario from an empty directory —
`vagrant up`, install the bundle with the [§4.1](#41-the-documented-install-command-404s)
command, deploy `user:add` and `runtime:nodevm` **interactively** (not from a
hand-written session), then check:

- `npm ls -g` contains what `GLOBAL_PACKAGES` asked for (§5.1)
- on a **second, fresh** VM where `user:add` has *not* run, `runtime:nodevm` with
  `SHELL=bash` installs node and the global packages; with `SHELL=fish` it fails
  in one line naming the missing shell rather than inside `omf` (§5.3)
- `nopy install -P 2>/dev/null` prints the deploy commands and nothing else — no
  banner, no progress lines, no update hint (§2.3)
- `nopy install --json` is rejected as an unknown option (§2.1)
- `nopy history` lists the `-l` run (§3.2)
- a dry run with a secret under `env` prints `********` on every cube (§1.1)
- `nopy` in an unconfigured directory prints one line (§4.3)

### What the run found

Every check above passed. One deviation and three findings.

**Deviation.** The bundle was installed from `pnpm pack` tarballs of the three
packages rather than from Gitea, because the cube fixes this plan makes are not
in any published snapshot and publishing one means pushing to `main`. The install
still goes through `cubePackages` → `node_modules` → `<root>/cubes`, which is the
part §4.1 is about; what it does *not* exercise is the registry and dist-tag half
of the documented command.

Two VMs, as specified: the first got `user:add` then `runtime:nodevm` with
`SHELL=fish`, the second (destroyed and recreated, no fish, no `user:add`) got
`runtime:nodevm` alone under both shells. Driven through `scripts/expect.py`, so
the interactive path is what was exercised.

**Findings**, all recorded in `DOCS-AUDIT.md`:

- §6.8 — `--print-only` was recorded in history where `--dry-run` was not, so a
  `-P` pass displaced the last real deployment at the head of what `-R` repeats.
  Fixed.
- §6.9 — picking `user:add` and `runtime:nodevm` together resolves nodevm first.
  The first write-up blamed the ordering and was wrong: emission is already
  post-order over `dependencies()`, so a declared edge wins over list order
  whichever way round the two were listed, and a test now pins that. What list
  order decides is where a cube with *no* edge lands — and `runtime:nodevm`
  declares none, deliberately, because `user:add` creates a user. §5.3's
  `DeployError` is the guard for that pair; the acceptance run used two
  invocations.
- §6.10 — `runtime:nodevm` installed apt packages without refreshing the index,
  which only surfaced once §5.3 let the cube run on a box where `apt:essentials`
  had not. Fixed.

---

## Suggested order

1. **Phase 1** — the leak. Security, and the fix is contained.
2. **Phase 4.3–4.5** — the error boundary, the terminal proxy, and the
   completeness check. Small, and they stop a silently wrong deployment.
3. **Phase 2** — remove `--json`. Mostly deletion, and it settles what the
   scripting surface *is* before phase 6 documents it.
4. **Phase 6 + 4.1 + 4.2** — documentation. No code, immediate payoff for the
   next new user.
5. **Phase 5** — cubes. Independent of everything above; ships with the bundle,
   not the CLI.
6. **Phase 3** — session and replay. Largest surface, lowest severity.
7. **Phase 7** — harness and acceptance, last, so it exercises all of it.
