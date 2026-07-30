# keyman remediation plan

Turns [`AUDIT.md`](./AUDIT.md) into sequenced work. Each phase is one commit,
independently landable, gate-green on its own. Section references (§) are to
`AUDIT.md`.

Ordering is by *blast radius per unit of risk*, not by severity: the error
boundary comes first because it makes every later phase's failure mode legible,
and the config threading comes late because it is the only phase that rewrites
existing test assertions.

## Status

**All ten phases have landed**, one commit each, on the `keyman-remediation`
branch. Three deviations worth knowing about:

- **Phase 6's literal instruction was impossible.** "Move the `mkdirSync` after
  `age` succeeds" cannot be done — `age -o` will not create its output directory.
  The goal (no leftover directory) is met by cleaning up on failure instead, which
  also removes a truncated `.age` the plan had not accounted for.
- **§1.8 is half done, deliberately**, exactly as the plan asked: the skipped-key
  report is in, the layout change that would make non-`id_*` keys manageable is
  not. See `AUDIT.md` §1.8.
- **Rollout has not been done.** No version bump, no tag, nothing published — the
  cut points below are still proposals, and pushing this branch to `main` would
  publish a snapshot, so that is the user's call to make.

Both open decisions were resolved the way the plan recommended: the `resolution`
machinery was deleted, and rotation was built.

## Verified before planning

Four things the fixes depend on, checked by running them rather than assumed —
two of them changed the prescription:

| Check | Result | Consequence |
| --- | --- | --- |
| `ssh-keygen` with `-N` omitted | Prompts `Enter passphrase … (empty for no passphrase)` **and** confirms | §2.2 fix works: omit `-N`, inherit stdio, keyman never holds the passphrase |
| `ssh-keygen -y -f <encrypted key>` | **Prompts for the passphrase** | §1.6 fix cannot be a silent spawn — needs `stdio: 'inherit'` and a skip path |
| `@inquirer/core` from keyman | `ERR_MODULE_NOT_FOUND` — transitive via `inquirer`, not a direct dep | Detect `ExitPromptError` by `error.name`, never by import |
| `z.strictObject` in zod 4.4.3 | Available; reports `unrecognized_keys` with a `keys` array | §3.5 has a hard-failure option, though the plan prefers a warning |

## What is not a breaking change

Per §4.3, `src/index.ts` exports only `keyman`, `loadConfig`,
`resolveConfigPaths` and the update module. `encryptKeys`, `decryptKeys`,
`generateKey`, `listKeys`, `copyKey` and `extractAgePublicKey` are **not** on the
public surface, so every signature change below is internal. Phases 2–6 are not
semver-breaking.

The one user-visible behaviour change is Phase 5 — see [Migration](#migration).

## Gate discipline

`lint:ci` → `typecheck` → `test:coverage` runs on `pre-push` and in CI. Two
standing constraints:

- **Every phase lands its tests with its fix.** No phase may leave a red gate,
  so there is no "write the failing tests first" commit.
- **`keyman.cli.ts` is excluded from coverage** (`vitest.config.ts:18`). Per
  `CLAUDE.md`, *adding logic to those files means moving it somewhere covered* —
  which is why Phase 1 extracts argument parsing into a new module rather than
  growing `cli.ts`.

Per-phase verification is `pnpm --filter @bitsquare/keyman run test`; the full
gate (`pnpm run lint:ci && pnpm run typecheck && pnpm run test:coverage`) before
each push.

---

## Phase 1 — Error boundary, `--help`, argument validation

Closes §3.1, §3.2, and the second half of §1.2 (the crash dump).

First because it is pure addition, touches no operation module, and converts
every latent throw in phases 2–6 from a stack dump into a line of text. The
`ExitPromptError` half is independently worth shipping: today **Ctrl-C at any
prompt** produces a crash dump.

**New file `src/keyman.args.ts`** (covered by the gate, unlike `cli.ts`):

- `parseArgs(argv: string[]): ParsedArgs` — supports `--flag value` *and*
  `--flag=value`, rejects a flag consumed as another flag's value, rejects
  unknown flags, and validates `--channel` against `'latest' | 'next' | 'main'`
  so §3.2's false "Could not reach <registry>" cannot happen.
- `helpText(): string` — flags, both subcommands, and the four `KEYMAN_*`
  variables. This is the text Phase 9 keeps in step with the README.

**`src/keyman.cli.ts`** stays wiring: dispatch on the parse result, and

```ts
try {
  await keyman();
} catch (error) {
  if ((error as { name?: string }).name === 'ExitPromptError') {
    console.log('\n👋 Goodbye!\n');
    process.exit(0);
  }
  console.error(`❌ ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
```

`error.name`, not `instanceof` — `@inquirer/core` is not a direct dependency and
does not resolve from this package.

**Tests** — new `tests/args.test.ts`: each rejection, both flag forms, the
channel whitelist, and that `helpText()` names every flag `parseArgs` accepts
(so the two cannot drift).

**Done when** `keyman --help` prints usage and exits 0 without loading config or
prompting; `keyman --bogus` errors; Ctrl-C prints Goodbye and exits 0.

---

## Phase 2 — Guards and error handling in encrypt/decrypt

Closes §1.2 (first half), §1.5, and §1.10's `statSync`.

- `encrypt.ts:13,16` and `decrypt.ts:8` — `existsSync` guard, falling through to
  the "⚠️ No …" message each function already has but cannot currently reach.
- `main.ts:40-41` — create `keysDir` alongside `vaultRoot` and `tmpDir`. Use
  `{recursive: true, mode: 0o700}` now, so Phase 4 does not have to revisit it.
- Wrap the `age` spawns in both functions. An `ENOENT` on the binary gets its own
  message ("`age` was not found on PATH") — it is the one hard external
  requirement and currently the least legible failure.
- `list.ts:80` — `readdirSync(dir, {withFileTypes: true})` instead of
  `statSync` per entry, which also drops N stat calls and fixes the broken-symlink
  throw.
- Delete the debug logging while in these files: `encrypt.ts:18-19` and
  `decrypt.ts:10` (§1.10). That also closes `DOCS-AUDIT.md` §6.4's open bullet.

**Tests** — the cases the current suite structurally cannot have, because every
`beforeEach` pre-creates the directories: encrypt with no `~/.ssh`, encrypt with
no tmp, decrypt with no `<vault>/keys`, each asserting the warning and no throw.
Plus `list` with a dangling symlink in the keys directory.

**Note on coverage.** `encrypt.ts` and `decrypt.ts` are at 100 % lines and
branches *today*. The number will not move; the tests are the point.

**Done when** a first run against an empty vault can reach every menu entry and
return to the menu.

---

## Phase 3 — Resolve the age recipient once, and derive it properly

Closes §1.3 and §2.3, and makes `CLAUDE.md`'s `age-keygen` claim true (§5.5).

Two changes that belong together because both are about the recipient:

1. **`utils.ts` — derive, don't scrape.** `extractAgePublicKey` currently regexes
   `# public key:` out of a comment (`utils.ts:16`) and trusts it. Replace with
   `age-keygen -y <keyPath>`, which derives the public key *from the private key*
   and cannot disagree with it. Keep the comment parse as a fallback for when
   `age-keygen` is absent, behind a warning that the recipient is unverified.
   The function becomes `async`.
2. **`main.ts:73,80` — delete both `!`.** Resolve the recipient once before the
   `switch`, and treat `null` as recoverable: print the remedy
   (`age-keygen -o <keyPath>`) and `break` back to the menu. This is the whole of
   §1.3 — the type already said null was possible.

Sequencing matters inside the phase: fix the call site first. Without it, a
missing key file still reaches `age -r null`, and the generate path still leaves
a **plaintext private key in `tmpDir`** after telling the user the operation
failed.

**Tests** — `utils.test.ts` gains the `age-keygen -y` path with `execa` mocked,
the fallback-with-warning path, and the both-unavailable path. `main.test.ts`
gains: missing recipient → neither `generateKey` nor `encryptKeys` is called, a
remedy is printed, and the menu loop continues.

**Done when** `keyman` against a vault with no `age.key` reaches the menu,
refuses generate and encrypt with a remedy, and still offers list and decrypt.

---

## Phase 4 — Decrypt: stop overwriting, stop the 0644 window

Closes §1.4 and §2.1. The highest-value phase — §1.4 is the only finding that
destroys data the user did not ask to touch.

- **Collision check before any decryption.** Both output paths, both modes.
  Prompt per collision, defaulting to skip; `~/.ssh` deserves the friction more
  than `vault/tmp` does, but the check is the same code.
- **Replace the shell-outs** (`decrypt.ts:49-50`) with `fs.copyFileSync` and
  `fs.chmodSync`. Three spawns per key become one, it works on Windows, and it
  removes a `cp` that overwrites unconditionally.
- **Close the permission window.** Verified: `age -o` creates the file `0644`
  and `mkdirSync` creates `vault/tmp` as `0755`, so a plaintext key is
  world-readable for the duration of two process spawns — and stays `0644` if the
  `chmod` fails. `fs.chmodSync` immediately after `age` resolves; `mode: 0o700`
  on the directory (already done in Phase 2); create `~/.ssh` `0700` if absent.

**Test rework — the fiddliest in the plan.** `decrypt.test.ts` asserts on the
mocked spawns: `argsOf('cp')` (`:98,111`) and `argsOf('chmod')` (`:99,112`) both
disappear, and `execa` is mocked with a bare `mockResolvedValue` (`:57`) that
writes no output file. Once `copyFileSync` is real it needs a real file, so the
mock must write to its `-o` argument the way `encrypt.test.ts:51-54` already
does. Assert the on-disk result and mode instead of the argv — a better test
than the one it replaces, since it checks the outcome rather than the mechanism.
`execa` call counts also change (`:123`: six spawns → two).

**Done when** decrypting onto an existing key requires a confirmation, and the
decrypted key is never observable at anything but `0600`.

---

## Phase 5 — Thread `keysDir` and `tmpDir` through encrypt and decrypt

Closes §1.1 and the `DOCS-AUDIT.md` entry in §5.1.

Mechanical, but it is the one phase that rewrites assertions that pass today, so
it stays its own commit with nothing else in it.

- `encryptKeys(sshDir, keysDir, tmpDir, pubkey)` — drop `vaultDir`, delete the
  hardcoded `path.join(vaultDir, 'keys')` (`encrypt.ts:38`).
- `decryptKeys(sshDir, keysDir, tmpDir, ageKey)` — drop `vaultDir`, delete the
  hardcoded joins at `decrypt.ts:7,39,43`.
- `main.ts:76,84` — pass `paths.keysDir` and `paths.tmpDir`. Neither function has
  any remaining use for `vaultRoot`, so the parameter goes rather than becoming a
  second source of truth.

**Assertions to change** — all four, named so the diff is reviewable:

| Location | Today | After |
| --- | --- | --- |
| `main.test.ts:164-175` | "encrypts keys into the vault root", asserts `paths.vaultRoot` | asserts `paths.keysDir`, `paths.tmpDir` |
| `main.test.ts:177-187` | asserts `paths.vaultRoot` | asserts `paths.keysDir`, `paths.tmpDir` |
| `encrypt.test.ts:95,115,128-129` | `path.join(vaultDir, 'keys', …)` | `path.join(keysDir, …)` |
| `decrypt.test.ts:53,89` | `keyDir = path.join(vaultDir, 'keys')` | `keysDir` passed in directly |

**New test, the one that would have caught this:** a config with
`keysDir: 'encrypted'` and `tmpDir: 'plain'`, encrypt a key, then list it, and
assert the listing shows it in `[Vault]`. That round trip fails today and is the
regression worth owning.

**Also in this commit:** move the `DOCS-AUDIT.md:826-827` bullet out of *checked
and accurate* and point it at this finding. It was verified against
`keyman.encrypt.ts` — the file that ignores the config — which is precisely how
§1.1 stayed invisible.

---

## Phase 6 — Generate: passphrase off argv, and `.pub` recovery

Closes §2.2, §1.6, and §1.10's leftover-directory bullet.

**Passphrase (§2.2).** Verified: omitting `-N` makes `ssh-keygen` prompt *and*
confirm. So delete keyman's own password prompt (`generate.ts:26-33`), omit `-N`,
and spawn with `stdio: 'inherit'`. The passphrase never enters keyman's memory
and never reaches argv — strictly better than routing it more carefully, and it
deletes code. `generate.test.ts:78-87` loses `-N`/`'pw'` from the expected argv
and the password-prompt case goes away.

**Missing `.pub` (§1.6).** The selection list is built from private keys only, so
an orphan private key is offered and `copyFileSync` throws *after* `age` has
written the `.age` file — leaving a vault entry with no public key and killing
the rest of the batch. Fix in two parts:

- Derive it with `ssh-keygen -y -f <key>` when the sibling is absent. **Verified
  that this prompts for a passphrase on an encrypted key**, so it needs
  `stdio: 'inherit'` and a clean skip when the user cannot or will not supply it
  — not a silent spawn whose stdout is captured.
- Wrap the loop body in `encrypt.ts:36-48` per key, so one bad key costs one key.
  Report the failures at the end rather than dying at the first.

**Leftover directory.** `generate.ts:65` creates `<keysDir>/<name>/` before
`age` runs at `:68`. Move the `mkdirSync` after `age` succeeds.

---

## Phase 7 — Config: warn on typos, decide on the dead machinery

Closes §3.5, §3.4, and asks for a decision on §3.3.

**Typos (§3.5).** Verified: `{"vaultroot": "…"}` is silently stripped by
`z.object`. Warn per file rather than failing — diff `Object.keys(rawConfig)`
against the schema keys plus `resolution` inside the existing per-file loop
(`config.ts:210-227`), where the filename is in hand. That names the offending
file, which `z.strictObject` cannot do from the merged result, and it preserves
the module's documented posture of degrading to defaults rather than throwing.
(`z.strictObject` is available in zod 4.4.3 and reports `unrecognized_keys` with
a `keys` array, if a hard failure is preferred later.)

**`getConfigPaths` (§3.4).** Add it to the `--print-config` JSON as
`configFiles`. The function is currently exercised only by its own test, and
`--print-config` currently cannot answer *which files were read* — that exists
only as unstructured stderr from `loadConfig`. One change fixes both.

**Decision needed — the `resolution` machinery (§3.3).** Roughly 45 lines
(`config.ts:23-30,115-157`) that cannot affect a valid config, because every
schema property is a `string` and both strategies return `childValue` for
primitives. `config.test.ts:212` "honours an explicit override strategy" passes
either way.

- **Recommended: delete it**, along with the doc comment at `:186-194` that
  advertises it. `keyman.config.ts` goes from 267 lines to roughly 220, and the
  config file stops documenting a knob that does nothing.
- **Alternative: keep it** as the shape a future array- or object-valued option
  would need — but then say so in a comment, because today it reads as
  functional, and make `config.test.ts:212` assert something that distinguishes
  the two strategies (which requires a non-string property to exist first).

Deleting is the smaller lie. It also diverges from nopy, where the machinery
*is* load-bearing — worth a line in `CLAUDE.md` so the divergence reads as
deliberate.

---

## Phase 8 — Portability and the gaps that make keys invisible

Closes §1.7, §1.8, §1.9, §2.4. Independent of each other; split if any grows.

- **Clipboard (§1.9).** `pbcopy` / `wl-copy` / `xclip` / `clip.exe` by platform,
  falling back to printing the key to stdout so the operation is never a dead
  end. Delete the comment at `copy.ts:46-48` that admits the shortcut.
- **Home directory (§1.7).** `os.userInfo()` for the current user; for a named
  user, look the home directory up rather than assuming `/home/<user>` — wrong on
  the one platform the tool currently supports. Check `existsSync` and say so,
  instead of feeding a nonexistent path into a `readdir`.
  `main.test.ts:198-204` changes.
- **Non-`id_*` keys (§1.8).** Relax the filters (`copy.ts:9`, `encrypt.ts:14,17`,
  `list.ts:23,51`) to *any* private key with a recognisable header, or at minimum
  print a count of the keys that were skipped and why. Today a key named
  `deploy_ed25519` is simply absent from the menu — and pre-existing keys are the
  population a key manager is adopted to take over. `decrypt.ts:9` reconstructs
  `id_${dir}` from the folder name, so the vault layout has the assumption baked
  in; relaxing discovery means storing the real filename per key, which is the
  largest single item in this plan. **Size it before committing to it** — a
  skipped-key count is a tenth of the work and closes most of the surprise.
- **Plaintext hygiene (§2.4).** A "🧹 Clear decrypted keys" menu entry, and write
  a `.gitignore` next to the vault on first run covering `age.key` and `tmp/` —
  which `README.md:25-26` currently tells the user to do by hand. This is the
  cheapest guard against the exact failure the tool exists to prevent.

---

## Phase 9 — Documentation

Closes §5.2, §5.3, §5.4, §5.5. Last, so it documents what the code now does.

- **`README.md` — the only shipped document** (`package.json:37-41` ships `dist`,
  `README.md`, `LICENSE`). Currently describes four of six menu entries, invents
  key rotation, and mentions none of `self-update`, `--print-config`,
  `--version`, `--help`, or the four `KEYMAN_*` variables. `README.PUBLISH.md`
  has all of it and never reaches a reader on the registry. Reuse Phase 1's
  `helpText()` as the source for the CLI section so the two cannot drift.
- **`README.md:46-86`** — the configuration and vault-layout sections, now that
  Phase 5 makes `keysDir`/`tmpDir` real, plus the migration note below.
- **`README.md:11`** — drop "Support for key rotation" unless Phase 10 lands
  first.
- **`README.md:33`** — stop telling the user to shell out to `ssh-keygen`; the
  Generate operation exists.
- **`CLAUDE.md`** — `age-keygen` becomes true in Phase 3; note that `cp`/`chmod`
  are gone (Phase 4) and record the `resolution` divergence from nopy (Phase 7).
- **`AUDIT.md`** — mark findings closed, keeping their text as the record, the way
  `DOCS-AUDIT.md` does.

---

## Phase 10 — Key rotation (decision required)

§3.6. `README.md:11` has advertised it since before this audit;
`grep -rn "rotat" packages/keyman/src/` returns nothing.

Unlike the rest of this plan it is a feature, not a repair, and it is the one
item that could reasonably be dropped instead. **Recommendation: build it** —
rotation is the operation that makes a key vault worth having, and the pieces all
exist by Phase 6 (generate under a new name, encrypt, keep the old key until the
replacement is deployed, then shred). Sketch:

1. Pick an existing vault key.
2. Generate a replacement into `tmpDir` under a versioned name.
3. Encrypt it alongside the current one — never replacing it.
4. Report both public keys, so the new one can be deployed before the old one
   goes.
5. A separate "retire" step that removes the superseded key once the user
   confirms.

Steps 3 and 4 are the whole value: a rotation that atomically replaces the key is
a rotation that locks you out of the host you were rotating for. If this is
deferred, delete the README claim in Phase 9 instead.

---

## Migration

Phase 5 is the only user-visible change. Anyone with a custom `keysDir` or
`tmpDir` currently has a **split vault** — `generate` and `list` on the
configured directory, `encrypt` and `decrypt` on `<vaultRoot>/keys` and
`<vaultRoot>/tmp`. After Phase 5 all five agree on the configured directory, so
anything written by `encrypt` before the upgrade needs moving:

```sh
mv <vaultRoot>/keys/* <vaultRoot>/<keysDir>/
```

Nobody on the defaults is affected, since the two halves coincide there. The
README gets this as a note, and it is worth a line in the release notes for
whichever version carries Phase 5.

## Rollout

Per `CLAUDE.md`: bump `packages/keyman/package.json`, land on `main`, then tag
`keyman-v<version>`.

- **Snapshots come free.** Every push to `main` publishes
  `<version>-main.<run>.g<sha>` to Gitea under the `main` dist-tag, so each phase
  is installable for testing without a release. `pnpm run try:snapshot` installs
  one into a throwaway project.
- **Suggested cut points.** After Phase 4 as `0.6.0` — error boundary, guards,
  recipient handling and the data-loss fix, which is the set worth getting to
  users first. After Phase 9 as `0.7.0`, carrying the Phase 5 migration note.
- **keyman can reach npmjs.** It has no `workspace:*` dependencies (`execa`,
  `inquirer`, `semver`, `zod` only), so `scripts/linked-deps.mjs` has nothing to
  block on — unlike `nopy`, which `CLAUDE.md` records as gated behind
  `nopy-cubes` shipping. keyman has never been published to npmjs; `0.6.0` could
  be the first, and versions being `0.x.y` rather than `1.0.0-alphaN` means the
  `latest` dist-tag will now actually move.
- **`pnpm publish`, never `npm publish`** — no `workspace:` ranges here, but the
  rule is repo-wide and `scripts/verify-pack.mjs` enforces it in both workflows.

## Sequencing at a glance

```
1  cli boundary + --help + args      §3.1 §3.2 §1.2(half)   isolated, pure addition
2  guards in encrypt/decrypt/list    §1.2 §1.5 §1.10         new tests only
3  age recipient, once and derived   §1.3 §2.3 §5.5          signature → async
4  decrypt: no clobber, no 0644      §1.4 §2.1               reworks decrypt.test.ts
   ── cut 0.6.0 ──
5  thread keysDir/tmpDir             §1.1 §5.1               rewrites 4 assertions
6  generate: -N gone, .pub recovery  §2.2 §1.6 §1.10         reworks generate.test.ts
7  config: warn, prune, print        §3.5 §3.4 §3.3*         *decision
8  portability + hygiene             §1.7 §1.8 §1.9 §2.4     §1.8 needs sizing
9  documentation                     §5.2 §5.3 §5.4 §5.5     README is the shipped one
   ── cut 0.7.0 ──
10 rotation                          §3.6*                   *decision: build or delete
```

Phases 1–6 are repairs and want to land in order. 7 and 8 are independent of each
other and of 5–6. 9 depends on everything before it. 10 is optional and gates
one line of Phase 9.

## Open decisions

Neither blocks Phase 1. Both change scope where they land:

1. **§3.3, at Phase 7** — delete the inert `resolution` machinery (recommended,
   −45 lines) or keep it as future shape with a comment saying so.
2. **§3.6, at Phase 10** — build rotation (recommended) or delete the README
   claim in Phase 9.
