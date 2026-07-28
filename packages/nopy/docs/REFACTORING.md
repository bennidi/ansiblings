# Nopy Refactoring Plan

This document tracks the major refactoring of the `nopy` package.

## Refactoring Items

### 1. Remove parallel execution
- **Status**: ✅ Completed
- **Goal**: Remove all logic supporting parallel execution of cubes to simplify the execution flow and improve reliability.
- **Rationale**: The feature never shipped. Concurrent pyinfra processes interleave their output, which made deployment logs unreadable — a cost that outweighed the wall-clock saving. Do not reintroduce it without first solving per-cube output buffering.
- **Context**:
    - Parallelism removed from `NopyConfig`, `NopyOptions`, and `executeDeployCalls`.
    - `buildExecutionStages` deleted.
    - CLI flags `--parallel` and `--concurrency` removed.
    - Documentation caught up later: `README.md`, `docs/API.md`, and `docs/HOOKS.md` had all continued to describe the feature as if it existed.
- **Proposed Solution**: (Done)

### 2. Rework cube building process & Dependency Resolution
- **Status**: ✅ Completed
- **Goal**: Allow dependencies to be defined as a function of the collected variables.
- **New Signature**: `dependencies?: (variables: CubeVariables) => DependencySpec[]`
- **Architectural Change**: Implement a clean, step-based resolution mechanism using a `BuildContext`.
- **Context**:
    - Introduced `BuildContext` in `cubes/dependencies.ts` which handles recursive resolution, variable collection, and hook execution.
    - Resolution is now dynamic: variables are collected for a cube before its dependencies are resolved.
- **Proposed Solution**: (Done)

### 3. Remove `env` property from cube Manifest
- **Status**: ✅ Completed
- **Goal**: Remove the `env` property from the cube manifest.
- **Context**:
    - `env` removed from `Manifest` and `Env` types.
    - Responsibility for defaults shifted entirely to Zod schema defaults and `getDefaults()`.
- **Proposed Solution**: (Done)

### 4. Redesign Manifest and Cube types
- **Status**: ✅ Completed
- **Goal**: Transition from `Env -> Manifest -> Cube` inheritance to a cleaner `Manifest` (specification) and `Cube` (runtime) separation.
- **Context**:
    - `Manifest` is now a clean interface with a factory namespace.
    - `Cube` is a class encapsulating a `Manifest` and runtime info (`dir`, `deployScript`).
- **Proposed Solution**: (Done)

### 5. Make `--use-defaults` operational
- **Status**: ✅ Completed
- **Goal**: Turn `-D` from a flag that was parsed and threaded through three layers but never read into a working non-interactive mode.
- **Rationale**: Unattended runs — CI, or provisioning a fresh box from a checked-in `.nopyrc.json` — are the reason the flag exists. It prompted anyway.
- **Context**:
    - `BuildContext.resolveCube` branches on `options.useDefaults` and skips `VariableAssignment`.
    - `Variables.get()` merge order corrected to defaults → global `env` → prompts → params. `env` used to lose to the schema default, which left a non-interactive run with no way to be configured at all.
    - Replayed session values moved from the `defaults` scope to `prompts`, so they keep outranking `env` now that `env` sits higher.
    - `Cube.getDefaults()` no longer discards every default when one field lacks `.default()`; it falls back to a per-field read.
    - `Cube.requiredKeys()` added, and a `-D` run fails naming the unfillable variables instead of deploying a cube with them absent from `--data`.
    - `VariableAssignment` offers every schema key, not only the ones carrying a default, and shows the value the run would actually use as the initial.
- **Proposed Solution**: (Done)


### 6. Make variable assignment a first-class concept
- **Status**: ✅ Completed
- **Goal**: Give a variable an identity and a provenance, instead of inferring both from which bag it happened to sit in.
- **Rationale**: Item 5 left precedence encoded as the field order of an object literal inside `Variables.get()` — `defaults`, then `global`, then `prompts`, then `params`. Nothing named the ranking, nothing could be asked where a value came from, and a replay had to be smuggled into the `prompts` bag because there was no origin that meant "recorded". Every question that followed — what should a session record, which values are safe to print — needed provenance to answer.
- **Context**:
    - `Assignment { value, origin }` and an `Origin` ranked `default(0) < env(1) < session(2) < prompt(3) < param(4)`. Precedence is now data, not the order lines appear in.
    - `Variable` is a class over an assignment list. `assignments` is the true history, newest first and never reordered; `ordered` is a *stable* sort of it by origin rank, and `value`/`origin` read the head of that. Stability is what makes the two views coexist: same-origin ties keep the newest in front while the value it displaced stays visible.
    - The `global` bag is gone. Config `env` is seeded per cube as a real assignment at origin `env`, so `variables.get('global')` — a cube id that was never a cube — is no longer a thing.
    - Replay assigns at origin `session`, which outranks `env` and `default` on its own. The `prompts`-bag workaround is deleted.
    - A session records `Variables.persistable()` — every effective value, not just prompted ones. A `-D` run used to record nothing and replay by re-deriving from whatever the defaults said at replay time.
- **Trade-off accepted**: recorded values now outrank the current `.nopyrc.json` `env` and the current schema defaults, so editing either no longer leaks into an existing session's replay. That is the point of a snapshot, but it does mean picking up a new default requires re-recording.
- **Proposed Solution**: (Done)

### 7. Manifest-declared secrets
- **Status**: ✅ Completed
- **Goal**: Let a manifest say which schema keys hold sensitive values, and act on it.
- **Rationale**: Item 6 made sessions record everything, which forced the question of what must *not* be recorded. The codebase already had an answer of sorts — `outputExecutionPlan` masked any variable whose name contained "password" — that missed `TOKEN`, `PSK` and `AUTH_KEY`, and was defeated anyway by the unmasked command printed one line above it.
- **Context**:
    - `Manifest.secrets?: string[]`, validated at load: an entry that is not a key of `schema` is a manifest error and aborts the run, so a typo cannot silently leave a value unprotected.
    - Deliberately a plain array, not zod metadata. `.meta()` and `.describe()` store into `z.globalRegistry`, which is per-copy — a manifest built by a different zod copy would look up empty. Fail-open is fine for a missing prompt label and unacceptable for a secret marker.
    - `maskCommand()` replaces declared `--data` values and the SSH `--password` in the command string itself, and is wired into `--print-only`, the dry-run plan and the debug log. The `nopy` logger runs at `lowestLevel: 'debug'`, so that last one was printing credentials on every run.
    - Secrets are excluded from `persistable()`, so a replay has a gap where one used to be. `fillSessionGaps` prompts for `requiredKeys() ∪ secrets`; under `-D` it fails naming them, consistent with item 5's fail-fast.
- **Scope limit**: `secrets` keeps a value out of what nopy writes. The value is still on pyinfra's command line (visible in `ps`), still echoed by the variable form, and a `.default()` is still plain text in the manifest. Documented rather than fixed — the first is inherent to pyinfra's interface.
- **Bug fixed along the way**: `cubes/user/add` generated a random password as its schema `.default()`. Because the key had a default it was never in `requiredKeys()`, and because a generated default is re-evaluated on every read, an unattended run created an account with a credential nobody had seen and a replay created a different one again. It is now the literal `changeme`.
- **Proposed Solution**: (Done)
