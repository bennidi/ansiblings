# @bitsquare/cubes-core

The core cube bundle for [nopy](https://www.npmjs.com/package/@bitsquare/nopy):
base packages, users, SSH, firewalling, networking, web serving and runtimes.

## Install

```sh
pnpm add -D @bitsquare/cubes-core
```

Then name it in `.nopyrc.json`:

```json
{
  "hosts": ["web-1"],
  "cubePackages": ["@bitsquare/cubes-core"]
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
