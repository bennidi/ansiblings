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

## Status

**All 30 findings are closed except the second half of §1.8**, over the ten phases
of `PLAN.md`. Each one keeps its original text as the record, with what closed it
quoted underneath; the line numbers still point at `75983ab`, so they are history
rather than directions. The one deliberate omission is making keys not named `id_*`
*manageable* — they are now reported rather than silently skipped, and the rest is a
change to the on-disk layout that wanted sizing first.

Where the audit ends: 336 tests, 99.3 % statements / 95.7 % branches.

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

### 1.1 ✅ `keysDir` and `tmpDir` are honoured by half the tool — **fixed**

> **Closed in Phase 5.** `main.ts` passes `paths.keysDir` and `paths.tmpDir` to
> `encrypt` and `decrypt`, neither of which joins `vaultRoot` itself any more, so all
> five operations agree on the configured directories. `tests/vault-layout.test.ts` is
> the regression test: non-default names in a real config file, the real loader, one
> encrypt, and a listing that has to show the key in the vault column.

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

### 1.2 ✅ Encrypt and decrypt crash with a raw stack trace on a first run — **fixed**

> **Closed in Phases 1 and 2.** `keyman.cli.ts` is an error boundary — a
> `UsageError` prints one line, anything else prints its message and exits 1, and
> neither prints a stack. The two readdirs that threw are guarded (§1.5).

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

### 1.3 ✅ A missing `age.key` becomes `age -r null` — **fixed**

> **Closed in Phase 3.** The recipient is resolved once per session, before any
> operation that needs one. A null aborts *that operation* with
> `age-keygen -o <path>` as the remedy and returns to the menu, and is retried on the
> next attempt, so creating the identity mid-session works. `age -r null` is now
> unreachable.

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

### 1.4 ✅ Decrypting into `~/.ssh` silently overwrites an existing key — **fixed**

> **Closed in Phase 4.** Every collision is settled before anything is written: a
> confirmation per key defaulting to no, and a skip that says what it kept. The user
> is answering about files that still exist.

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

### 1.5 ✅ `age` or `ssh-keygen` missing is unhandled in encrypt and decrypt — **fixed**

> **Closed in Phase 2.** `runTool` turns `ENOENT` into a `ToolNotFoundError`
> whose message is an instruction, and keeps it distinct from a tool that ran and
> refused — whose reason is on stderr and nowhere in execa's message. `encrypt`
> re-throws it instead of counting it against one key.

Same missing `try/catch` as §1.3. `generateKey` (`generate.ts:51-76`) and
`copyKey` (`copy.ts:43-57`) both wrap their `execa` calls and report a failure;
`encryptKeys` and `decryptKeys` do not. On a machine without `age` on `PATH` —
the one hard external requirement, per `CLAUDE.md` — choosing Encrypt from the
menu produces an `ENOENT` stack trace rather than "install age".

### 1.6 ✅ Encrypt copies `.pub` unconditionally and aborts the batch midway — **fixed**

> **Closed in Phase 6.** `storeInVault` reads the `.pub` *before* the vault
> directory exists and derives a missing one with `ssh-keygen -y` — stdout piped,
> stdin and stderr inherited, because the passphrase prompt goes to stderr — storing
> the private key alone if it cannot. And a failing key costs one key: `encrypt`
> collects the failures and names them at the end.

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

### 1.7 ✅ `/home/<user>` is hardcoded — **fixed**

> **Closed in Phase 8.** `keyman.home.ts` resolves a named user against the
> sibling of the current home first, then `/home/<user>` and `/Users/<user>`, and
> reports every path it tried. An unset `HOME` falls back to the passwd entry instead
> of resolving `.ssh` against the filesystem root.

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

### 1.8 🟡 Keys not named `id_*` are invisible, silently — **half fixed**

> **Partly closed in Phase 8 — the rest is open.** `scanPrivateKeys` classifies a
> file by reading its first 64 bytes for a private-key header, and List, Copy and
> Encrypt report what they skipped, with the count, the directory and the reason. So
> the keys are no longer *silently* invisible.
>
> They are still not manageable. The vault layout derives `id_<dir>` from the
> directory name in four places, so accepting other names changes what is on disk;
> the plan asked for that to be sized before being committed to, and the report is
> the tenth of the work that closes most of the surprise. Left deliberately.

Every discovery filter requires the prefix: `copy.ts:9`, `encrypt.ts:14,17`,
`list.ts:23,51`, and `decrypt.ts:9` reconstructs `id_${dir}`. A key called
`deploy_ed25519` cannot be listed, copied, or encrypted, and nothing says why —
it simply is not in the menu.

`generateKey` enforces the prefix (`generate.ts:43`), so keys keyman creates are
always fine. The gap only bites pre-existing keys, which is exactly the
population a key manager is adopted to take over.

### 1.9 ✅ `pbcopy` is hardcoded — **fixed**

> **Closed in Phase 8.** `keyman.clipboard.ts` picks by platform — `pbcopy`,
> `clip`, or `wl-copy` → `xclip` → `xsel` — falls through only on `ENOENT` (a tool
> that ran and refused is a real error, not an absent tool), and prints the key when
> nothing is installed, since printing it was always the point.

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

### 1.10 ✅ Smaller things — **fixed**

> **Closed in Phases 2, 6 and 8.** All four: the `statSync` takes
> `throwIfNoEntry: false` and still follows a symlink to a real directory; both
> `replace` calls are anchored to `/^id_/`; a failed `age` now removes the file it
> named and the directory while it is empty, so nothing half-made is left claiming to
> hold a key; and both `console.log` debug lines are gone.

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

### 2.1 ✅ Decrypted private keys are world-readable before the chmod — **fixed**

> **Closed in Phase 4.** `fs.chmodSync(…, 0o600)` in-process, immediately after
> `age` returns — no `cp` or `chmod` spawn, so there is no window and no failure mode
> that leaves the mode behind. Confirmed again while probing Phase 10: age still
> writes 0644, and `ssh-keygen -y` refuses such a file outright.

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

### 2.2 ✅ The passphrase is passed on the `ssh-keygen` command line — **fixed**

> **Closed in Phase 6.** The prompt is gone and so is `-N`: `ssh-keygen` collects
> and confirms the passphrase itself with stdio inherited. A passphrase keyman never
> learns cannot leak from keyman — and a test asserts it never asks for one.

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

### 2.3 ✅ The age recipient is trusted from a comment, never verified — **fixed**

> **Closed in Phase 3.** `age-keygen -y` derives the recipient from the secret
> key, so it cannot disagree with it. The comment survives only as a fallback for a
> machine with no `age-keygen`, behind a warning that it is unverified — and
> deliberately *not* as a fallback for `age-keygen` refusing the file, which means
> age cannot read the identity at all.

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

### 2.4 ✅ Nothing manages the plaintext left in `vault/tmp` — **fixed**

> **Closed in Phase 8.** A **🧹 Clear decrypted keys** operation that lists what it
> will delete and asks before deleting it, plus a `.gitignore` written beside the
> vault covering the identity and the tmp directory — never overwriting one that is
> already there, and never claiming to cover a path outside the vault.

Decrypted keys accumulate in `vault/tmp` indefinitely. There is no shred
operation, no warning on exit, and keyman never writes the `.gitignore` its own
README (`README.md:25-26`, `:148`) tells the user to write by hand. The only
signal is the 🔓 marker in `listKeys`, which the user has to go looking for.

A "Clear decrypted keys" menu entry and a `.gitignore` written alongside the
vault on first run would cost little and close the most likely way a private key
reaches a public repository — which is the threat this tool exists to address.

---

## 3. Unimplemented and dead

### 3.1 ✅ There is no `--help` — **fixed**

> **Closed in Phase 1.** `helpText()` in `keyman.args.ts`, checked against the
> parser's own flag table by a test so a new flag cannot ship undocumented, and now
> quoted verbatim in the README by a second test (§5.3).

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

### 3.2 ✅ `flagValue` accepts things that are not values — **fixed**

> **Closed in Phase 1.** `parseArgs` rejects a value flag with no value, a boolean
> flag given one, an unknown flag, an unknown command, an unknown channel, and a
> self-update-only flag used without `self-update`. `--channel --force` is now a
> usage error rather than a request for a dist-tag that cannot exist.

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

### 3.3 ✅ The `resolution` merge machinery has no effect — **fixed**

> **Closed in Phase 7 — deleted.** Every keyman property is a string, so a child
> simply wins; `mergeConfigs` is one spread with a comment recording why nopy needs
> more and keyman does not. `keyman.config.ts` lost ~45 lines.

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

### 3.4 ✅ `getConfigPaths()` is exported, tested, and called by nothing — **fixed**

> **Closed in Phase 7.** `describeConfig()` calls it, so `--print-config` prints
> `configFiles` — the files that were merged, in merge order. That was the one
> question the flag could not answer, and it existed only as unstructured stderr.

`keyman.config.ts:265` is used only by `config.test.ts:122,131`. It is not
re-exported from `src/index.ts` and not called by the CLI. nopy's equivalent
feeds `nopy.main.ts:64`.

The absence is felt: `--print-config` prints the *resolved paths* only, so there
is no way to ask which config files were consulted. That information exists only
as a stderr side effect of `loadConfig` ("✅ Loaded configuration from …"), which
is not machine-readable and is interleaved with warnings. Folding
`getConfigPaths()` into the `--print-config` JSON makes the function earn its
keep and makes the escape hatch answer the question it is for.

### 3.5 ✅ A typo in `.keymanrc.json` is silent — **fixed**

> **Closed in Phase 7.** `warnUnknownKeys` names the file, the keys it ignored and
> the keys it knows. Warned rather than fatal, which is this module's posture
> throughout, and warned per file because that is the only place the filename is in
> hand.

`KeymanConfigSchema` is a plain `z.object`, which strips unknown keys.

**Verified.** With `{"vaultRoot":"./v","vaultroot":"typo", …}`, the lowercase key
is dropped without a word and `--print-config` reports the vault from the
correct key. Had only the typo been present, the user would get the `vault`
default and no clue.

`.strict()` — or keeping the strip and logging the leftover keys as a warning —
turns a silently wrong vault into one line of output. Since `loadConfig` already
degrades to defaults rather than throwing, a warning fits the module's existing
posture better than a hard failure.

### 3.6 ✅ "Support for key rotation" does not exist — **fixed**

> **Closed in Phase 10 — built.** `keyman.rotate.ts`: **🔄 Rotate key** generates a
> replacement under the next name in the series and encrypts it *alongside* the
> original, and **🗑️ Retire key** deletes the superseded key after listing every path
> that goes, asking for the name to be typed out when nothing in the vault supersedes
> it. Two operations rather than one, because a rotation that replaces the key in
> place locks you out of the host you were rotating for.

`README.md:11`. `grep -rn "rotat" packages/keyman/src/` returns nothing. Already
tracked as `DOCS-AUDIT.md` §2.10, still open. Rotation is a genuinely useful
operation for this tool — generate a replacement, encrypt it, keep the old one
until the new one is deployed — so this is worth building rather than deleting.

### 3.7 ✅ "Copy public key and create README" — **fixed**

> **Closed in Phase 5.** The comment went with the rewrite of `encrypt`. No
> per-key README was ever written and nothing claims one now; the `README.md` fixture
> in `decrypt.test.ts` is a stray-file case, which `listVaultKeys` ignores.

`encrypt.ts:44` says it; no README is written. Suggestively,
`decrypt.test.ts:75` places a `README.md` inside the keys directory as a
fixture, so a per-key README appears to have been the intent once. Either build
it or drop the half of the comment that lies.

---

## 4. Public API and packaging

### 4.1 ✅ A shebang on the library entry point — **fixed**

> **Closed in Phase 9.** The shebang is gone, with a comment saying why the file
> does not want one. Verified against the built `dist/index.js`.

`src/index.ts:1` is `#!/usr/bin/env node`. The bin is `dist/keyman.cli.js`
(`package.json:28`); `index.ts` is the `exports["."]` target and is only ever
imported. nopy's `src/index.ts` has no shebang. Harmless, and a copy-paste
artefact.

### 4.2 ✅ The exported functions' types are not exported — **fixed**

> **Closed in Phase 9.** `KeymanConfig` and `KeymanConfigFile` are exported;
> `ResolutionStrategy` and `KeymanResolutionConfig` no longer exist (§3.3).

`src/index.ts:2` exports `loadConfig` and `resolveConfigPaths`. It does not
export `KeymanConfig`, `KeymanConfigFile`, `ResolutionStrategy` or
`KeymanResolutionConfig`, so a TypeScript consumer cannot name what `loadConfig`
returns or what `resolveConfigPaths` takes. This is the same one-line omission
`CLAUDE.md` already records for nopy's `CubePackageRef`.

### 4.3 ✅ `export * from './keyman.main.js'` exports only `keyman()` — **fixed**

> **Closed in Phase 9 — decided, and written down.** The surface is deliberately
> narrow: config resolution, the update machinery, and `keyman()`. The operation
> modules stay internal because every one of them prompts, prints and spawns, so
> there is nothing to do with a single one except rebuild the menu around it. The
> rule is now a comment at the top of `src/index.ts` rather than an accident.

The five operation modules and `extractAgePublicKey` are not on the public
surface, so the package is consumable as a library only as "run the entire
interactive menu". That may well be intended — but then `loadConfig` and
`resolveConfigPaths` being exported is the odd part, since a consumer can obtain
the paths and do nothing with them.

### 4.4 ✅ Update-module constants are half re-exported — **fixed**

> **Closed in Phase 9.** `export * from './keyman.update.js'`, so the rule is
> "all of it" and the list cannot drift again. Verified by importing the built
> `dist/index.js` and reading its keys.

`keyman.update.ts` exports `SCOPE`, `UPDATE_CACHE_DIR`, `UPDATE_CACHE_FILE`,
`DEFAULT_FETCH_TIMEOUT_MS` and `DEFAULT_CONFIG_TIMEOUT_MS`; `src/index.ts:12-31`
re-exports neither, while re-exporting `DEFAULT_CHECK_INTERVAL_MS` and
`NPMJS_REGISTRY`. Pick one rule.

---

## 5. Documentation drift

### 5.1 ✅ `DOCS-AUDIT.md` lists §1.1 under *checked and accurate* — **fixed**

> **Closed in Phase 5.** The claim `DOCS-AUDIT.md` makes — that the documented
> vault layout matches the code — is now *true*, which is the substance of it; §1.1 is
> what made it false. The entry has been amended to say what it actually checked.

`DOCS-AUDIT.md:826-827`:

> **keyman config** — priority (`VAULT_ROOT` > file > defaults), the four default
> values, and the vault layout match `keyman.config.ts` and `keyman.encrypt.ts`.

The first two clauses are correct. The third holds only because
`keyman.encrypt.ts` hardcodes `keys` — checking the documented layout against
the file that ignores the config is what made §1.1 invisible. The entry should
move out of section 7 and point at §1.1.

### 5.2 ✅ `README.md` operations list — **fixed**

> **Closed in Phase 9.** All nine menu entries are documented, and a test asserts
> the README contains every label `keyman.main.ts` offers, so a tenth cannot arrive
> undocumented. Encrypt is described as it behaves: the union of `~/.ssh` and the tmp
> directory.

`DOCS-AUDIT.md` §2.10, re-verified: `README.md:90-96` lists four menu entries;
`main.ts:54-61` has six. `Copy public key` and `Generate key` are undocumented —
the latter being the only in-tool way to create a key, which is why the Quick
Start at `README.md:33` tells the user to run `ssh-keygen` by hand.
`README.md:93` says encrypt takes keys "from `vault/tmp/`"; `encrypt.ts:12-20`
unions `~/.ssh` and tmp and offers both.

### 5.3 ✅ The README documents none of the CLI surface — **fixed**

> **Closed in Phase 9.** The README carries `helpText()` verbatim — every flag,
> both subcommand spellings, and all five environment variables — with a test that
> fails if the two diverge. Installation, the update channels and the once-a-day
> check are documented too.

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

### 5.4 ✅ The README presents a configurable layout that is half-real — **fixed**

> **Closed in Phase 9.** The section documents what §1.1 made true: the three
> inner names resolve against `vaultRoot`, a relative `vaultRoot` in a config file
> resolves against that file's directory, and the built-in default resolves against
> the current directory. It ends with the migration note for a vault written by the
> old `encrypt`.

`README.md:46-70` documents `keysDir` and `tmpDir` as configuration, and
`:72-86` draws the default tree. Per §1.1 the first is only half true. Whichever
way §1.1 is resolved, this section needs an edit.

### 5.5 ✅ `CLAUDE.md` names a binary keyman never runs — **fixed**

> **Closed in Phases 3 and 9.** `age-keygen` became true in Phase 3 (`-y`, to
> derive the recipient), and `cp`/`chmod` stopped being spawned in Phase 4.
> `CLAUDE.md` now says all of that, records the deliberate `resolution` divergence
> from nopy, and lists the operations the menu actually has.

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

> Superseded by `PLAN.md`, which turned this into ten phases and is the record of
> what was actually done in what order. Kept because the reasoning about which
> findings share a shape is still the reason the phases group the way they do.

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
