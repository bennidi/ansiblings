# Nopy

A CLI tool that simplifies **pyinfra** script management and execution, providing an interactive workflow for deploying infrastructure configurations ("cubes") to remote hosts.

## Overview

Nopy wraps pyinfra with structure, validation, and an interactive experience for managing complex infrastructure deployments. It organizes deployments into self-contained "cubes" with dependency management, schema validation, and lifecycle hooks.

## Core Concepts

### Cubes

Self-contained deployment units consisting of:

- **Python deployment script**: `<cube-name>.deploy.py`
- **JavaScript manifest**: `<cube-name>.manifest.mjs` defining schema, dependencies, defaults, and hooks
- **Configuration variables**: Validated with Zod schemas

#### Cube Manifest

```javascript
import { z } from 'zod'
import { cubes } from '@bitstack/nopy'

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

#### Variable Defaults

Variable defaults are defined directly in the Zod schema using `.default()`. This ensures that every cube has a predictable starting state and provides type-safe default values.

**Priority order (lowest to highest):**

1. Zod schema `.default()` values
2. Global `env` from `.nopyrc.json`
3. Accumulated variables from dependencies
4. User prompts / session replay

This allows cubes to ship with reasonable defaults while still allowing users to override them globally via `.nopyrc.json` or interactively during deployment.

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
  }
}
```

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

**Examples:**

Basic troubleshooting:

```json
{
  "log": {
    "verbosity": "info"
  }
}
```

Debug command failures:

```json
{
  "log": {
    "verbosity": "trace"
  }
}
```

Deep debugging with pyinfra internals:

```json
{
  "log": {
    "verbosity": "trace",
    "debug": true
  }
}
```

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
yarn workspace @bitstack/nopy build
```

To use the `nopy` command globally, you can:

1. **Use yarn workspace command**:

   ```bash
   yarn workspace @bitstack/nopy nopy
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

**Use SSH key authentication**:

```bash
nopy install --auth-method-key
# or
nopy install -K
```

**Repeat last run**:

```bash
nopy install --repeat-last-run
# or
nopy install -R
```

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

**Parallel execution**:

```bash
nopy install --parallel
```

Executes independent cubes in parallel using a dependency graph. Cubes are grouped into execution stages, with a default concurrency limit of 4.

**JSON output (for CI/CD)**:

```bash
nopy install --json
nopy history --json
```

Machine-readable JSON output for scripting and CI/CD integration.

**Continue on error**:

```bash
nopy install --continue-on-error
```

Continue deploying remaining cubes even if one fails.

**View deployment history**:

```bash
nopy history              # List recent deployments
nopy install -H <id>      # Replay a specific deployment by ID
```

### Development

**Run without building**:

```bash
npm run nopy
```

**Debug**:

```bash
npm run debug
```

## Workflow

1. **Load cubes** - Discovers and validates cubes from configured directories
2. **Interactive prompts** - Select cubes, target host, and authentication method
3. **Dependency resolution** - Topologically sorts cubes based on dependencies
4. **Variable assignment** - Validates and collects configuration with schema validation
5. **Execute hooks** - Runs before/after hooks for orchestration
6. **Deploy** - Sequentially executes pyinfra commands

## Features

- **Dependency resolution** with topological sorting
- **Parallel execution** of independent cubes in stages
- **Before/after hooks** for multi-cube orchestration
- **SSH key or password authentication**
- **Default values** with optional customization via manifest `env`
- **Schema validation** using Zod
- **Recursive cube directory discovery**
- **Dry-run mode** for previewing deployments
- **JSON output** for CI/CD integration
- **Session history** with replay capability

## Documentation

- [Cube Hooks](docs/HOOKS.md) - Lifecycle hooks for dynamic orchestration
- [Session Format](docs/SESSION_FORMAT.md) - Internal JSON/MJS session structure

## Resources

- [Pyinfra Documentation](https://docs.pyinfra.com/en/3.x/arguments.html)
