# Nopy

A CLI tool that simplifies **pyinfra** script management and execution, providing an interactive workflow for deploying infrastructure configurations ("cubes") to remote hosts.

## Overview

Nopy wraps pyinfra with structure, validation, and an interactive experience for managing complex infrastructure deployments. It organizes deployments into self-contained "cubes" with dependency management, schema validation, and lifecycle hooks.

## Features

- **Dependency resolution** with topological sorting
- **Before/after hooks** for multi-cube orchestration
- **SSH key or password authentication**
- **Default values** with optional customization via manifest `env`
- **Schema validation** using Zod
- **Recursive cube directory discovery**
- **Dry-run mode** for previewing deployments
- **JSON output** for CI/CD integration
- **Session history** with replay capability

## Workflow

1. **Load cubes** - Discovers and validates cubes from configured directories
2. **Interactive prompts** - Select cubes, target host, and authentication method
3. **Dependency resolution** - Topologically sorts cubes based on dependencies
4. **Variable assignment** - Validates and collects configuration with schema validation
5. **Execute hooks** - Runs before/after hooks for orchestration
6. **Deploy** - Sequentially executes pyinfra commands

## Core Concepts

### Cubes

A cube is a **directory** containing two files:

- **JavaScript manifest**: `manifest.mjs` defining schema, dependencies, defaults, secrets, and hooks
- **Python deployment script**: `deploy.py`, a plain pyinfra script

Configuration variables are declared in the manifest and validated with Zod schemas before the deployment script runs.

```
cubes/
├── .npcubes
└── apt/
    └── install/
        ├── manifest.mjs
        └── deploy.py
```

Any directory holding both files is treated as a cube, so cubes can be nested as deeply as you like to group them by topic. Discovery is recursive; directories starting with `.` and `node_modules` are skipped. Additional files in the cube directory (a `README.md`, config templates, and so on) are ignored by the loader and can be referenced from the deploy script — the script runs with its cube directory as the working directory.

The prefixed forms `<cube-name>.manifest.mjs` and `<cube-name>.deploy.py` are also still recognized, but plain `manifest.mjs` / `deploy.py` is the current convention.

A cube's identity comes from the manifest's `id` field (see below). If `id` is omitted, nopy falls back to an `[id]` prefix in the manifest `name`, and finally to the directory's own name. Note that the id does not have to mirror the folder path — `cubes/network/tailscale` declares `id: 'net:tailscale'`.

#### Cube Manifest

```javascript
import { z } from 'zod'
import { cubes } from '@bitsquare/nopy'

export default cubes.Manifest({
    id: 'apt:install',
    name: 'Install packages with apt',
    dependencies: () => [],
    schema: z.object({
        UPDATE: z.boolean().describe('Update package cache').default(false),
        PACKAGES: z.string().describe('Space-separated list of packages').default('vim htop'),
    })
})
```

#### Deployment Script

The matching `deploy.py` is a plain pyinfra script. Nopy passes each schema variable to pyinfra as `--data KEY=value`, so they are available on `host.data`:

```python
from pyinfra import host
from pyinfra.operations import apt

UPDATE = host.data.UPDATE
PACKAGES = str(host.data.PACKAGES).split(' ')

apt.packages(
    name='Install essential packages',
    packages=['ca-certificates', 'gnupg', 'lsb-release'],
    update=UPDATE,
    _sudo=True,
)

apt.packages(
    name='Install custom packages',
    packages=[p.strip() for p in PACKAGES if p],
    update=UPDATE,
    _sudo=True,
)
```

Every key defined in the manifest `schema` is guaranteed to be present on `host.data` — either from the Zod `.default()`, from `.nopyrc.json`, from a recorded session, from a dependency, or from a user prompt.

**Value types**: pyinfra parses `--data` values before your script sees them. `"true"` / `"false"` become booleans, numeric strings become `int`, valid JSON becomes the parsed structure, and everything else stays a string. This is why `UPDATE` can be handed straight to pyinfra's `update=` argument, while `PACKAGES` is wrapped in `str(...)` before splitting.

#### Variable Defaults

Variable defaults are defined directly in the Zod schema using `.default()`. This ensures that every cube has a predictable starting state and provides type-safe default values.

A variable can be set from several places in one run. Every assignment is kept, tagged with where it came from — its **origin** — and the highest-ranked origin wins.

**Origins, lowest to highest:**

| Origin | Set by |
| --------- | ------------------------------------------------------- |
| `default` | the Zod schema's `.default()` |
| `env` | the `env` block of `.nopyrc.json` |
| `session` | a value recorded in a session file or history entry |
| `prompt` | what the user typed |
| `param` | a dependency spec or a `before`/`after` hook |

This allows cubes to ship with reasonable defaults while still allowing users to override them globally via `.nopyrc.json` or interactively during deployment. Because `env` outranks the schema, `.nopyrc.json` is also what steers a run started with `--use-defaults`, which never prompts.

`prompt` and `param` rarely compete: a key a dependency supplies is left out of the prompt entirely, so the user is only ever asked about the keys nothing else has set.

Ranking by origin rather than by arrival order is what makes replay work: a recorded value is applied *before* the cube would be prompted for, and prompting can still override it, but a `--data` value pushed in by a dependency is never clobbered by a stale recording.

A field declared without `.default()` has no `default` origin to fall back on. It is prompted for like any other, with an empty initial value — but a run that cannot prompt (`--use-defaults`) fails on it unless `env` or a dependency provides it.

#### Secrets

A manifest can name schema keys that hold sensitive values:

```javascript
export default cubes.Manifest({
    id: 'user:add',
    name: 'Add a user account',
    secrets: ['PASSWORD'],
    schema: z.object({
        USERNAME: z.string().describe('Username for the new account').default('deploy'),
        PASSWORD: z.string().describe('Password for the new user account').default('changeme'),
    })
})
```

Every entry must be a key of `schema`; naming anything else is a manifest error and aborts the run, so a typo fails loudly instead of silently leaving a value unprotected.

Declaring a key a secret changes three things:

- **It is never written to a session file or to the history.** Everything else the run settled on is recorded — including values that came from a `.default()` — but declared secrets are left out.
- **It is masked wherever a command or a plan is printed** — `--dry-run`, `--print-only`, and the debug log all show `********` in place of the value, in the variable list *and* in the `pyinfra` command line above it. The SSH password passed via `--password` is masked the same way, whether or not any cube declares secrets.
- **It is re-prompted on replay**, since there is nothing recorded to replay from (see [Session Recording and Replay](#session-recording-and-replay)).

Nopy does not guess. A key called `PASSWORD` in a manifest that declares no `secrets` is treated as an ordinary variable — recorded, and printed in the clear.

Three limits are worth knowing, because `secrets` keeps a value out of the files nopy writes and nothing more:

- **It is on the command line.** pyinfra takes its data as `--data KEY=value`, so the real value is visible in `ps` for as long as the deployment runs. Masking covers nopy's own output, not the process table.
- **The prompt shows it.** The variable form displays and pre-fills what it is asking about, so a secret is on screen while it is being entered or confirmed.
- **A `.default()` is not protected.** A default lives in the manifest, in plain text, wherever the manifest is checked in. Give a secret a placeholder default like `changeme` if it needs one at all, never a real credential.

### Configuration

Uses `.nopyrc.json` files (project-level or home directory) containing:

```json
{
  "hosts": ["host1.example.com", "host2.example.com"],
  "cubeDirs": ["./cubes", "../shared-cubes"],
  "cubePackages": ["@bitsquare/cubes-core"],
  "env": {
    "SHARED_VAR": "value"
  },
  "log": {
    "verbosity": "info",
    "debug": false
  },
  "history": {
    "maxSessions": 10,
    "autoSave": true
  },
  "execution": {
    "continueOnError": false
  }
}
```

`history` controls automatic session recording (see [Deployment History](#deployment-history)), and `execution.continueOnError` sets the default for `--continue-on-error`.

`cubeDirs` holds paths, `cubePackages` holds installed npm packages that ship cubes — see [Cube Discovery](#cube-discovery) below and [CUBE-BUNDLES.md](docs/CUBE-BUNDLES.md) for publishing your own. Both are additive, and both resolve relative to the config file that named them, not to the working directory: a `.nopyrc.json` two levels up may name a package that only exists in *its* `node_modules`.

#### Logging Configuration

Control pyinfra output verbosity and debug information using the `log` configuration object:

**`log.verbosity`** - Controls the level of information printed during execution:

| Verbosity | PyInfra Flag | Description | Use Case |
|-----------|--------------|-------------|----------|
| `"silent"` | (none) | Minimal output (default) | Production deployments, clean output |
| `"info"` | `-v` | Print meta information | See what operations are running |
| `"verbose"` | `-vv` | Include input data | Debug parameters and configuration |
| `"trace"` | `-vvv` | Full command output | See all command outputs and details |

**`log.debug`** - Enables pyinfra's internal debug logging:

| Value | PyInfra Flag | Description | Use Case |
|-------|--------------|-------------|----------|
| `false` | (none) | No debug logs (default) | Normal operation |
| `true` | `--debug` | Enable pyinfra debug logs | Deep debugging of pyinfra internals |

**Recommendation:** Start with `"info"` for typical troubleshooting, use `"trace"` when investigating command failures, and enable `debug: true` only when debugging pyinfra itself.

### Session Recording and Replay

Nopy supports recording deployment sessions to JSON files for later replay. This is useful for:

- Repeatable deployments
- CI/CD pipelines
- Documentation and auditing
- Sharing configurations across teams

#### Session File Format

Sessions are stored in `.nopysession.json` files with the following structure:

```json
{
  "version": "1.0.0",
  "name": "My Deployment Session",
  "timestamp": "2025-10-13T10:30:00Z",
  "cubes": [
    {
      "key": "apt:essentials",
      "variables": {
        "UPDATE": true
      }
    },
    {
      "key": "apt-more",
      "variables": {
        "SOME_VAR": "value"
      }
    }
  ],
  "hosts": [
    "@docker/nopy-test-container"
  ],
  "env": {
    "KEY_DIR": "../../vault/tmp"
  },
  "auth": {
    "method": "ssh-key",
    "username": "root"
  }
}
```

**Structure Details:**

- **`cubes`**: Array of cubes with the variable values that cube ran with
- **`env`**: The `env` block of `.nopyrc.json` as it stood at record time, kept for reference
- **`hosts`**: Array of target hosts
- **`auth`**: Authentication configuration (passwords are never stored)

**What is recorded:** every value each cube settled on, regardless of where it came from — a value the user typed, one inherited from `.nopyrc.json` `env`, one a dependency supplied, and one that fell through to the schema's `.default()` are all written out the same way. A session is therefore a full snapshot rather than a diff, and a `--use-defaults` run produces a session with real values in it instead of an empty one.

The consequence is that replay is faithful rather than re-derived: the recorded value outranks the current `.nopyrc.json` `env` and the current schema default, so editing either one does not silently change what a replay does. To pick up a new default, record a fresh session.

**Security Note**: Passwords are never stored in session files. This covers both the SSH password — a session records the auth *method* and username, never the credential — and any schema key a cube's manifest lists under [`secrets`](#secrets). Both are re-prompted on replay.

#### Recording a Session

```bash
# Run deployment interactively and save the session
nopy install --save-session my-deployment.nopysession.json

# With defaults (no prompts for variables)
nopy install -D --save-session automated-deployment.nopysession.json
```

#### Replaying a Session

```bash
# Load and execute a saved session
nopy install --load-session my-deployment.nopysession.json

# Session replay uses the exact cubes, variables, and hosts from the file
# Only password authentication will prompt for credentials
```

A replay runs straight through without asking anything, with three exceptions. Password authentication always re-prompts. A session with no recorded host falls back to the host picker. And a cube is re-prompted for its declared secrets, plus for any required variable the session has no value for — which happens when the cube's schema has gained a field since the session was written.

Those re-prompts are what a session cannot supply, so `--use-defaults` cannot paper over them: combining `-D` with a replay that needs either fails with a message naming the keys rather than deploying with a placeholder. Put the values under `env` in `.nopyrc.json` to make such a replay unattended.

### Cube Discovery

Nopy searches for cubes in:

1. Directories specified in `.nopyrc.json` `cubeDirs`
2. Cube directories of every package listed in `.nopyrc.json` `cubePackages`
3. Directories containing a `.npcubes` marker file (searching upwards from current directory)

All three are unioned and scanned the same way. A directory is a cube when it holds both a manifest (`manifest.mjs` or `*.manifest.mjs`) and a deploy script (`deploy.py` or `*.deploy.py`); dotted directories and `node_modules` are skipped during the scan.

#### Cube packages

A cube package is an ordinary npm package that ships its cubes in a `cubes/` directory at its root. That is the whole contract — no nopy-specific `package.json` field is required. A bundle whose cubes live elsewhere (compiled into `dist/cubes`, say) overrides the location:

```json
{
  "name": "@acme/cubes-web",
  "nopy": { "cubes": ["./dist/cubes"] }
}
```

Install it and name it — nothing needs linking or copying:

```sh
pnpm add -D @bitsquare/cubes-core
```

```json
{ "cubePackages": ["@bitsquare/cubes-core"] }
```

Naming a package is a statement that cubes are expected from it, so anything wrong is an error that aborts the run rather than a silent skip: the package is not installed, it has neither a `cubes/` directory nor a `nopy.cubes` override, its `nopy.cubes` is malformed, or an entry points at a directory that does not exist or lies outside the package.

#### Ids are claimed globally

A cube id such as `apt:essentials` is claimed across every source at once, not per directory or per package. Two cubes with the same id abort the run with an error naming both and where each came from. There is no precedence rule and no shadowing — a local cube does not quietly win over a packaged one, in either direction. Prefix your own cubes distinctly if you point `cubeDirs` at a local tree alongside an installed bundle.

Writing cubes to publish is covered in [CUBE-BUNDLES.md](docs/CUBE-BUNDLES.md).

## Command Line Usage

### Installation

```bash
npm install -g @bitsquare/nopy
```

The cubes live in a separate bundle, installed into whichever project describes
your infrastructure and named in its `.nopyrc.json`:

```bash
pnpm add -D @bitsquare/cubes-core
```

```json
{ "hosts": ["your-host"], "cubePackages": ["@bitsquare/cubes-core"] }
```

#### Channels

Three dist-tags are published, and the one you install from is the one you stay
on until you ask otherwise:

| Channel  | What it is                                | Registry     |
| -------- | ----------------------------------------- | ------------ |
| `latest` | the current release — the default         | npmjs, Gitea |
| `next`   | a prerelease (`0.6.0-rc.1`)               | npmjs, Gitea |
| `main`   | a snapshot of every commit on `main`      | Gitea only   |

```bash
npm install -g @bitsquare/nopy          # latest
npm install -g @bitsquare/nopy@next     # prereleases
```

Snapshots come from the Gitea registry. Point the **scope** at it rather than
setting a bare `registry=`, because that registry serves `@bitsquare` packages
only and does not proxy npmjs — everything else must keep resolving from npmjs:

```bash
npm install -g @bitsquare/nopy@main \
  --@bitsquare:registry=https://gitea.bitsquare.dev/api/packages/BitSquare/npm/
```

Or, persistently, in `~/.npmrc`:

```ini
@bitsquare:registry=https://gitea.bitsquare.dev/api/packages/BitSquare/npm/
```

Reading from Gitea needs no token while the repository is public.

### Upgrading

```bash
nopy self-update
```

That checks the channel your installed version came from, on the registry your
npm config points at, and re-runs the package manager that installed you (npm,
pnpm, yarn or bun — detected from the install path). Options:

```bash
nopy self-update --dry-run          # print the command, change nothing
nopy self-update --force            # reinstall even when up to date
nopy self-update --channel next     # switch channel
nopy self-update --registry <url>   # check somewhere else
```

The plain package-manager equivalent works too. Prefer `@latest` over
`npm update -g`, which resolves against the range recorded at install time:

```bash
npm install -g @bitsquare/nopy@latest
```

Once a day, `nopy` checks its channel in the background and prints a one-line
hint to **stderr** when a newer version exists — never to stdout, so `--json`
and `--print-only` output stay clean. The answer is cached in
`~/.nopy/update-check.json`; a registry that is slow or unreachable is given
1.5 seconds and then ignored.

| Variable                | Effect                                        |
| ----------------------- | --------------------------------------------- |
| `NOPY_NO_UPDATE_CHECK=1`| disable the startup check (also off when `CI` is set) |
| `NOPY_REGISTRY`         | check a specific registry                     |
| `NOPY_REGISTRY_TOKEN`   | bearer token, for a private registry          |
| `NOPY_PACKAGE_MANAGER`  | force `npm`/`pnpm`/`yarn`/`bun` for the install |

### Running from a checkout

```bash
pnpm install
pnpm --filter @bitsquare/nopy run nopy     # runs the CLI from source via tsx
```

### Basic Commands

**Install cubes (default command)**:

```bash
nopy install
# or simply
nopy
```

**Install with defaults (no prompts for customization)**:

```bash
nopy install --use-defaults
# or
nopy install -D
```

Skips the per-cube variable form. Every variable is taken from the sources that
need no interaction — the Zod `.default()`, `env` in `.nopyrc.json`, and values
handed over by a dependency or a hook — which is what makes `.nopyrc.json` the
place to configure an unattended run.

Cube selection, host and authentication are still asked for; there is nowhere
else for them to come from. Pair `-D` with `-K` to skip the auth question too,
or with `-R` / `-H` / `-l`, which supply all three from the recorded session.

A cube whose schema declares a field with **no** `.default()` cannot be filled in
this way, so the run stops before anything is deployed rather than passing the
variable as empty:

```
Error: Cube "net:wifi:connection" cannot run with --use-defaults: SSID, PASSWORD
have no default values. Set them under "env" in .nopyrc.json, pass them from a
dependency, or drop --use-defaults to be prompted.
```

Pairing `-D` with a replay fails the same way when the replay would have to ask
something — a declared [secret](#secrets), which is never recorded, or a required
variable the session has no value for. Both are the sources `-D` has no substitute
for, so it stops rather than deploying a placeholder:

```
Error: Cube "user:add" cannot be replayed with --use-defaults: PASSWORD would
have to be entered. Secrets are never recorded in a session. Replay without
--use-defaults, or set the values under "env" in .nopyrc.json.
```

**Use SSH key authentication**:

```bash
nopy install --auth-method-key
# or
nopy install -K
```

**Repeat last run**:

```bash
nopy install --repeat-last
# or
nopy install -R
```

Every deployment is automatically recorded to a `.nopy.history.json` file in the current working directory, so the last run is always available to `-R` without having to pass `--save-session` first. The default retention is the 10 most recent sessions (configurable via `history.maxSessions`); use `nopy history` to list them and `nopy install -H <id>` to replay any one of them — see [Deployment History](#deployment-history).

The recording happens before the deploy commands run, so a **failed** deployment is recorded too — `-R` is the quick way to retry one after fixing the cause. Replaying a session with `-R` or `-H` does not itself create a new entry, so repeating never pushes the original run out of the list.

A run is *not* recorded when:

- `--dry-run` or `--no-history` is passed
- No cubes were selected, so there was nothing to deploy
- `history.autoSave` is set to `false` in `.nopyrc.json`

Because the history file is resolved against the current working directory, each project keeps its own history — running nopy from a different directory will not find the previous run. As with session files, passwords are never stored and are re-prompted on replay.

**Save session for replay**:

```bash
nopy install --save-session my-deployment.nopysession.json
# or
nopy install -s my-deployment.nopysession.json
```

**Load and replay session**:

```bash
nopy install --load-session my-deployment.nopysession.json
# or
nopy install -l my-deployment.nopysession.json
```

**Combined options**:

```bash
nopy install -D -K  # Use defaults + SSH key auth
nopy install -D -s session.nopysession.json  # Use defaults and save session
```

### Advanced Options

**Dry run (preview without executing)**:

```bash
nopy install --dry-run
```

Shows the execution plan including commands, environment variables, and targets without running anything. Sensitive data is masked in output.

**JSON output (for CI/CD)**:

```bash
nopy install --json
nopy history --json
```

Machine-readable JSON output for scripting and CI/CD integration.

**Continue on error**:

```bash
nopy install --continue-on-error
# or
nopy install -c
```

Continue deploying remaining cubes even if one fails.

**Default behaviour (fail-fast)**: without this flag, nopy stops at the first cube that fails. Cubes are deployed sequentially in dependency order, so the failing cube's output is the last thing you see — every cube still queued behind it is skipped entirely and is never attempted.

This is deliberate: because cubes are topologically sorted, a cube that fails is often a dependency of the ones after it, and continuing would deploy them onto a half-configured host.

Two consequences worth knowing:

- **Cubes that already succeeded are not rolled back.** The host is left in a partial state — the cubes before the failure are applied, the rest are not. Fix the cause and re-run; well-written cubes are idempotent, so re-applying the earlier ones is normally harmless.
- **Skipped cubes are not reported as failed.** They are simply absent from the results, so a summary of "3 successful, 1 failed" out of 6 cubes means the remaining 2 were never run.

Either way, the command exits with code `1` if any cube failed, which is what CI picks up. Use `--continue-on-error` when your cubes are genuinely independent and you would rather collect every failure in one run than stop at the first.

The default can be flipped for a project by setting `execution.continueOnError` in `.nopyrc.json`; the CLI flag takes precedence over it.

#### Deployment History

```bash
nopy history              # List recent deployments
nopy history --json       # Same list as JSON, including each recorded session
nopy install -H <id>      # Replay a specific deployment by ID
nopy clear-history        # Delete all recorded sessions
```

History is what makes [Repeat last run](#basic-commands) work, but it holds more than just the last deployment: every recorded run stays replayable until newer runs push it out. `nopy history` (alias `nopy h`) lists them newest first, with `→` marking the entry that `-R` would replay:

```
Session History:

  → [1] 07/26/2026, 14:32 - apt:install, net:tailscale → root@web-01
       ID: mdk3n1qx4a2fh
    [2] 07/26/2026, 09:05 - apt:install → root@web-01
       ID: mdk0zzp8b71cq

Total: 2 session(s)
```

Each entry records the selected cubes together with every variable value they ran with, the target hosts, the authentication method, and the username — never the password, and never a key the manifest declared a [secret](#secrets). Pass an ID to `-H` to run that exact combination again:

```bash
nopy install -H mdk0zzp8b71cq
```

A replay is non-interactive: cube selection, host, and variable values all come from the entry, so nopy runs straight through without asking anything. It asks only for what the entry cannot hold — the password under password authentication, and any declared secret — plus the host picker when the entry recorded none.

Two things are worth knowing before relying on an older entry:

- **Recorded values win over the current configuration.** The entry is a snapshot of everything the run settled on, so editing a cube's `.default()` or the `env` block of `.nopyrc.json` afterwards does not change what the replay does. A variable the schema has gained *since* the entry was written has nothing recorded: if it has a `.default()` the replay quietly takes it, and if it is required the replay prompts for it.
- **A replay fails if a cube no longer exists.** Renaming or deleting a cube id makes every history entry that referenced it unreplayable: nopy logs `Cube from session not found` and then aborts with `Cube not found: <id>`.

The history lives in `.nopy.history.json` in the working directory and uses the same structure as a session file, so trimming the array by hand is a perfectly good way to prune it. It does contain the variable values a run used, which is why it is listed in this repository's `.gitignore` — treat it like any other file holding deployment configuration. A corrupt or unreadable history file is treated as empty rather than raising an error, which looks exactly like a project that has never been deployed from.

For a run you want to keep indefinitely, don't rely on history — it rotates. Use `--save-session` to write it to a file you control (see [Session Recording and Replay](#session-recording-and-replay)).

### Development

**Run without building**:

```bash
npm run nopy
```

**Debug**:

```bash
npm run debug
```

## Documentation

- [Cube Hooks](docs/HOOKS.md) - Lifecycle hooks for dynamic orchestration
- [Cube Bundles](docs/CUBE-BUNDLES.md) - Distributing cubes as npm packages
- [Session Format](docs/SESSION_FORMAT.md) - Internal JSON/MJS session structure
- [API Reference](docs/API.md) - Types and exported functions

## Resources

- [Pyinfra Documentation](https://docs.pyinfra.com/en/3.x/arguments.html)
