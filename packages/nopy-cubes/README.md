# @bitsquare/nopy-cubes

The authoring surface for [nopy](https://www.npmjs.com/package/@bitsquare/nopy)
cubes — the `Manifest` factory, the `Cube` class, and the types around them.

A cube manifest ships nothing but data, so it should not have to depend on a CLI
to describe itself. This package is what a **cube bundle** depends on: no
`commander`, no `inquirer`, no `execa`, no process spawning. `@bitsquare/nopy`
re-exports everything here, so a manifest that already imports from
`@bitsquare/nopy` keeps working unchanged.

## Install

```sh
pnpm add @bitsquare/nopy-cubes zod
```

`zod` is a **peer dependency** on purpose: the manifest, the schema it builds and
the `Manifest` factory should all see the same copy.

## Writing a manifest

```js
// cubes/net/tailscale/manifest.mjs
import { Manifest } from '@bitsquare/nopy-cubes';
import { z } from 'zod';

export default Manifest({
  id: 'net:tailscale',
  name: 'Tailscale',
  schema: z.object({
    AUTH_KEY: z.string().describe('Tailscale auth key'),
    ACCEPT_ROUTES: z.boolean().describe('Accept advertised routes').default(true),
  }),
  secrets: ['AUTH_KEY'],
  dependencies: (vars) => (vars.ACCEPT_ROUTES ? ['net:ip-forwarding'] : []),
  before: [async (ctx, vars) => ctx.exec('apt:essentials', {})],
});
```

Every schema field should carry a `.describe()` — nopy uses it as the prompt
label — and a `.default()` wherever a sensible one exists, so `--use-defaults`
can run the cube without prompting.

`secrets` names the schema keys that hold sensitive values. Nopy keeps those out
of session and history files and masks them in every command it prints; it does
not infer them, so a key nothing declares is recorded and printed in the clear.
Each entry must be a key of `schema` — naming anything else is a manifest error.
Give a secret a placeholder `.default()` rather than a real credential: a default
lives in the manifest, where none of that protection reaches it.

The manifest lives next to a `deploy.py` in the same directory; together they
make a cube. See the
[nopy README](https://www.npmjs.com/package/@bitsquare/nopy) for the full cube
contract and for how to publish a directory of cubes as a bundle.

## Exports

| Export                              | What it is                                                     |
| ----------------------------------- | -------------------------------------------------------------- |
| `Manifest(opts)`                    | Builds a manifest, filling in `id`, `schema`, `secrets`, `before`, `after` |
| `createManifest` / `manifest`       | Aliases of `Manifest`                                           |
| `Cube`                              | A loaded manifest plus its directory; `getDefaults()`, `requiredKeys()`, `secrets`, `isSecret()` |
| `zodKind` / `zodInner`              | Instance-agnostic zod introspection, safe across zod copies      |
| `AnyObjectSchema`, `CubeVariables`, `DependencySpec`, `Hook`, `HookContext`, `CubeSource`, `LoadResult` | types |

## License

MIT
