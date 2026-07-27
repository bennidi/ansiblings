# Nopy API Reference

This document describes the public API for the nopy package.

---

## Table of Contents

- [Main Module](#main-module)
- [Cubes Module](#cubes-module)
- [Executor Module](#executor-module)
- [Builder Module](#builder-module)
- [Workflow Module](#workflow-module)
- [Session Module](#session-module)
- [Config Module](#config-module)
- [Prompts Module](#prompts-module)

---

## Main Module

### `nopy(options?)`

Main entry point for nopy deployments.

```typescript
import { nopy } from '@bitsquare/nopy';

const result = await nopy({
  useDefaults: false,
  dryRun: true,
});
```

**Parameters:**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `useDefaults` | `boolean` | `false` | Skip variable prompts, use defaults |
| `useAuthKey` | `boolean` | `false` | Force SSH key authentication |
| `saveSession` | `string` | - | Path to save session file |
| `loadSession` | `string` | - | Path to load session for replay |
| `dryRun` | `boolean` | `false` | Show execution plan without running |
| `continueOnError` | `boolean` | `false` | Continue after failures |
| `jsonOutput` | `boolean` | `false` | Output results as JSON |

**Returns:** `Promise<NopyResult | undefined>`

```typescript
interface NopyResult {
  success: boolean;
  results: ExecutionResult[];
  summary: {
    total: number;
    successful: number;
    failed: number;
    totalDuration: number;
  };
}
```

---

## Cubes Module

The cubes module provides types and functions for working with deployment units.

### Types

#### `Cube<Schema>`

A fully loaded cube with filesystem location.

```typescript
interface Cube<Schema extends z.AnyZodObject = z.AnyZodObject> {
  key: string;           // Unique identifier
  name: string;          // Human-readable name
  dir: string;           // Absolute path to cube directory
  dependencies: string[];
  schema: Schema;
  defaults: () => z.infer<Schema>;
  before: Hook<Schema>[];
  after: Hook<Schema>[];
}
```

#### `Manifest<Schema>`

Cube manifest (used in `manifest.mjs` files).

```typescript
interface Manifest<Schema extends z.AnyZodObject = z.AnyZodObject> {
  name: string;
  key: string;
  dependencies: string[];
  schema: Schema;
  defaults: () => z.infer<Schema>;
  before: Hook<Schema>[];
  after: Hook<Schema>[];
}
```

#### `Hook<Schema>`

Hook function for before/after cube execution. See [Cube Hooks](HOOKS.md) for more details.

```typescript
type Hook<Schema extends z.AnyZodObject> = (
  ctx: HookContext,
  params: z.infer<Schema>
) => void | Promise<void>;

interface HookContext {
  /**
   * Schedules another cube for execution.
   * @param key - The unique identifier or path of the cube.
   * @param params - Variables to pass to the cube.
   */
  exec: (key: string, params: CubeVariables) => Promise<void> | void;
}
```

### Functions

#### `loadCubes()`

Loads all cubes from discovered cube directories.

```typescript
const { cubes, errors } = await loadCubes();
```

**Returns:** `Promise<LoadResult>`

```typescript
interface LoadResult {
  cubes: Record<string, Cube>;
  errors: string[];
}
```

#### `resolveDependencies(cubes, selectedCubeNames)`

Resolves all transitive dependencies for selected cubes.

```typescript
const order = resolveDependencies(cubes, ['apt-all']);
// Returns: ['apt:essentials', 'apt-more', 'apt-all']
```

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `cubes` | `Record<string, Cube>` | Map of all available cubes |
| `selectedCubeNames` | `string[]` | Cubes to resolve |

**Returns:** `string[]` - Cube names in execution order

**Throws:** `Error` if cube not found or circular dependency detected

#### `cubes.Manifest(options)`

Factory function for creating cube manifests.

```typescript
import { cubes } from '@bitsquare/nopy';

export default cubes.Manifest({
  name: 'My Cube',
  dependencies: () => [['apt:essentials']],
  schema: z.object({
    VERSION: z.string().default('1.0'),
  }),
});
```

`createManifest` and `manifest` are exported as equivalent aliases; `cubes.Manifest` is the documented form.

#### `uniqid(length?)`

Generates a random alphanumeric string.

```typescript
const id = uniqid();     // 'Kx7Pm'
const long = uniqid(10); // 'Kx7PmQr2Yw'
```

---

## Executor Module

Handles pyinfra command execution.

### Types

#### `DeployCall`

A deployment command ready for execution.

```typescript
interface DeployCall {
  cube: string;
  host: string;
  cwd: string;
  command: string[];
  env: Record<string, unknown>;
  dependencies: string[];
}
```

#### `ExecutionResult`

Result of executing a deployment command.

```typescript
interface ExecutionResult {
  cube: string;
  host: string;
  success: boolean;
  duration: number;
  stdout?: string;
  stderr?: string;
  error?: Error;
}
```

#### `ExecutionOptions`

Options for deployment execution.

```typescript
interface ExecutionOptions {
  continueOnError?: boolean;
  dryRun?: boolean;
  onProgress?: (result: ExecutionResult, completed: number, total: number) => void;
  onStart?: (cube: string, host: string) => void;
}
```

### Functions

#### `executeDeployCalls(calls, options?)`

Executes an array of deployment calls sequentially, in the order they were built.

```typescript
const results = await executeDeployCalls(calls, {
  continueOnError: false,
  onProgress: (result, completed, total) => {
    console.log(`${completed}/${total}`);
  },
});
```

#### `outputExecutionPlan(calls, asJson?)`

Outputs the execution plan without running.

```typescript
outputExecutionPlan(deployCalls);       // Text output
outputExecutionPlan(deployCalls, true); // JSON output
```

#### `summarizeResults(results)`

Generates a summary of execution results.

```typescript
const summary = summarizeResults(results);
// {
//   total: 5,
//   successful: 4,
//   failed: 1,
//   totalDuration: 12345,
//   failures: [{ cube: 'docker', ... }]
// }
```

---

## Builder Module

Constructs deployment commands.

### `buildDeployCalls(cubeNames, hosts, context)`

Builds deployment calls for all cubes and hosts.

```typescript
const result = await buildDeployCalls(
  ['apt:essentials', 'apt-more'],
  ['@docker/test'],
  {
    cubes,
    session,
    config,
    authMethod: 'ssh-key',
    useDefaults: true,
    isSessionReplay: false,
  }
);
```

**Returns:** `Promise<BuildResult>`

```typescript
interface BuildResult {
  deployCalls: DeployCall[];
  cubeSessions: CubeSession[];
  sessionEnv: Record<string, unknown>;
}
```

---

## Workflow Module

Manages interactive and replay workflows.

### `runWorkflow(sessionPath, cubes, config, options?)`

Runs the appropriate workflow based on options.

```typescript
const result = await runWorkflow(
  undefined,  // null for interactive, path for replay
  cubes,
  config,
  { useDefaults: false }
);
```

**Returns:** `Promise<WorkflowResult>`

```typescript
interface WorkflowResult {
  session: NopySession;
  cubesWithDependencies: string[];
  authMethod: string;
  username?: string;
  password?: string;
  isReplay: boolean;
}
```

### `runInteractiveWorkflow(cubes, config, options?)`

Runs the interactive cube selection workflow.

### `runReplayWorkflow(sessionPath, cubes, config)`

Runs a replay from a saved session file.

---

## Session Module

Manages session save/load operations.

### Types

#### `NopySession`

Complete session configuration.

```typescript
interface NopySession {
  name?: string;
  cubes: CubeSession[];
  hosts?: string[];
  auth: AuthSession;
  env?: SessionVariables;
}
```

#### `CubeSession`

Configuration for a single cube.

```typescript
interface CubeSession {
  key: string;
  variables: SessionVariables;
}
```

#### `AuthSession`

Authentication configuration.

```typescript
interface AuthSession {
  method: 'ssh-key' | 'password' | 'ssh';
  username?: string;
}
```

### Functions

#### `saveSession(session, filePath)`

Saves a session to a JSON file.

```typescript
saveSession(session, './my-deployment.nopysession.json');
```

#### `loadSession(filePath)`

Loads a session from a JSON or MJS file.

```typescript
const session = await loadSession('./deployment.json');
const session = await loadSession('./deployment.mjs');
```

#### `createSession(params)`

Creates a session object from runtime data.

```typescript
const session = createSession({
  cubes: [{ key: 'apt:essentials', variables: {} }],
  hosts: ['localhost'],
  auth: { method: 'ssh-key' },
});
```

#### `listSessions(dirPath?)`

Lists all session files in a directory.

```typescript
const sessions = listSessions('./sessions');
// ['./sessions/deploy.session.json', './sessions/test.session.mjs']
```

---

## Config Module

Manages nopy configuration.

### Types

#### `NopyConfig`

Configuration file structure.

```typescript
interface NopyConfig {
  hosts: string[];
  cubeDirs: string[];
  env: EnvConfig;
  log?: LogConfig;
}
```

#### `LogConfig`

Logging configuration.

```typescript
interface LogConfig {
  verbosity?: 'silent' | 'info' | 'verbose' | 'trace';
  debug?: boolean;
}
```

### Functions

#### `loadConfig()`

Loads configuration from `.nopyrc.json`.

```typescript
const config = loadConfig();
```

Search order:

1. `./nopyrc.json` (local)
2. `~/.nopyrc.json` (home)

#### `saveConfig(data, local?)`

Saves configuration to a file.

```typescript
saveConfig({ hosts: ['server.local'] });       // Local
saveConfig({ hosts: ['server.local'] }, false); // Home
```

#### `logConfigToFlags(logConfig?)`

Converts log config to pyinfra flags.

```typescript
logConfigToFlags({ verbosity: 'verbose', debug: true });
// ['-vv', '--debug']
```

---

## Prompts Module

Interactive prompts for user input.

### `CubeSelection(cubes)`

Prompts user to select cubes to execute.

```typescript
const { selectedCubes } = await CubeSelection(cubes);
```

### `HostSelection(hosts)`

Prompts user to select a target host.

```typescript
const host = await HostSelection(['server1', 'server2']);
```

### `AuthSelection(useAuthKey?)`

Prompts user to select authentication method.

```typescript
const { authMethod, username, password } = await AuthSelection();
```

### `VariableAssignment(cube, env)`

Prompts user to customize cube variables.

```typescript
const vars = await VariableAssignment(cube, { existing: 'value' });
```

### `PasswordSelection(username)`

Prompts for password input.

```typescript
const password = await PasswordSelection('admin');
```

---

## CLI Usage

```bash
# Interactive deployment
nopy install

# With defaults (no prompts)
nopy install -D

# SSH key auth
nopy install -K

# Save session
nopy install -s ./my-session.json

# Replay session
nopy install -l ./my-session.json

# Dry run
nopy install -n

# JSON output
nopy install -j

# Continue on error
nopy install -c
```

---

## Creating a Cube

### File Structure

A cube is a directory containing both a `manifest.mjs` and a `deploy.py`:

```
cubes/
└── my-cube/
    ├── manifest.mjs
    └── deploy.py
```

Cube directories may be nested for grouping (`cubes/apt/install/`), and any extra files alongside the pair are available to the deploy script via relative paths.

The prefixed forms `<cube-name>.manifest.mjs` and `<cube-name>.deploy.py` are still recognized for backwards compatibility.

### Manifest Example

```javascript
// manifest.mjs
import { cubes } from '@bitsquare/nopy';
import { z } from 'zod';

export default cubes.Manifest({
  name: 'My Cube',
  dependencies: () => [['apt:essentials']],
  schema: z.object({
    VERSION: z.string().default('1.0').describe('Version to install'),
    ENABLE_FEATURE: z.boolean().default(false),
  }),
  before: [
    (ctx, params) => {
      console.log('Before my-cube');
    },
  ],
  after: [
    (ctx, params) => {
      console.log('After my-cube');
    },
  ],
});
```

### Deploy Script Example

```python
# deploy.py
from pyinfra import host
from pyinfra.operations import apt, server

VERSION = host.data.get('VERSION', '1.0')
ENABLE_FEATURE = host.data.get('ENABLE_FEATURE', False)

apt.packages(
    name='Install my-package',
    packages=[f'my-package={VERSION}'],
    update=True,
)

if ENABLE_FEATURE:
    server.shell(
        name='Enable feature',
        commands=['my-package --enable-feature'],
    )
```
