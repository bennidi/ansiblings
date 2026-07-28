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

- **JavaScript manifest**: `manifest.mjs` defining schema, dependencies, defaults, and hooks
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

Every key defined in the manifest `schema` is guaranteed to be present on `host.data` — either from the Zod `.default()`, from `.nopyrc.json`, from a dependency, or from a user prompt.

**Value types**: pyinfra parses `--data` values before your script sees them. `"true"` / `"false"` become booleans, numeric strings become `int`, valid JSON becomes the parsed structure, and everything else stays a string. This is why `UPDATE` can be handed straight to pyinfra's `update=` argument, while `PACKAGES` is wrapped in `str(...)` before splitting.

#### Variable Defaults

Variable defaults are defined directly in the Zod schema using `.default()`. This ensures that every cube has a predictable starting state and provides type-safe default values.

**Priority order (lowest to highest):**

1. Zod schema `.default()` values
2. Global `env` from `.nopyrc.json`
3. User prompts, or the recorded answers on session replay
4. Variables passed in by a dependency or a hook

This allows cubes to ship with reasonable defaults while still allowing users to override them globally via `.nopyrc.json` or interactively during deployment. Because `env` outranks the schema, `.nopyrc.json` is also what steers a run started with `--use-defaults`, which never prompts.

3 and 4 rarely compete: a key a dependency supplies is left out of the prompt entirely, so the user is only ever asked about the keys nothing else has set.

A field declared without `.default()` has none of sources 1 and 2 to fall back on. It is prompted for like any other, with an empty initial value — but a run that cannot prompt (`--use-defaults`) fails on it unless `env` or a dependency provides it.

### Configuration

Uses `.nopyrc.json` files (project-level or home directory) containing:

```json
{
  "hosts": ["host1.example.com", "host2.example.com"],
  "cubeDirs": ["./cubes", "../shared-cubes"],
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

- **`cubes`**: Array of cubes with only cube-specific variables (not global env vars)
- **`env`**: Global environment variables shared across cubes (like in `.nopyrc.json`)
- **`hosts`**: Array of target hosts
- **`auth`**: Authentication configuration (passwords are never stored)

**Security Note**: Passwords are never stored in session files. If a session uses password authentication, you'll be prompted for the password during replay.

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

### Cube Discovery

Nopy searches for cubes in:

1. Directories specified in `.nopyrc.json` `cubeDirs`
2. Directories containing a `.npcubes` marker file (searching upwards from current directory)

## Command Line Usage

### Installation

This package is part of a yarn workspace monorepo. Install from the repository root:

```bash
# From repository root (/ansiblings)
yarn install
yarn workspace @bitsquare/nopy build
```

To use the `nopy` command globally, you can:

1. **Use yarn workspace command**:

   ```bash
   yarn workspace @bitsquare/nopy nopy
   ```

2. **Link the package globally**:

   ```bash
   cd packages/nopy
   npm link
   # Now you can use 'nopy' from anywhere
   nopy install
   ```

3. **Use via npm scripts** (from packages/nopy directory):

   ```bash
   yarn nopy
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

Each entry records the selected cubes together with the variable values that were answered at the prompts, the target hosts, the authentication method, and the username — never the password. Pass an ID to `-H` to run that exact combination again:

```bash
nopy install -H mdk0zzp8b71cq
```

A replay is non-interactive: cube selection, host, and variable values all come from the entry, so nopy runs straight through without asking anything. The two exceptions are password authentication, which always re-prompts, and an entry with no recorded host, which falls back to the host picker.

Two things are worth knowing before relying on an older entry:

- **Recorded values are applied as defaults, not as a frozen snapshot.** If a cube's schema has gained a variable since the run was recorded, the replay neither prompts for it nor fails — the new variable quietly takes its Zod `.default()`. Global `env` values are likewise read from the *current* `.nopyrc.json` rather than from the entry.
- **A replay fails if a cube no longer exists.** Renaming or deleting a cube id makes every history entry that referenced it unreplayable: nopy logs `Cube from session not found` and then aborts with `Cube not found: <id>`.

The history lives in `.nopy.history.json` in the working directory and uses the same structure as a session file, so trimming the array by hand is a perfectly good way to prune it. It does contain the variable values that were entered, which is why it is listed in this repository's `.gitignore` — treat it like any other file holding deployment configuration. A corrupt or unreadable history file is treated as empty rather than raising an error, which looks exactly like a project that has never been deployed from.

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
- [Session Format](docs/SESSION_FORMAT.md) - Internal JSON/MJS session structure

## Resources

- [Pyinfra Documentation](https://docs.pyinfra.com/en/3.x/arguments.html)
