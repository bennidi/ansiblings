# keyman audit

A review of `packages/keyman` for defects, unimplemented features, and drift
between the code and the documents that describe it.

Severity is about what it costs a user:

- **🔴 broken** — normal use produces a crash, data loss, or a silently wrong result.
- **🟠 misleading** — the code or a document states something that is not true.
- **🟡 gap** — something real that nothing mentions, or dead weight nobody uses.

Verified against `75983ab` with no uncommitted changes in the package. Line
numbers are from that state. Findings marked **verified** were reproduced by
running the code, not inferred from reading it; the reproduction is quoted.

Baseline: 162 tests pass, 98.9 % lines / 96.2 % branches. High coverage is
context for §1.2, not a defence of it.

---

## Contents

- [1. Defects](#1-defects)
- [2. Security](#2-security)
- [3. Unimplemented and dead](#3-unimplemented-and-dead)
- [4. Public API and packaging](#4-public-api-and-packaging)
- [5. Documentation drift](#5-documentation-drift)
- [6. Checked and accurate](#6-checked-and-accurate)
- [Suggested order of attack](#suggested-order-of-attack)

---

## 1. Defects

### 1.1 🔴 `keysDir` and `tmpDir` are honoured by half the tool

`resolveConfigPaths()` (`keyman.config.ts:249-259`) resolves all four paths from
the config, and `keyman.main.ts:18-21` prints them. But dispatch is inconsistent
about what it hands each operation:

| Operation | receives | uses |
| --- | --- | --- |
| `listKeys` (`main.ts:67`) | `paths.keysDir` | the configured directory |
| `generateKey` (`main.ts:73`) | `paths.keysDir`, `paths.tmpDir` | the configured directories |
| `copyKey` (`main.ts:70`) | `paths.tmpDir` | the configured directory |
| `encryptKeys` (`main.ts:76`) | `paths.vaultRoot` | **hardcoded** `<vaultRoot>/keys` (`encrypt.ts:38`) |
| `decryptKeys` (`main.ts:84`) | `paths.vaultRoot` | **hardcoded** `<vaultRoot>/keys` (`decrypt.ts:7`) and `<vaultRoot>/tmp` (`decrypt.ts:39,43`) |

With the defaults the two halves agree, which is why this is invisible. Set
either sub-directory and the vault splits in two.

**Verified.** With `{"vaultRoot":"./v","keysDir":"encrypted","tmpDir":"plain"}`,
`keyman --print-config` reports:

```json
{"...":"...","keysDir":"…/v/encrypted","tmpDir":"…/v/plain","keyPath":"…/v/age.key"}
```

so `generate` writes to `v/encrypted/<name>/` and `list` scans `v/encrypted`,
while `encrypt` writes to `v/keys`, and `decrypt` reads `v/keys` and writes
`v/tmp` — never touching either configured directory. Concretely:

- encrypt a key, then list it → the list shows nothing in `[Vault]`.
- generate a key, then decrypt it → "⚠️ No encrypted keys found."
- decrypt to local, then encrypt → the key is not offered, because `encrypt`
  reads the configured `tmpDir` while `decrypt` wrote to the hardcoded one.

No error at any point. The user has two vaults and one of them is invisible to
whichever operation they try next.

The current behaviour is locked in by tests: `main.test.ts:164-187` asserts
`vaultRoot` is what encrypt and decrypt receive ("encrypts keys into the vault
root"), and `encrypt.test.ts:95` / `decrypt.test.ts:53` assert the literal
`keys` segment. Fixing this means changing those assertions.

**Fix.** Pass `paths.keysDir` and `paths.tmpDir` into `encryptKeys` and
`decryptKeys` and delete the three `path.join(vaultDir, 'keys' | 'tmp')` calls.
Neither function has a use for `vaultRoot` once that is done, so the parameter
goes away rather than becoming a second source of truth.

See also §5.1 — `DOCS-AUDIT.md` currently lists this layout under *checked and
accurate*.

### 1.2 🔴 Encrypt and decrypt crash with a raw stack trace on a first run

Three `readdirSync` calls have no `existsSync` guard:

- `encrypt.ts:13` — `~/.ssh`, which nothing creates.
- `encrypt.ts:16` — the tmp directory.
- `decrypt.ts:8` — `<vault>/keys`, which nothing creates either.

`keyman.main.ts:40-41` creates `vaultRoot` and `tmpDir`. It does **not** create
`keysDir`, so `decrypt` on a fresh vault throws instead of printing its
"⚠️ No encrypted keys found." message — the message is unreachable until the
directory exists for some other reason.

**Verified**, calling both functions directly against a vault laid out the way
`main.ts` lays it out:

```
--- A: decryptKeys with no vault/keys directory ---
THREW: Error ENOENT ENOENT: no such file or directory, scandir '…/vault/keys'
--- B: encryptKeys with no ~/.ssh directory ---
THREW: Error ENOENT ENOENT: no such file or directory, scandir '…/home/.ssh'
```

What the user sees is worse than the exception, because of `keyman.cli.ts:82`:

```ts
keyman();
```

Not awaited, no `.catch`. Any rejection anywhere in the menu loop becomes an
unhandled rejection: Node prints the stack and exits non-zero, and the menu loop
— whose whole point (`README.md:97`) is that you can run several operations in
one session — is gone.

`copyKey` guards (`copy.ts:8`) and `listKeys` guards all three of its
directories (`list.ts:22,50,78`). Encrypt and decrypt are the outliers, not the
rule.

Worth noting where the coverage numbers sit: `keyman.encrypt.ts` and
`keyman.decrypt.ts` are both at **100 % lines, 100 % branches**. Every test
creates the directories in `beforeEach` (`encrypt.test.ts:46-47`,
`decrypt.test.ts:54-55`), so the missing guard is not a branch that went
uncovered — it is a branch that was never written. Line coverage measures lines
executed, not inputs considered.

**Half closed (Phase 1).** `keyman()` is now awaited inside a `catch`, so a
rejection is one line rather than an unhandled-rejection stack trace. The missing
`existsSync` guards — and with them the menu loop surviving a failed operation —
are Phase 2.

### 1.3 🔴 A missing `age.key` becomes `age -r null`

`keyman.main.ts:73` and `:80` assert away a null:

```ts
extractAgePublicKey(paths.keyPath)!
```

`extractAgePublicKey` returns `string | null` (`utils.ts:8-22`) and returns null
in three cases: the file is missing, it is unreadable, or it parses but has no
`# public key:` line. In all three it prints an error and returns — and the
non-null assertion carries that null straight into an `execa` argv.

**Verified**, both halves:

```
❌ ERROR: Age key file not found at /nope/age.key
extractAgePublicKey(missing) = null
execa with null recipient THREW: ExecaError | Command failed with exit code 1: age -r null -o /tmp/x.age /etc/hosts
```

execa stringifies the null, so the recipient becomes the literal `"null"`.

The two call sites fail differently, and the generate path fails worse:

- `generateKey` runs `ssh-keygen` **first** (`generate.ts:59`) and `age` second
  (`generate.ts:68`). Its `try/catch` swallows the failure into "❌ Error
  generating/encrypting key", but by then the private key is on disk in `tmpDir`
  in plaintext, and the user has been told the operation failed. Nothing tells
  them a key was left behind.
- `encryptKeys` has no `try/catch` at all, so it takes the §1.2 path: unhandled
  rejection, stack trace, session over.

**Fix.** Resolve the recipient once, before dispatch, and treat null as a
recoverable condition: print what to run (`age-keygen -o <keyPath>`) and return
to the menu. The type already says this is possible; the `!` is the only thing
claiming otherwise.

### 1.4 🔴 Decrypting into `~/.ssh` silently overwrites an existing key

`decrypt.ts:47-49` writes the decrypted key and copies the public key with no
existence check, no confirmation, and no backup.

**Verified** that `age -o` does not refuse an existing file:

```
before: PRECIOUS EXISTING KEY
age -o exit=0 (overwrote)
after: secret
```

So selecting `prod` with the `SSH (~/.ssh)` destination replaces
`~/.ssh/id_prod` outright. If the vault copy is stale, or the folder name
happens to collide with an unrelated local key, the local key is gone — and this
is the one operation in the tool that writes outside the vault, into the
directory the user's actual SSH access depends on.

The `Local (vault/tmp)` destination has the same behaviour but a much lower cost,
since `vault/tmp` is scratch space by design.

**Fix.** Check both output paths before decrypting anything and prompt per
collision, or refuse and name the file. A `--force` equivalent can come later;
the current default should not be "overwrite".

### 1.5 🟠 `age` or `ssh-keygen` missing is unhandled in encrypt and decrypt

Same missing `try/catch` as §1.3. `generateKey` (`generate.ts:51-76`) and
`copyKey` (`copy.ts:43-57`) both wrap their `execa` calls and report a failure;
`encryptKeys` and `decryptKeys` do not. On a machine without `age` on `PATH` —
the one hard external requirement, per `CLAUDE.md` — choosing Encrypt from the
menu produces an `ENOENT` stack trace rather than "install age".

### 1.6 🟠 Encrypt copies `.pub` unconditionally and aborts the batch midway

`encrypt.ts:45`:

```ts
fs.copyFileSync(`${keyPath}.pub`, path.join(vaultPath, `${key}.pub`));
```

The selection list is built from *private* keys only (`encrypt.ts:14,17` filter
out `.pub`), so a private key with no `.pub` sibling is offered — and that is a
legal state, since `ssh-keygen -y` regenerates a public key on demand and people
do delete them.

When it happens, `age` has already written the `.age` file, so the throw leaves
the vault holding an encrypted key with no public key. Worse, the throw escapes
the `for` loop: every remaining selected key is skipped, with no output saying
so, and the process dies via §1.2.

`generate.ts:71` has the same shape but is far less likely to fire, since
`ssh-keygen` just wrote the file.

**Fix.** Derive the public key with `ssh-keygen -y -f <key>` when the sibling is
absent, and wrap the loop body so one bad key costs one key rather than the
batch.

### 1.7 🟠 `/home/<user>` is hardcoded

`keyman.main.ts:33`:

```ts
const homeDir = user === '@current' ? process.env.HOME || '' : `/home/${user}`;
```

On macOS other users live under `/Users/`, and this tool is otherwise
macOS-specific (§1.9). Nothing checks the directory exists, so a wrong guess
feeds a nonexistent `sshDir` into §1.2 rather than into an error message.
`main.test.ts:198-204` locks in `/home/deploy/.ssh`.

**Fix.** `os.userInfo()` for the current user, and for a named user either look
the home directory up (`getent passwd` / `dscl`) or ask for the path outright.
Failing that, check `existsSync` and say so.

### 1.8 🟡 Keys not named `id_*` are invisible, silently

Every discovery filter requires the prefix: `copy.ts:9`, `encrypt.ts:14,17`,
`list.ts:23,51`, and `decrypt.ts:9` reconstructs `id_${dir}`. A key called
`deploy_ed25519` cannot be listed, copied, or encrypted, and nothing says why —
it simply is not in the menu.

`generateKey` enforces the prefix (`generate.ts:43`), so keys keyman creates are
always fine. The gap only bites pre-existing keys, which is exactly the
population a key manager is adopted to take over.

### 1.9 🟡 `pbcopy` is hardcoded

`copy.ts:49`, with the comment above it admitting the shortcut:

```ts
// Since the environment is Darwin, we prioritize pbcopy, but we can add others for completeness
```

On Linux or Windows, Copy public key always fails. It fails *cleanly* — the
`try/catch` reports "❌ Failed to copy to clipboard" — but the package declares
only `"node": ">=22"` in `engines` and the README says nothing, so nothing warns
before install. `xclip`/`wl-copy`/`clip.exe` by platform is a handful of lines;
alternatively print the key to stdout as a fallback so the operation is never a
dead end.

### 1.10 🟡 Smaller things

- **`listKeys` throws on a broken symlink.** `list.ts:80` calls `fs.statSync` on
  every entry in the keys directory; a dangling symlink throws `ENOENT`, and
  `listKeys` has no `try/catch`, so it exits via §1.2. `lstatSync`, or a
  `withFileTypes` readdir, or a guard.
- **`key.replace('id_', '')` is unanchored** (`encrypt.ts:38`, `generate.ts:63`).
  Every input is prefix-filtered today, so the first match *is* the prefix and
  the behaviour is correct — it is a trap left for whoever loosens §1.8.
  `replace(/^id_/, '')` costs nothing.
- **An `age` failure leaves an empty vault directory.** `generate.ts:65` creates
  `<keysDir>/<name>/` before `generate.ts:68` runs `age`.
  `generate.test.ts:150-163` asserts the `.pub` is absent afterwards but not the
  directory, so this passes today. It makes the folder show up in
  `decrypt`'s scan as a candidate that filters back out — harmless, untidy.
- **Debug output still in shipped code.** `encrypt.ts:18-19`
  (`console.log(tmpKeys); console.log(sshKeys);`) is already tracked as
  `DOCS-AUDIT.md` §6.4. `decrypt.ts:10` — a `console.log(keyfile)` *inside a
  `filter` callback*, printing one line per vault directory — is not, and is the
  more visible of the two.

---

## 2. Security

### 2.1 🔴 Decrypted private keys are world-readable before the chmod

`decrypt.ts:47-50` decrypts, then copies, then chmods — in three separate
processes:

```ts
await execa('age', ['-d', '-i', ageKey, '-o', privateKeyOut, encryptedKey]);
await execa('cp', [publicKey, publicKeyOut]);
await execa('chmod', ['600', privateKeyOut]);
```

**Verified** what `age` creates, and what `mkdirSync` at `main.ts:41` creates:

```
-rw-r--r--  …/out                     ← the decrypted private key, as age leaves it
drwxr-xr-x  …/tmpdir                  ← vault/tmp, as keyman creates it
```

So a plaintext private key exists at `0644` for the lifetime of two process
spawns, inside a `0755` directory any local user can traverse. If the `chmod`
fails or the process is killed in between, it stays `0644` — and because
`decryptKeys` has no `try/catch` (§1.5), a failing `chmod` also kills the
session before the next key is even attempted.

**Fix.** `fs.chmodSync` immediately after `age` returns rather than a third
spawn; create `tmpDir` with `{mode: 0o700}` and `~/.ssh` likewise if it is
missing. Replacing `cp` and `chmod` with `fs.copyFileSync` / `fs.chmodSync` also
removes two shell-outs that do not work on Windows and cuts three spawns per key
to one.

### 2.2 🟠 The passphrase is passed on the `ssh-keygen` command line

`generate.ts:53`:

```ts
const args = ['-t', algorithm, '-f', keyPath, '-N', password, '-C', identity];
```

argv is world-readable on both Linux (`/proc/<pid>/cmdline`) and macOS
(`ps -o command`) for the lifetime of the process. Any other user on the machine
can read the passphrase of a key being generated. `generate.test.ts:78-87`
asserts this exact argv.

**Fix.** Omit `-N` entirely and let `ssh-keygen` prompt on the tty — it already
asks twice and confirms, so keyman's own password prompt (`generate.ts:26-33`)
can go away rather than being replaced. That keeps the passphrase off argv
without keyman ever holding it.

### 2.3 🟠 The age recipient is trusted from a comment, never verified

`extractAgePublicKey` (`utils.ts:16`) regexes the recipient out of a comment
line in the identity file:

```ts
fileContents.match(/^# public key:\s*(age1[^\s]+)/m)
```

Nothing checks it corresponds to the private key in that same file. Edit the
comment — or concatenate two key files — and every subsequent encryption goes to
a recipient the local identity cannot decrypt. The failure surfaces only later,
at decrypt time, on keys that may no longer exist in plaintext anywhere.

**Fix.** `age-keygen -y <keyPath>` derives the public key *from the private key*
and is exactly the tool for this. Note that `age-keygen` is currently not
invoked anywhere in the source, despite `CLAUDE.md` listing it among the
binaries keyman shells out to (§5.5).

### 2.4 🟡 Nothing manages the plaintext left in `vault/tmp`

Decrypted keys accumulate in `vault/tmp` indefinitely. There is no shred
operation, no warning on exit, and keyman never writes the `.gitignore` its own
README (`README.md:25-26`, `:148`) tells the user to write by hand. The only
signal is the 🔓 marker in `listKeys`, which the user has to go looking for.

A "Clear decrypted keys" menu entry and a `.gitignore` written alongside the
vault on first run would cost little and close the most likely way a private key
reaches a public repository — which is the threat this tool exists to address.

---

## 3. Unimplemented and dead

### 3.1 🟠 There is no `--help`

`keyman.cli.ts` handles `--print-config`, `--version`/`-V`, and
`self-update`/`upgrade`, then falls through to the interactive session. `--help`
is not among them, and neither is any unknown-flag handling.

**Verified.** `keyman --help` with no tty:

```
📁 Vault Root: …
? Specify USER (default: @current): (@current)
…/@inquirer/core/dist/lib/create-prompt.js:67
            reject(new ExitPromptError(`User force closed the prompt with ${code} ${signal}`));
```

Two problems in one output. `--help` starts a session instead of describing the
tool, and because of §1.2 the resulting `ExitPromptError` is an unhandled
rejection with a stack trace. That second half is what a user gets from **Ctrl-C
at any prompt** — the normal way to leave an interactive CLI produces a crash
dump.

`keyman --vault foo` is likewise accepted and ignored.

**Fix.** `--help` listing the flags, the two subcommands, and the `KEYMAN_*`
environment variables (§5.3); an unknown-flag error; and a `catch` in
`keyman.cli.ts` that treats `ExitPromptError` as "goodbye" and anything else as
a one-line error. nopy uses Commander for this; keyman need not, but it does
need the behaviour.

**Closed (Phase 1).** `src/keyman.args.ts` owns the parse and the help text; the
`catch` around `keyman()` in `keyman.cli.ts` turns `ExitPromptError` into
"👋 Goodbye!" and exit 0, and anything else into one line and exit 1.

### 3.2 🟡 `flagValue` accepts things that are not values

`keyman.cli.ts:24-27` is `args.indexOf(name)` and `args[index + 1]`:

- `--channel=main` is not recognised.
- `--channel` as the last argument yields `undefined`.
- `keyman self-update --channel --force` sets the channel to `"--force"`, which
  is cast to `Channel` (`cli.ts:47`) and flows into the dist-tag lookup at
  `update.ts:176` as a key that cannot exist. The registry answers, the tag is
  absent, and the user is told "Could not reach <registry>" — which is false.

Validating against the three legal channels would turn all three into one clear
error.

**Closed (Phase 1).** `parseArgs` accepts both `--flag value` and `--flag=value`,
rejects a flag swallowed as another flag's value, and validates `--channel`
against `CHANNELS`.

### 3.3 🟡 The `resolution` merge machinery has no effect

`keyman.config.ts` carries `ResolutionStrategy`, `KeymanResolutionConfig`,
`mergeValue` and `mergeConfigs` — roughly 45 lines, imported from nopy's design.
Every property in `KeymanConfigSchema` is a `z.string()`. For two strings,
`mergeValue` returns `childValue` in the `override` branch (`:121-123`) and
returns `childValue` again from the primitive fallthrough (`:156`). The two
strategies are indistinguishable for every key the schema permits, and the
array-concat and deep-merge branches are unreachable through a valid config —
unknown keys pass through the merge but are then stripped by
`KeymanConfigSchema.parse` (§3.5).

So the documented knob does nothing. The doc comment at `:186-194` advertises it:

```json
{ "vaultRoot": "../vault", "resolution": { "vaultRoot": "override" } }
```

and `config.test.ts:212` — "honours an explicit override strategy" — passes for
a case where plain merge gives the same answer, so the test does not distinguish
them either.

This is a choice to make, not a bug to fix. Either drop the machinery and the
comment, or keep it deliberately as the shape a future object-valued or
array-valued option would need — and say so in a comment, since right now it
reads as functional.

### 3.4 🟡 `getConfigPaths()` is exported, tested, and called by nothing

`keyman.config.ts:265` is used only by `config.test.ts:122,131`. It is not
re-exported from `src/index.ts` and not called by the CLI. nopy's equivalent
feeds `nopy.main.ts:64`.

The absence is felt: `--print-config` prints the *resolved paths* only, so there
is no way to ask which config files were consulted. That information exists only
as a stderr side effect of `loadConfig` ("✅ Loaded configuration from …"), which
is not machine-readable and is interleaved with warnings. Folding
`getConfigPaths()` into the `--print-config` JSON makes the function earn its
keep and makes the escape hatch answer the question it is for.

### 3.5 🟡 A typo in `.keymanrc.json` is silent

`KeymanConfigSchema` is a plain `z.object`, which strips unknown keys.

**Verified.** With `{"vaultRoot":"./v","vaultroot":"typo", …}`, the lowercase key
is dropped without a word and `--print-config` reports the vault from the
correct key. Had only the typo been present, the user would get the `vault`
default and no clue.

`.strict()` — or keeping the strip and logging the leftover keys as a warning —
turns a silently wrong vault into one line of output. Since `loadConfig` already
degrades to defaults rather than throwing, a warning fits the module's existing
posture better than a hard failure.

### 3.6 🟠 "Support for key rotation" does not exist

`README.md:11`. `grep -rn "rotat" packages/keyman/src/` returns nothing. Already
tracked as `DOCS-AUDIT.md` §2.10, still open. Rotation is a genuinely useful
operation for this tool — generate a replacement, encrypt it, keep the old one
until the new one is deployed — so this is worth building rather than deleting.

### 3.7 🟡 "Copy public key and create README"

`encrypt.ts:44` says it; no README is written. Suggestively,
`decrypt.test.ts:75` places a `README.md` inside the keys directory as a
fixture, so a per-key README appears to have been the intent once. Either build
it or drop the half of the comment that lies.

---

## 4. Public API and packaging

### 4.1 🟡 A shebang on the library entry point

`src/index.ts:1` is `#!/usr/bin/env node`. The bin is `dist/keyman.cli.js`
(`package.json:28`); `index.ts` is the `exports["."]` target and is only ever
imported. nopy's `src/index.ts` has no shebang. Harmless, and a copy-paste
artefact.

### 4.2 🟡 The exported functions' types are not exported

`src/index.ts:2` exports `loadConfig` and `resolveConfigPaths`. It does not
export `KeymanConfig`, `KeymanConfigFile`, `ResolutionStrategy` or
`KeymanResolutionConfig`, so a TypeScript consumer cannot name what `loadConfig`
returns or what `resolveConfigPaths` takes. This is the same one-line omission
`CLAUDE.md` already records for nopy's `CubePackageRef`.

### 4.3 🟡 `export * from './keyman.main.js'` exports only `keyman()`

The five operation modules and `extractAgePublicKey` are not on the public
surface, so the package is consumable as a library only as "run the entire
interactive menu". That may well be intended — but then `loadConfig` and
`resolveConfigPaths` being exported is the odd part, since a consumer can obtain
the paths and do nothing with them.

### 4.4 🟡 Update-module constants are half re-exported

`keyman.update.ts` exports `SCOPE`, `UPDATE_CACHE_DIR`, `UPDATE_CACHE_FILE`,
`DEFAULT_FETCH_TIMEOUT_MS` and `DEFAULT_CONFIG_TIMEOUT_MS`; `src/index.ts:12-31`
re-exports neither, while re-exporting `DEFAULT_CHECK_INTERVAL_MS` and
`NPMJS_REGISTRY`. Pick one rule.

---

## 5. Documentation drift

### 5.1 🟠 `DOCS-AUDIT.md` lists §1.1 under *checked and accurate*

`DOCS-AUDIT.md:826-827`:

> **keyman config** — priority (`VAULT_ROOT` > file > defaults), the four default
> values, and the vault layout match `keyman.config.ts` and `keyman.encrypt.ts`.

The first two clauses are correct. The third holds only because
`keyman.encrypt.ts` hardcodes `keys` — checking the documented layout against
the file that ignores the config is what made §1.1 invisible. The entry should
move out of section 7 and point at §1.1.

### 5.2 🟠 `README.md` operations list — still open

`DOCS-AUDIT.md` §2.10, re-verified: `README.md:90-96` lists four menu entries;
`main.ts:54-61` has six. `Copy public key` and `Generate key` are undocumented —
the latter being the only in-tool way to create a key, which is why the Quick
Start at `README.md:33` tells the user to run `ssh-keygen` by hand.
`README.md:93` says encrypt takes keys "from `vault/tmp/`"; `encrypt.ts:12-20`
unions `~/.ssh` and tmp and offers both.

### 5.3 🟠 The README documents none of the CLI surface

`README.md` covers the interactive menu and the config file. It does not mention:

- `self-update` / `upgrade`, `--dry-run`, `--force`, `--channel`, `--registry`
- `--version` / `-V`, `--print-config`
- `KEYMAN_REGISTRY`, `KEYMAN_REGISTRY_TOKEN`, `KEYMAN_NO_UPDATE_CHECK`,
  `KEYMAN_PACKAGE_MANAGER`
- the once-a-day update check, or that it is disabled when `CI` is set

`README.PUBLISH.md:552-578` documents all of it, but `package.json:37-41` ships
only `dist`, `README.md` and `LICENSE` — so a reader on the registry sees none of
it. This is the same shape as the nopy README problem closed as
`DOCS-AUDIT.md` §2.9, and keyman is now the worse of the two.

### 5.4 🟠 The README presents a configurable layout that is half-real

`README.md:46-70` documents `keysDir` and `tmpDir` as configuration, and
`:72-86` draws the default tree. Per §1.1 the first is only half true. Whichever
way §1.1 is resolved, this section needs an edit.

### 5.5 🟡 `CLAUDE.md` names a binary keyman never runs

> Encryption shells out to `age` / `age-keygen` / `ssh-keygen`, which must be on
> `PATH`.

`age-keygen` appears nowhere in `packages/keyman/src`. It appears in
`README.md:22` as a manual setup step, which is presumably where the claim came
from. Either note it as a prerequisite the user runs rather than something
keyman invokes, or make §2.3 true and turn the claim into fact.

`CLAUDE.md` also does not mention that `decryptKeys` shells out to `cp` and
`chmod` (`decrypt.ts:49-50`) — see §2.1, where the recommendation is to stop.

### 5.6 ✅ The update module has not drifted from nopy's

`keyman.update.ts` and `nopy.update.ts` are described in `CLAUDE.md` as "two
near-identical copies of one module", the duplication deliberate. Diffed with
package names normalised: **every difference is a doc comment.** No behavioural
drift at all. The stated risk of the duplication has not materialised; nopy's
copy simply carries fuller comments, and porting the better ones over would cost
nothing.

---

## 6. Checked and accurate

- **Config precedence.** `VAULT_ROOT` > config file > defaults
  (`config.ts:249-259`), matching `README.md:59-70`. Verified via
  `--print-config`.
- **Upward traversal and the home-directory config.** `findConfigFiles`
  (`config.ts:85-110`) collects root-first and de-duplicates the home config
  when it is also an ancestor (`:105`).
- **`loadConfig` never throws.** Invalid JSON is skipped per file (`:220-226`)
  and a failed final validation degrades to defaults (`:232-241`) — which is the
  documented difference from nopy's behaviour, and it holds.
- **`extractAgePublicKey` is honest about failure.** It returns `null` in every
  failure mode and prints why; the defect in §1.3 is entirely in the caller's
  `!`.
- **The menu loop.** Returns to the menu after every operation
  (`main.ts:45-91`), as `README.md:97` says.
- **The four default values** and the `id_<name>.age` / `id_<name>.pub` layout
  inside a per-key folder, as drawn at `README.md:72-86`.
- **`listKeys` status logic** (`list.ts:127-128`) matches its legend and the
  README's, including the 🔓 state.
- **The update module**, in full — see §5.6.

---

## Suggested order of attack

**1 — the crashes, together.** §1.2, §1.3, §1.5 and §1.10's `statSync` are all
the same shape: an unguarded call in a function with no error boundary, reaching
a `keyman()` that is never awaited. One `catch` in `keyman.cli.ts` that
distinguishes `ExitPromptError` from a real failure, plus `existsSync` guards and
`try/catch` in encrypt and decrypt, closes all of them and most of §3.1's second
half. This is the smallest change with the largest effect on what a first run
feels like.

**2 — §1.4 and §2.1.** Both are in `decryptKeys`, both are about writing outside
the vault, and one of them destroys data. Replacing `cp`/`chmod` with the `fs`
equivalents is part of the same edit.

**3 — §1.1.** Mechanical, but it changes four test assertions, so it wants to be
its own commit. Fix `DOCS-AUDIT.md` §5.1 in the same one.

**4 — decide on §3.3 and §3.6.** Both are features the documentation claims and
the code does not have; both are decisions rather than fixes. Rotation is worth
building. The `resolution` machinery probably is not, and deleting it would take
`keyman.config.ts` from 267 lines to around 220.

**5 — §5.2, §5.3 and §5.4** are one rewrite of `README.md`. It is the only
document that ships, and it currently describes two thirds of the menu and none
of the command line.

**6 — the rest.** §2.2 (drop the passphrase prompt, let `ssh-keygen` ask), §2.3
(`age-keygen -y`), §2.4 (a shred operation), §1.6 through §1.9, §3.2, §3.4,
§3.5, and the §4 one-liners.
