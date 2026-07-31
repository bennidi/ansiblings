# nodevm

**Install Node.js through nvm, for one user, with global packages**

## Purpose

Installs [nvm](https://github.com/nvm-sh/nvm) into a single user's home
directory, uses it to install one pinned Node.js version under an alias, and
installs a list of global npm packages for that user.

Per-user, not system-wide. Nothing is placed on the system `PATH`, and another
user on the same host is unaffected — which is the point: version pinning belongs
to whoever runs the app.

## What This Cube Does

1. **Installs build dependencies** with apt, as root — `build-essential`,
   `libssl-dev`, `libtool`, `cmake`, and the cairo/pango/png/jpeg/vips/rsvg/pixman
   headers that native addons need. The package index is refreshed first: a box
   nobody has updated lists .deb versions the mirror has already dropped.
2. **Installs nvm** for `USER` via the official install script, then
   `nvm install <VERSION>` and `nvm alias <ALIAS> <VERSION>`.
3. **Installs `GLOBAL_PACKAGES`** with `npm install -g`, as `USER`.

## Configuration

| Variable | Default | What it does |
| --- | --- | --- |
| `VERSION` | `v22.20.0` | the Node.js version nvm installs. A pin, not "latest LTS" — nvm's own version strings work, so `--lts` or `22` are accepted too. |
| `USER` | `vagrant` | the user nvm is installed **for**. Everything lands in that user's `~/.nvm`. |
| `ALIAS` | `nodelts` | the nvm alias pointing at `VERSION`, so later cubes and scripts can say `nvm use nodelts` without knowing the number. |
| `GLOBAL_PACKAGES` | `pm2 yarn local-web-server node-gyp inquirer execa @dotenvx/dotenvx` | space-separated, passed to one `npm install -g`. Setting it **replaces** the list rather than adding to it. |
| `SHELL` | `fish` | the login shell to install through — `fish` or `bash`. See below. |

### `SHELL`

nvm wires itself into whichever shell installed it, so this is not cosmetic.

- **`fish`** (default) additionally requires **Oh My Fish**, because loading nvm
  goes through the `omf install nvm` plugin. `user:add` installs both, which is
  the usual way a host arrives here. The cube fails with one line, before
  changing anything, if `SHELL=fish` on a host with no fish.
- **`bash`** needs nothing beyond bash. Use it on a host where `user:add` has not
  run.

The default stays `fish` so that an existing user — whose login shell `user:add`
set to fish — keeps getting a Node that their shell can actually see. Switching
would install it invisibly.

## Dependencies

None declared: the cube runs standalone. With `SHELL=fish` it does have a real
prerequisite (fish + Oh My Fish, which `user:add` provides), but `user:add` is
deliberately not a declared dependency — it would *create* a user who is normally
meant to already exist. `SHELL=bash` is the standalone path.

## Post-Installation

`node` is on `USER`'s `PATH` in a login shell, not in root's and not in a
non-interactive one. To check:

```bash
su - <USER> -c 'node --version && npm --version'
```

From a bash script that is not a login shell, load nvm first:

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"
nvm use nodelts
```

## PM2 — process manager

`pm2` is in the default `GLOBAL_PACKAGES`, so it is installed unless you replaced
the list.

```bash
pm2 start app.js              # Start application
pm2 list                      # List running apps
pm2 stop app                  # Stop application
pm2 restart app               # Restart application
pm2 logs                      # View logs
pm2 startup                   # Enable PM2 on boot
pm2 save                      # Save current process list
```

`pm2 startup` prints a `sudo` command to run; it does not enable itself.

## Notes

- Node.js is installed **per user**, under `~/.nvm` for `USER`.
- Global packages belong to that user too, not to everyone on the host.
- Run the cube again with a different `VERSION` and `ALIAS` to have several
  versions side by side; nvm is built for exactly that.
