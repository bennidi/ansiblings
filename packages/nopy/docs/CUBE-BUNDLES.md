# Cube bundles

How to package cubes as an npm package so other projects can install them, and
what changes once a cube lives in `node_modules` instead of in your own tree.

If you only want to *use* a published bundle, you need one line of config:

```json
{ "cubePackages": ["@bitsquare/nopy-cubes-core"] }
```

The rest of this document is for writing one.

- [What a bundle is](#what-a-bundle-is)
- [The package manifest](#the-package-manifest)
- [Writing the cubes](#writing-the-cubes)
- [Ids are claimed globally](#ids-are-claimed-globally)
- [An installed bundle is read-only](#an-installed-bundle-is-read-only)
- [How resolution actually works](#how-resolution-actually-works)
- [Publishing](#publishing)
- [Troubleshooting](#troubleshooting)

## What a bundle is

An ordinary npm package that ships its cubes in a `cubes/` directory. There is no
build step, no plugin API and no entry point — nopy reads the directory off disk
and imports each `manifest.mjs` directly.

```
@acme/cubes-web
├── package.json          no nopy block needed
├── README.md
└── cubes/
    ├── nginx/
    │   ├── manifest.mjs
    │   └── deploy.py
    └── certbot/
        ├── manifest.mjs
        └── deploy.py
```

`@bitsquare/nopy-cubes-core` in this repository is the worked example, and is consumed
by this repository through exactly the mechanism described here — it is not
special-cased.

## The package manifest

```json
{
  "name": "@acme/cubes-web",
  "version": "1.0.0",
  "type": "module",
  "files": ["cubes", "!cubes/**/*.log", "README.md", "LICENSE"],
  "publishConfig": { "access": "public" },
  "dependencies": {
    "@bitsquare/nopy-cubes": "^1.0.0",
    "zod": "^4.4.3"
  }
}
```

**Nothing declares the cubes.** `cubes/` at the package root is the convention,
scanned recursively, and a bundle that follows it needs no nopy-specific field at
all. Naming the package in `cubePackages` is already the statement that cubes are
expected from it.

**`nopy.cubes`** overrides that, for the bundle whose cubes are somewhere else — a
package compiled from TypeScript sources into `dist/cubes`, say, or one shipping
two separate trees:

```json
  "nopy": { "cubes": ["./dist/cubes", "./contrib"] }
```

It is an array of directories relative to the package root. Every entry must
exist and must stay inside the package — a path escaping the root is refused, not
resolved. Present-but-malformed (an empty array, a bare string, non-strings) is an
error rather than a fall back to the default: saying something that does not parse
is not the same as saying nothing.

**`type: "module"`** matters: manifests are ESM. Without it a `manifest.mjs` still
loads (the extension carries the day), but anything it imports relatively will
not behave the way you expect.

**`files`** decides the tarball. Note the negation: a cube that has been run
leaves a `pyinfra-debug.log` next to its `deploy.py`, and `.gitignore` has no
effect on what npm packs. Check with `npm pack --dry-run` before publishing.

**Dependencies** are `@bitsquare/nopy-cubes` and `zod`, both real dependencies
rather than peers — a bundle is a leaf, and the copies it gets are the copies its
manifests use. Do **not** depend on `@bitsquare/nopy`: the CLI is what installs
your bundle, not the other way round, and depending on it invites two copies of
the same code into one tree.

## Writing the cubes

A cube directory holds a manifest (`manifest.mjs` or `*.manifest.mjs`) and a
deploy script (`deploy.py` or `*.deploy.py`). Anything else in the directory is
invisible to the loader but readable from the script, which runs with the cube
directory as its working directory.

```javascript
// cubes/nginx/manifest.mjs
import { Manifest } from '@bitsquare/nopy-cubes';
import { z } from 'zod';

export default Manifest({
  id: 'web:nginx',
  name: 'Install and configure nginx',
  dependencies: () => ['apt:essentials'],
  secrets: ['TLS_KEY'],
  schema: z.object({
    SERVER_NAME: z.string().describe('Server name').default('example.com'),
    TLS_KEY: z.string().describe('TLS private key (PEM)').default(''),
    HTTP2: z.boolean().describe('Enable HTTP/2').default(true),
  }),
});
```

```python
# cubes/nginx/deploy.py
from pyinfra import host
from pyinfra.operations import apt, files

SERVER_NAME = host.data.SERVER_NAME

apt.packages(name='Install nginx', packages=['nginx'], _sudo=True)
```

Import **`@bitsquare/nopy-cubes`**, not `@bitsquare/nopy`. It is types and a
factory with zod as its only peer — no CLI, no prompts, no process spawning — so
your bundle stays a leaf. (`@bitsquare/nopy` re-exports the same surface as
`cubes.Manifest`, which is what older manifests use. It still works; it just
drags the CLI into your dependency graph if you declare it.)

Four things the schema is load-bearing for:

- **`.describe()` is the prompt label.** A field without one prompts with its raw
  key.
- **`.default()` makes the field optional.** A field with no default is required,
  and is re-prompted on replay if a session has no value for it.
- **Every schema key reaches pyinfra** as `--data KEY=value`, so `host.data.KEY`
  is always defined. pyinfra parses the values itself: `"true"` arrives as a
  bool, `"8080"` as an int.
- **`secrets` names keys whose values must not be persisted.** They are excluded
  from session files and history, masked wherever a command is printed, and
  re-prompted on replay. Naming a key that is not in the schema is a load error.
  A secret is still visible in `ps` while pyinfra runs — masking covers nopy's
  own output, not the process table — so treat it as protection against writing
  credentials to disk, not as protection against a shared host.

`dependencies` is a function of the *collected* variables, so it can branch on
what the user actually answered, and it may pass parameters:

```javascript
dependencies: (v) => (v.HTTP2 ? ['apt:essentials', ['web:tls', { MODE: 'strict' }]] : []),
```

`before` / `after` hooks get a context whose `exec(id, vars)` pulls in any cube
by id, declared dependency or not. See [HOOKS.md](HOOKS.md).

## Ids are claimed globally

An id is claimed across every source at once — `cubeDirs`, `.npcubes` trees and
every installed bundle share one flat namespace. Two cubes claiming the same id
abort the run with an error naming both and where each came from.

There is no precedence and no shadowing, deliberately, in either direction: a
local cube does not quietly win over a packaged one, and installing a second
bundle cannot silently change what an existing id deploys. Overriding a cube from
a bundle is not a supported operation; fork the cube under your own id instead.

So prefix distinctly. `@acme/cubes-web` claiming `nginx` is asking for trouble the
first time someone installs a second bundle; `web:nginx` is not. Ids need not
mirror the directory layout — `cubes/network/tailscale` declares `net:tailscale`
— so the prefix is free.

An id is also the session key. Renaming one silently invalidates every recorded
session that used it, so treat a rename as a breaking change of the bundle.

## An installed bundle is read-only

Under pnpm, installed files are **hardlinked into a global store shared by every
project on the machine**. A cube that writes next to its own `deploy.py` does not
just dirty one `node_modules` — it corrupts that store for every other project.

Write to `/tmp`, to a path the user configured, or to the remote host. Never to
the cube's own directory. Files the cube needs to *read* (templates, config
fragments, systemd units) are fine and are exactly what the cube directory is for
— `deploy.py` runs with it as the working directory, so `files.template('nginx.conf.j2', ...)`
resolves.

This is the one constraint that does not exist while the cubes live in your own
repo, which makes it the one most likely to be discovered late. Test against an
installed copy, not a linked one.

## How resolution actually works

Worth knowing, because two of the failure modes are otherwise baffling.

**Where a package is looked up from.** Each `cubePackages` entry is resolved from
the directory of the config file that named it, not from the working directory.
Configs merge upward, so a `.nopyrc.json` two levels up can name a bundle that
only exists in *its* `node_modules`, and it resolves. The lookup reads
`package.json` off disk via `createRequire(...).resolve.paths()` rather than
going through `exports` — a bundle ships directories and has no entry point to
declare.

**Why the loader does not simply scan `node_modules`.** It cannot: pnpm plants a
symlink at `node_modules/<name>`, and `readdir` reports it as a symlink, not a
directory, so a recursive scan skips every package silently. Naming packages
explicitly is the fix, and it is also the reason `node_modules` is skipped during
the cube scan itself.

**How a manifest finds its imports.** Ordinary Node resolution, from the
manifest's own directory. An installed bundle has its own `node_modules` with
`@bitsquare/nopy-cubes` and `zod` in it, so this just works. A hand-written cube
sitting in a directory with no `node_modules` would historically fail with
`ERR_MODULE_NOT_FOUND`; nopy now registers a resolve hook that catches exactly
that case and falls back to resolving `@bitsquare/nopy-cubes`, `@bitsquare/nopy`
and `zod` from the running CLI. Normal resolution is always tried first, so a
cube that ships its own zod keeps it. Treat the hook as a convenience for local
cubes — a published bundle must declare its dependencies properly.

**Two copies of zod is a real hazard.** `instanceof` comparisons fail across
copies, which is why nopy inspects schemas structurally (`schema.def.type`) and
why `secrets` is a plain array rather than `.meta()` metadata — zod's metadata
registry is per-copy, and a marker written into one copy's registry is invisible
to another. Keep your zod range compatible with the CLI's (`^4.4.3`) and the
package manager will usually give you one copy.

## Publishing

Nothing bundle-specific: `npm publish` (or `pnpm publish`) with a version bump.
Some things worth deciding once:

- **Version the bundle independently of nopy.** There is no compatibility check
  between the two — the loader scans whatever directories it finds. Document
  the nopy version you test against in your README.
- **Renaming or removing an id is breaking.** It invalidates recorded sessions
  and breaks any manifest listing it as a dependency, including manifests in
  other people's bundles.
- **Changing a schema key is breaking** in the same way; adding one with a
  `.default()` is not.
- **Test the installed shape, not the linked one.** `npm pack`, install the
  tarball into a throwaway directory with a `.nopyrc.json` naming it, and deploy
  from it. This is what catches a missing file, a cube that writes to its own
  directory, and an undeclared dependency — none of which show up while the
  package is symlinked into the repo that wrote it.

  For an unattended check, replay a session file rather than reaching for `-P`
  alone, which still opens the interactive picker:

  ```sh
  nopy install -l session.json -P -D
  ```

  Note that a replay re-prompts for anything a manifest lists in `secrets` —
  those are never written to a session — so pick a cube without them, or put the
  values under `env` in `.nopyrc.json`.

For how this repository releases its own packages, see
[README.PUBLISH.md](../../../README.PUBLISH.md).

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `Cube package 'X' is not installed (looked up from …)` | Not installed, or installed somewhere other than the config that named it. The path in the message is where the lookup started. |
| `Cube package 'X' has no cubes/ directory in …` | No `cubes/` at the package root and no `nopy.cubes` pointing elsewhere. Usually the directory was not packed — check `files` and `npm pack --dry-run`. |
| `"nopy": { "cubes": … } must be a non-empty array of strings` | The override is present but malformed. Fix it, or omit it entirely to use `./cubes`. |
| `'…' does not exist in …` | A `nopy.cubes` entry pointing at a directory the tarball does not contain. |
| `'…' points outside the package` | A `nopy.cubes` entry escaping the package root. Not allowed. |
| `Duplicate cube id 'X' from N sources:` | Two or more cubes claiming one id; the message lists each source. Rename one — there is no precedence rule to lean on. |
| `ERR_MODULE_NOT_FOUND` for `zod` or `@bitsquare/nopy-cubes` | The bundle did not declare them as dependencies. The resolve-hook fallback covers loose local cubes, not published packages. |
| `Invalid manifest in …: 'secrets' names X, which is not in the schema` | A `secrets` entry with no matching schema key — usually a typo or a renamed field. |
| Cubes work linked, fail installed | Almost always a write into the cube's own directory, or a file missing from `files`. |
