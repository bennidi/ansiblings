# Nopy Cube Hooks

Hooks provide a way to orchestrate deployments dynamically during the build process. They allow a cube to trigger the execution of other cubes based on its configuration or the environment.

## Overview

A cube manifest can define `before` and `after` hooks. These hooks are executed when the deployment plan is being built.

- **`before` hooks**: Executed *before* the current cube is added to the deployment sequence.
- **`after` hooks**: Executed *after* the current cube is added to the deployment sequence.

## Specification

Hooks are defined as an array of functions in the cube manifest.

```javascript
import { z } from 'zod';
import { cubes } from '@bitsquare/nopy';

export default cubes.Manifest({
  name: 'my-cube',
  schema: z.object({
    SETUP_DB: z.boolean().default(false),
  }),
  before: [
    async ({ exec }, params) => {
      if (params.SETUP_DB) {
        // This will run BEFORE my-cube
        await exec('db:setup', { TYPE: 'postgres' });
      }
    }
  ],
  after: [
    ({ exec }, params) => {
      // This will run AFTER my-cube
      console.log('Finished setting up my-cube');
    }
  ]
});
```

### Hook Function Signature

Each hook function receives two arguments:

1. **`context`**: An object containing:
    - `exec(cubeKey: string, params: Record<string, any>)`: A function to schedule another cube for execution.
2. **`params`**: The final, validated variables for the current cube (including defaults and user-provided values).

Hooks can be synchronous or asynchronous (returning a `Promise`).

## Mechanics

### Execution Order

Cubes are always deployed sequentially, in the order they were pushed to the deployment plan. For a cube with hooks that means:

1. Cubes from `before` hooks.
2. The current cube itself.
3. Cubes from `after` hooks.

Because a `before` hook only places its cube *earlier in the plan*, it guarantees ordering but not much else — if the relationship is a real dependency rather than a one-off ordering nudge, declare it in `dependencies` so it is resolved and deduplicated like any other.

### Variable Passing

When you call `exec(cubeKey, params)` within a hook:

1. The `params` provided are merged with the current environment variables.
2. These variables are passed to the target cube, preventing it from prompting the user for those same variables.

### Use Cases

- **Conditional Setup**: Running a setup cube only if a specific variable is set.
- **Environment Preparation**: Ensuring a user exists or a directory is created before the main cube runs.
- **Cleanup/Notification**: Running a task after a cube deployment finishes.

## Comparison with Dependencies

| Feature | Dependencies | Hooks |
| :--- | :--- | :--- |
| **Declaration** | Static (`dependencies: () => [['id']]`) | Dynamic (`before: [...]`) |
| **Execution Order** | Guaranteed before dependent | `before` (before) or `after` (after) |
| **Variable Passing** | Inherited from env | Explicitly passed via `exec()` |
| **Conditionality** | Always run | Can be conditional based on logic |

Use **dependencies** for static requirements and **hooks** for dynamic orchestration and explicit parameter passing.
