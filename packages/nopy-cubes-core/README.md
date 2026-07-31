# @bitsquare/nopy-cubes-core

The core cube bundle for [nopy](https://www.npmjs.com/package/@bitsquare/nopy):
base packages, users, SSH, firewalling, networking, web serving and runtimes.

## Install

```sh
pnpm add -D @bitsquare/nopy-cubes-core@main \
  --@bitsquare:registry=https://gitea.bitsquare.dev/api/packages/BitSquare/npm/
```

**Both halves are required today.** This bundle has not been published to npmjs
yet, so it comes from the Gitea registry — and that registry publishes no
`latest` tag, so an *untagged* install resolves to nothing at all. Name `@main`
(a snapshot of every commit) or `@next` (a prerelease) explicitly. Point the
**scope** at Gitea rather than setting a bare `registry=`: Gitea serves
`@bitsquare` only and does not proxy npmjs, so everything else must keep
resolving from there. Reading needs no token while the repository is public.

Then name it in `.nopyrc.json`:

```json
{
  "hosts": ["web-1"],
  "cubePackages": ["@bitsquare/nopy-cubes-core"]
}
```

`nopy` resolves the package from the directory of the config file that named it
and scans its `cubes/` directory exactly as it scans a `cubeDirs` entry. Nothing
has to be linked or copied.

## What is in it

| Area       | Cube ids                                                            |
| ---------- | ------------------------------------------------------------------- |
| admin      | `admin:cockpit`, `admin:hostname`, `admin:locale`                    |
| packages   | `apt:essentials`, `apt:install`                                      |
| hardening  | `armor:fail2ban`, `armor:ssh`, `armor:ufw`                           |
| web        | `caddy`, `caddy:spa`                                                 |
| source     | `git:clone`                                                          |
| networking | `net:tailscale`, `net:wifi:access-point`, `net:wifi:connection`      |
| runtimes   | `runtime:docker`, `runtime:nodevm`                                   |
| services   | `service:autostart`                                                  |
| ssh        | `ssh:authorize`, `ssh:keygen`, `ssh:keyman`                          |
| users      | `user:add`, `user:edit`                                              |

Run `nopy` and pick from the list, or `nopy -P` to print the pyinfra commands
without executing them. Each cube directory has its own `README.md`.

## Cube ids are global

An id such as `apt:essentials` is claimed repo-wide, not per bundle: two cubes
with the same id — whichever sources they came from — abort the run with an
error naming both. Prefix your own cubes distinctly if you also point
`cubeDirs` at a local tree.

## The bundle is read-only

Under pnpm the installed files are hardlinked into the global store, so a cube
that writes next to its own `deploy.py` corrupts that store for every project on
the machine. Cubes here write to `/tmp` or to the remote host, never to their
own directory.

## License

MIT
