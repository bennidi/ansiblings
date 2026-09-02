# NOPY.LLM.md — nopy for language models

This file was written by `nopy init` and is bundled with the nopy release that
wrote it. It is a working reference for AI assistants (and humans) operating in
a project that deploys with **nopy**. Read it before answering questions about
nopy, before writing or editing a cube, and before planning how to reach a
deployment goal. When this guide and the installed CLI disagree, the CLI wins —
check `nopy --help` and the package README.

## What nopy is

nopy is a CLI that wraps [pyinfra](https://docs.pyinfra.com/) — a Python
infrastructure-as-code tool — in an interactive workflow. Deployments are
organised into **cubes**: self-contained directories holding a JavaScript
manifest (declaring typed input variables, secrets, dependencies, and hooks) and
a plain pyinfra deploy script. nopy discovers cubes, prompts for a target host
and variable values, resolves dependencies into a topological order, and then
runs one `pyinfra` command per cube, sequentially. Every run is recorded and can
be replayed.

nopy does not vendor pyinfra. `pyinfra` must be on `PATH`
(`pipx install pyinfra`), and `docker` / `vagrant` too if those connectors are
used. Node ≥ 22 is required.

## Quick facts

| Thing | Value |
| --- | --- |
| Binary | `nopy` (default subcommand: `install`) |
| Config file | `.nopyrc.json` — cwd upward to `/`, plus `~/.nopyrc.json`, all merged |
| Cube | a directory with `manifest.mjs` + `deploy.py` |
| Session file | `*.nopysession.json` (`--save-session` / `--load-session`) |
| History | `.nopy.history.json` in the working directory — add it to `.gitignore` |
| Update cache | `~/.nopy/update-check.json` |
| Cube marker | a `.npcubes` file makes its directory a cube root |
| Authoring package | `@bitsquare/nopy-cubes` (imported by manifests) |
| Core cube bundle | `@bitsquare/nopy-cubes-core` |

## How to help — a decision guide

When asked to achieve a deployment goal, work through this order:

1. **Find an existing cube.** List the project's cube sources: `cubeDirs` and
   `cubePackages` in the merged `.nopyrc.json`, plus any `.npcubes` marker
   directories. The core bundle's cubes are listed at the end of this file.
   Prefer configuring an existing cube over writing a new one.
2. **Compose cubes.** One run can select several cubes; each cube's declared
   dependencies are pulled in automatically and deployed first. Do not
   hand-order cubes that already declare their relationship.
3. **Configure, don't fork.** A cube's behaviour is steered by its schema
   variables. Project-wide values belong under `env` in `.nopyrc.json`
   (they override schema defaults); per-run values come from the prompts.
4. **Write a new cube** only when nothing covers the goal — see
   [Authoring a cube](#authoring-a-cube). Keep it small, idempotent, and give
   every variable a `.describe()` and (usually) a `.default()`.
5. **Make it repeatable.** For "run this again later": rely on history (`-R`,
   `-H <id>`) or record a session file (`-s file.nopysession.json`). For
   CI/unattended runs: `nopy install -D` plus values under `env` — see
   [CI and unattended runs](#ci-and-unattended-runs).

## CLI reference

`nopy` with no subcommand runs `install`. Everything nopy says about itself
goes to **stderr**; stdout carries only deploy commands and pyinfra's own
output. Exit code is `1` if any cube failed, `0` otherwise.

```
nopy [install]              interactive: pick cubes, host, auth, variables
nopy init                   write a starter .nopyrc.json and this guide (-f overwrites)
nopy create-cube [dir]      scaffold a cube (manifest.mjs + deploy.py); prompts for
                            what --id and --name do not supply (-f overwrites)
nopy history                list recorded sessions (--json for machine-readable)
nopy clear-history          delete all recorded sessions
nopy self-update            update nopy on its release channel (--dry-run, --force,
                            --channel <latest|next|main>, --registry <url>)
```

`install` flags:

| Flag | Effect |
| --- | --- |
| `-D, --use-defaults` | skip the variable form; values come from defaults, `env`, dependencies |
| `-K, --auth-method-key` | SSH key auth without asking |
| `-R, --repeat-last` | replay the newest history entry |
| `-H, --history <id>` | replay a specific history entry (`nopy history` shows ids) |
| `-s, --save-session <path>` | record the run to a session file |
| `-l, --load-session <path>` | replay a session file |
| `-n, --dry-run` | print the execution plan (commands + variables, secrets masked), run nothing |
| `-P, --print-only` | print only the deploy commands to stdout, run nothing |
| `-c, --continue-on-error` | keep deploying remaining cubes after a failure |
| `--no-save-history` | do not record this run |

Environment variables: `NOPY_DEBUG=1` prints full stack traces;
`NOPY_NO_UPDATE_CHECK=1` (or `CI` being set) disables the daily update check;
`NOPY_REGISTRY`, `NOPY_REGISTRY_TOKEN`, `NOPY_PACKAGE_MANAGER` steer
`self-update`.

## Configuration: `.nopyrc.json`

Every `.nopyrc.json` from the filesystem root down to the working directory,
plus `~/.nopyrc.json`, is merged root-first — the nearer file wins ties. Arrays
concatenate and dedupe, objects deep-merge; a child file can switch a property
to wholesale replacement with `"resolution": { "<property>": "override" }`.
Relative paths in `cubeDirs` resolve against the config file that wrote them,
and each `cubePackages` entry resolves from that file's directory too. If no
config file exists anywhere, `nopy install` refuses to run — `nopy init` fixes
that.

All properties, all optional:

```json
{
  "hosts": ["web-01.example.com", "@docker/my-container", "@vagrant/default"],
  "cubeDirs": ["./cubes"],
  "cubePackages": ["@bitsquare/nopy-cubes-core"],
  "env": { "KEY_DIR": "./keys" },
  "secrets": ["DEPLOY_TOKEN"],
  "log": { "verbosity": "info", "debug": false },
  "history": { "maxSessions": 10, "autoSave": true },
  "execution": { "continueOnError": false },
  "resolution": { "hosts": "override" }
}
```

- **`hosts`** seeds the host picker (see [Hosts](#hosts-connectors-and-auth)).
- **`cubeDirs`** — directories scanned recursively for cubes.
- **`cubePackages`** — installed npm packages that ship cubes in a `cubes/`
  directory (or wherever their `package.json` `nopy.cubes` points). Naming a
  package that is missing or malformed is a hard error, never a silent skip.
- **`env`** — key/value pairs seeded onto **every** cube in the run, at a
  priority above schema defaults. This is how a project pins values and how
  `--use-defaults` runs are steered.
- **`secrets`** — `env` keys to treat as sensitive even though no manifest
  declares them (masked, never recorded, delivered only to cubes whose schema
  names them).
- **`log.verbosity`** — `silent` (default) | `info` (`-v`) | `verbose` (`-vv`)
  | `trace` (`-vvv`); **`log.debug`** adds `--debug`. These become pyinfra
  flags.
- **`history`** — `maxSessions` (default 10) and `autoSave` (default true).
- **`execution.continueOnError`** — project default for `-c`.

## Cubes

A cube is any directory holding both a manifest (`manifest.mjs` or
`*.manifest.mjs`) and a deploy script (`deploy.py` or `*.deploy.py`).
Discovery unions `cubeDirs`, the cube directories of every `cubePackages`
entry, and every ancestor directory containing a `.npcubes` marker file, then
scans recursively (skipping dot-directories and `node_modules`). Extra files in
a cube directory are ignored by the loader but reachable from the script — **the
deploy script runs with the cube directory as its working directory**.

Cube ids (e.g. `apt:install`, `net:tailscale`) are flat strings claimed
**globally** across all sources. Two cubes with one id abort the run with an
error naming both — there is no shadowing and no precedence. Prefix local cube
ids distinctly when a bundle is also installed. The id need not mirror the
path; it comes from `manifest.id`, falling back to an `[id]` prefix in
`manifest.name`, then the directory basename.

## Authoring a cube

`nopy create-cube --id myapp:caddy-site --name "Serve the app behind Caddy"`
scaffolds the layout below with a loadable example schema to replace — fully
non-interactive when both flags and the directory argument are given.

Layout:

```
cubes/
└── myapp/
    └── caddy-site/
        ├── manifest.mjs
        └── deploy.py
```

`manifest.mjs` — ESM, imports from `@bitsquare/nopy-cubes` (a local cube needs
no `node_modules` of its own: when normal resolution fails, nopy resolves
`@bitsquare/nopy-cubes` and `zod` from its own installation):

```javascript
import { Manifest } from '@bitsquare/nopy-cubes';
import { z } from 'zod';

export default Manifest({
  id: 'myapp:caddy-site',
  name: 'Serve the app behind Caddy',
  dependencies: (vars) => ['caddy'],           // runs before this cube
  secrets: ['API_TOKEN'],                      // must be schema keys
  schema: z.object({
    DOMAIN: z.string().describe('Public domain for the site').default('example.com'),
    PORT: z.number().describe('Upstream port').default(3000),
    API_TOKEN: z.string().describe('Deploy token for the app'),  // no default → required
  }),
});
```

Schema rules:

- `.describe()` is the prompt label — set it on every field.
- `.default()` gives the field a value at the lowest priority. A field
  **without** a default is required: interactive runs prompt for it, and a
  `--use-defaults` run fails naming it unless `env` or a dependency supplies
  it. Leave defaults off values that must not be guessed (a public key, a real
  credential). Defaults may be functions (`.default(() => ...)`).
- `secrets` entries must name schema keys; anything else is a manifest error.
  Secrets are masked in all output, never written to sessions or history,
  re-prompted on replay, and delivered only to cubes whose schema declares
  them. A `.default()` on a secret is plain text in the repo — use a
  placeholder like `changeme` or none at all.
- `dependencies` is a function of the *collected* variables, so it can be
  conditional. Each entry is an id or `[id, {VAR: value}]` to pass parameters;
  passed parameters outrank everything, including the user's prompt answers.
- `before` / `after` are hook arrays: `(ctx, vars) => {}` where
  `ctx.exec(id, vars)` schedules another cube (before or after this one).
  Use dependencies for static requirements, hooks for conditional
  orchestration and explicit parameter passing.

`deploy.py` — a plain pyinfra script. Every schema key is guaranteed present on
`host.data`:

```python
from pyinfra import host
from pyinfra.operations import apt, files, systemd

DOMAIN = str(host.data.DOMAIN)
PORT = host.data.PORT          # arrives as int — pyinfra parses --data values

files.template(
    name='Write Caddyfile site',
    src='Caddyfile.j2',        # relative to the cube directory (its cwd)
    dest=f'/etc/caddy/sites/{DOMAIN}',
    domain=DOMAIN, port=PORT,
    _sudo=True,
)

systemd.service(name='Reload caddy', service='caddy', reloaded=True, _sudo=True)
```

**`--data` value coercion**: pyinfra parses values before the script sees them —
`"true"`/`"false"` become booleans, numeric strings become `int`, valid JSON
becomes the parsed structure, everything else stays a string. Wrap in `str()`
before string operations; pass booleans/ints straight through.

**pyinfra essentials**: operations live in `pyinfra.operations.*` (`apt`,
`server`, `files`, `systemd`, `git`, `python`, …) and are declarative — they
gather facts and no-op when the host already matches, so a well-written cube is
idempotent and safe to re-run. Global arguments like `_sudo=True`,
`_env={...}`, `_ignore_errors=True` work on every operation. Facts:
`host.get_fact(...)` from `pyinfra.facts.*`. Full reference:
<https://docs.pyinfra.com/>.

## Variables and precedence

A variable can be assigned from several places in one run; every assignment is
kept and tagged with an **origin**, and the highest-ranked origin wins:

| Rank | Origin | Set by |
| --- | --- | --- |
| 0 | `default` | the schema's `.default()` |
| 1 | `env` | the merged `env` block of `.nopyrc.json` |
| 2 | `session` | a replayed session file or history entry |
| 3 | `prompt` | what the user typed |
| 4 | `param` | a dependency spec or a hook's `exec()` |

Consequences worth knowing:

- `env` beats defaults, so `.nopyrc.json` steers `--use-defaults` runs.
- A recorded session beats current `env` and current defaults — replay is
  faithful, not re-derived. Editing a default does not change what a replay
  does; record a fresh session to pick it up.
- A key supplied by a dependency (`param`) is never prompted for and never
  clobbered by a stale recording.
- Ordinary `env` values reach every cube (a cube may read keys its schema never
  declared); declared secrets reach only cubes whose schema names them.

## Hosts, connectors, and auth

The host picker offers the configured `hosts`, a free-form `custom` entry, and
two connector shortcuts:

- **`@docker/<name-or-image>`** — a running container is mutated in place; an
  image reference starts a throwaway container, applies the deploy, and commits
  the result as a new image. Which one is meant is decided by the docker
  connector (container match first).
- **`@vagrant/<machine>`** — deploys into a Vagrant machine.

Connector strings can be written directly into `hosts`. Auth methods: password
(prompts for user + password; becomes `--user <u> --password <p>`, masked in
output, never recorded), SSH key (`-K`; nopy passes nothing — pyinfra uses your
SSH config/agent), and `ssh` (session-recorded value meaning the connector owns
auth — what `@docker/` and `@vagrant/` hosts get, which is why replaying one
asks for nothing).

## Execution model

Per selected cube (dependencies first, post-order = topological order, cycles
reported by name), nopy builds and spawns — without a shell —

```
pyinfra <host> -y [-v|-vv|-vvv] [--debug] [--user U --password P] \
  --data KEY=value ... --chdir <cubeDir> <cubeDir>/deploy.py
```

Commands run **sequentially** with inherited stdio, stopping at the first
failure unless `--continue-on-error`. There is no rollback: cubes that already
succeeded stay applied, cubes queued after the failure are skipped and not
reported as failed. A cube already emitted for the same (cube, host) pair is
not emitted twice.

## Sessions, history, and replay

Every completed run (including failed ones) is auto-recorded to
`.nopy.history.json` in the working directory — per-project, newest-first,
rotating at `history.maxSessions`. Not recorded: `--dry-run`, `--print-only`,
`--no-save-history`, empty selections, and `-R`/`-H` replays themselves.

A session records the **full snapshot**: selected cubes with every variable
value they settled on (whatever the origin), hosts, auth method and username.
Never recorded: the SSH password and any declared secret — both re-prompted on
replay. A replay also prompts for the host when none was recorded and for
required keys the schema gained since recording. `-D` combined with a replay
that would have to prompt fails naming the keys instead of deploying a
placeholder.

Session files (`-s` / `-l`) use the same JSON structure as history entries and
are the way to keep a run indefinitely — history rotates. `nopy history --json`
is how scripts find ids for `-H`.

## CI and unattended runs

```sh
nopy install --print-only > plan.txt   # the commands, nothing else, stdout only
nopy install -D -K                     # no prompts: defaults + env, SSH key auth
nopy install -l ci.nopysession.json -D # replay a checked-in session
```

- stdout carries only deploy commands and pyinfra output; all nopy chatter is
  stderr. The exit code is the verdict. There is deliberately no `--json` on
  `install`.
- Values a `-D` run needs beyond schema defaults go under `env` in
  `.nopyrc.json`; sensitive ones also under config `secrets` so they stay
  masked and travel only to cubes that declare them.
- Secrets are still visible in the process table while pyinfra runs (`--data`
  is argv) and in the prompt UI — `secrets` protects nopy's files and output,
  nothing more.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `No .nopyrc.json found` | run `nopy init`, or create the file in the project or a parent |
| spawn failure on first deploy | `pyinfra` not on `PATH` — `pipx install pyinfra` |
| `Duplicate cube id '<id>' from 2 sources` | two sources claim one id; rename one or drop a source — there is no precedence |
| cube package errors at startup | a `cubePackages` entry is not installed, has no `cubes/` dir and no `nopy.cubes` override, or points outside itself — all hard errors |
| `cannot run with --use-defaults: <KEYS>` | required keys with no default; set them under `env`, pass from a dependency, or drop `-D` |
| replay aborts `Cube not found: <id>` | the cube was renamed/deleted since recording; the entry is unreplayable |
| replay asks for a value | it is a declared secret (never recorded) or a key added to the schema since the recording |
| variable arrives wrong-typed in Python | pyinfra parsed the `--data` value; `str()` it before string ops |
| error hides its stack | set `NOPY_DEBUG=1` |

## Core cube bundle

`@bitsquare/nopy-cubes-core` ships these cubes (snapshot — enumerate the
installed bundle's `cubes/` directory for the authoritative list). Add it with
`"cubePackages": ["@bitsquare/nopy-cubes-core"]` after installing it into the
project.

| Id | Purpose |
| --- | --- |
| `admin:cockpit` | Cockpit web admin console |
| `admin:hostname` | set the hostname |
| `admin:locale` | configure system locale |
| `apt:essentials` | baseline apt packages (git, curl, ufw, …) |
| `apt:install` | install arbitrary apt packages |
| `armor:fail2ban` | fail2ban hardening |
| `armor:ssh` | SSH daemon hardening |
| `armor:ufw` | UFW firewall rules |
| `caddy` | Caddy web server base install |
| `caddy:spa` | serve a single-page app via Caddy |
| `git:clone` | clone a repository |
| `net:tailscale` | install and authenticate Tailscale |
| `net:wifi:access-point` | configure a Wi-Fi access point |
| `net:wifi:connection` | join a Wi-Fi network |
| `runtime:docker` | install Docker |
| `runtime:nodevm` | install a Node.js runtime |
| `service:autostart` | systemd autostart unit for a command |
| `ssh:authorize` | authorize an SSH public key |
| `ssh:keygen` | generate SSH keys |
| `ssh:keyman` | deploy keys managed by keyman |
| `user:add` | create a user (shell, groups, authorized key) |
| `user:edit` | modify an existing user |

## Further reading

- Installed package README: full CLI walkthrough, secrets semantics, channels.
- `docs/HOOKS.md`, `docs/CUBE-BUNDLES.md`, `docs/SESSION_FORMAT.md`,
  `docs/API.md` in the `@bitsquare/nopy` package.
- pyinfra: <https://docs.pyinfra.com/> (operations, facts, global arguments,
  connectors).
