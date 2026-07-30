# keyman — SSH key management with an age-encrypted vault

keyman keeps SSH private keys in a vault you can commit. Each key is encrypted
with [age](https://github.com/FiloSottile/age) to a single recipient — the vault's
identity file — which is the one thing that has to stay out of the repository.

It is an interactive menu rather than a set of subcommands: point it at a vault,
pick an operation, repeat until you quit.

## Requirements

`age`, `age-keygen` and `ssh-keygen` on `PATH`. keyman shells out to all three and
names the missing one instead of failing obscurely.

## Installing

```sh
npm install -g @bitsquare/keyman@main \
  --@bitsquare:registry=https://gitea.bitsquare.dev/api/packages/BitSquare/npm/
```

Point the **scope** at that registry rather than setting a bare `--registry`: it
serves `@bitsquare` packages only and does not proxy npmjs, so every other
dependency has to keep resolving from npmjs. Reading needs no token while the
repository is public, and the same line works with `pnpm`.

`@main` is a snapshot of the default branch, published on every push. Name a tag —
there is no `latest` on that registry yet, so an untagged install resolves to
nothing, and keyman has not been released to npmjs. `keyman self-update` keeps you
on whichever channel you installed from.

## Quick start

```sh
# The vault identity. The only secret in the vault, and the only thing here you
# cannot regenerate — back it up somewhere that is not this repository.
mkdir -p vault
age-keygen -o vault/age.key

# Run keyman against it.
VAULT_ROOT=./vault keyman
```

On startup keyman creates `keys/` and `tmp/` under the vault at `0700` and writes
a `.gitignore` beside them covering the identity and `tmp/`, so a fresh vault
cannot be committed by accident.

Then pick **🆕 Generate key**: it makes the key pair and encrypts it into the vault
in one step. `ssh-keygen` collects the passphrase itself — keyman never sees it, so
it can never put it on a command line.

## Operations

Every operation returns to the menu, so a session can run several.

- **📋 List keys** — every key it can see and where it is: encrypted in the vault,
  decrypted in `tmp/`, live in `~/.ssh`, or some combination.
- **📝 Copy public key** — the public half of a key in `~/.ssh` or `tmp/`, to the
  clipboard via whichever of `pbcopy`, `clip`, `wl-copy`, `xclip` or `xsel` exists.
  With none of them, it prints the key instead.
- **🆕 Generate key** — an `ed25519` or 4096-bit `rsa` pair into `tmp/`, encrypted
  into the vault straight away.
- **🔒 Encrypt keys** — pick from the private keys in `~/.ssh` *and* `tmp/`; each
  goes to `<keysDir>/<name>/` with its public half beside it. A key that has no
  `.pub` file gets one derived with `ssh-keygen -y`. One key failing costs only
  that key.
- **🔓 Decrypt keys** — pick from the vault and decrypt to `tmp/` or `~/.ssh`.
  Never overwrites a file without asking first, and the plaintext key is `0600`
  from the moment it exists.
- **🔄 Rotate key** — a replacement for a vault key, encrypted *alongside* the
  original. See below.
- **🗑️ Retire key** — the other half of a rotation: delete a vault key and its
  plaintext copies, after listing every path that goes.
- **🧹 Clear decrypted keys** — remove the plaintext keys from `tmp/`.
- **❌ Quit**

### Listing

```
🔑 SSH Keys:

  Key Name                      [Vault] [Tmp] [.ssh]
  ──────────────────────────────────────────────────────────
  ✅ id_deploy (.pub)              [✓]   [ ]  [✓]
  🔓 id_github (.pub)              [✓]   [✓]  [ ]
  🔒 id_backup (.pub)              [✓]   [ ]  [ ]
  ⚠️  id_local (.pub)               [ ]   [ ]  [✓]

  Legend:
  ✅ = Managed (encrypted in vault + active in .ssh)
  🔓 = Decrypted (in vault + decrypted to tmp)
  🔒 = Encrypted only (in vault, not decrypted)
  ⚠️  = Unmanaged (in .ssh or tmp, not encrypted in vault)
```

`(.pub)` means a public key was found next to the private one, in either location.
The rows are sorted by name.

### Rotating a key

Rotation is deliberately two operations, because both keys have to exist at once:

1. **🔄 Rotate key**, and pick `prod`. keyman generates `id_prod-2` in `tmp/`,
   encrypts it to `keys/prod-2/`, and prints both public keys. `prod` is untouched.
2. Add the `prod-2` public key wherever `prod` is authorized.
3. Check that you can log in with `tmp/id_prod-2`.
4. Remove the `prod` public key from those hosts.
5. **🗑️ Retire key**, and pick `prod`.

The name has to change: the vault directory is derived from it, so a replacement
also called `prod` *is* the `prod` entry. Rotating again continues the series
(`prod-2` → `prod-3`), and a version already taken — in the vault, in `tmp/` or in
`~/.ssh` — is skipped rather than overwritten.

Doing it in one step instead is what this shape avoids: replace the key in the
vault and you have locked yourself out of the host you were rotating for, because
the replacement is not on it yet and the only copy of the key that is has gone.
Retiring warns when nothing in the vault supersedes the key, and then asks you to
type its name.

### The `id_` prefix

keyman manages keys named `id_*`; the vault directory for `id_prod` is `prod`.
A private key named anything else is not offered by any operation — but List, Copy
and Encrypt report the ones they found, with a count and the reason, so it is
never silently invisible. Rename it to `id_<name>` to bring it in.

## Command line

```
keyman — SSH key management and an age-encrypted key vault

Usage
  keyman                             start the interactive menu
  keyman self-update                 update keyman itself (alias: upgrade)

Flags
  -h, --help                         print this help and exit
  -V, --version                      print the version and exit
      --print-config                 print the resolved paths and the config files
                                     they came from, as JSON, and exit
      --self-update                  same as the self-update subcommand

Flags for self-update
      --channel <latest|next|main>   channel to update from
                                     (default: derived from the running version)
      --registry <url>               registry to query instead of the configured one
  -n, --dry-run                      print the install command without running it
  -f, --force                        reinstall even when already up to date

Environment
  VAULT_ROOT                         overrides vaultRoot from .keymanrc.json
  KEYMAN_REGISTRY                    registry for the update check and self-update
  KEYMAN_REGISTRY_TOKEN              bearer token for a private registry
  KEYMAN_NO_UPDATE_CHECK             set to 1 to skip the once-a-day update check
                                     (also skipped whenever CI is set)
  KEYMAN_PACKAGE_MANAGER             npm | pnpm | yarn | bun for the install command

Configuration is read from .keymanrc.json, merged from the current directory
upwards and then from ~/.keymanrc.json.
```

The update channel is derived from the version you are running — a `-main.` build
checks `main`, any other prerelease checks `next`, a clean version checks `latest`
— so an update cannot quietly move you to a different channel. The check runs at
most once a day and prints its hint to **stderr**, which keeps `--print-config`
machine-readable.

## Configuration

`.keymanrc.json`, with every key optional:

```json
{
  "vaultRoot": "vault",
  "keysDir": "keys",
  "tmpDir": "tmp",
  "ageKeyFile": "age.key"
}
```

| key          | default    | meaning                                              |
| ------------ | ---------- | ---------------------------------------------------- |
| `vaultRoot`  | `vault`    | the vault directory; everything else lives inside it |
| `keysDir`    | `keys`     | the encrypted keys — the part that is safe to commit |
| `tmpDir`     | `tmp`      | decrypted keys, in plaintext                         |
| `ageKeyFile` | `age.key`  | the age identity the vault encrypts to               |

The last three are resolved against `vaultRoot` unless they are absolute. A
relative `vaultRoot` **in a config file** is resolved against that file's
directory, so a repository config keeps meaning the same vault from any
subdirectory; the built-in default is resolved against the current directory.

Files are read from `~/.keymanrc.json` first, then from the filesystem root down
to the current directory, so the nearest file wins key by key. `VAULT_ROOT` in the
environment beats all of them. A file that is not valid JSON is skipped with a
warning rather than taken as fatal, and a key keyman does not know is reported
instead of silently dropped — `{"vaultroot": "…"}` used to be indistinguishable
from an empty file.

`keyman --print-config` answers what all of that resolved to, and which files it
came from:

```sh
$ keyman --print-config
{"vaultRoot":"/srv/infra/vault","keysDir":"/srv/infra/vault/keys","tmpDir":"/srv/infra/vault/tmp","keyPath":"/srv/infra/vault/age.key","configFiles":["/srv/infra/.keymanrc.json"]}
```

## Vault layout

```
project/
├── vault/
│   ├── .gitignore      # written by keyman: the identity and tmp/, not keys/
│   ├── age.key         # the vault identity (NEVER commit)
│   ├── keys/           # encrypted keys (safe to commit)
│   │   └── deploy/         # one directory per key, named without the id_ prefix
│   │       ├── id_deploy.age   # the private key, encrypted to the vault recipient
│   │       └── id_deploy.pub   # the public key
│   └── tmp/            # decrypted keys (NEVER commit)
│       ├── id_deploy
│       └── id_deploy.pub
└── .keymanrc.json      # optional
```

With a custom `keysDir` or `tmpDir`, those two names change and nothing else does.

## Practices this tool assumes

1. **Back up `age.key`** somewhere outside the repository. It is the only thing
   that can decrypt the vault, and nothing in the vault can reconstruct it.
2. **Commit `keys/`.** Encrypted keys are the point; a vault nobody shares is a
   directory.
3. **Do not commit the identity or `tmp/`.** keyman writes a `.gitignore` for
   this, and never overwrites one you wrote yourself — check it if you brought
   your own.
4. **Clear `tmp/` when you are done with it** (🧹), so plaintext keys do not
   outlive the reason they were decrypted.
5. **Keep `.keymanrc.json` in the project root** so everyone resolves the same
   vault, and use `VAULT_ROOT` for the exceptions.

## Upgrading from a version before 0.7.0

`keysDir` and `tmpDir` used to be honoured by some operations and ignored by
others, which left anyone with custom names holding a **split vault**: `generate`
and `list` used the configured directories while `encrypt` and `decrypt` used
`<vaultRoot>/keys` and `<vaultRoot>/tmp`. All of them agree now, so anything
written by the old `encrypt` needs moving once:

```sh
mv <vaultRoot>/keys/* <vaultRoot>/<keysDir>/
```

Nobody on the default names is affected — for them the two halves were the same
directory all along.
