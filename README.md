# ansiblings

Infrastructure tooling monorepo: two published CLIs plus the pyinfra "cubes"
they deploy.

| Path              | Package            | Binary   | What it is                                          |
| ----------------- | ------------------ | -------- | --------------------------------------------------- |
| `packages/nopy`   | `@bitstack/nopy`   | `nopy`   | interactive pyinfra script management and execution |
| `packages/keyman` | `@bitstack/keyman` | `keyman` | SSH key management with `age` encryption            |
| `cubes/`          | —                  | —        | the deployment units `nopy` runs                    |

```sh
npm install -g @bitstack/nopy @bitstack/keyman
```

See each package's README for usage, and
[README.PUBLISH.md](README.PUBLISH.md) for how they get published.

## Development

Requires Node ≥ 22 (the repo pins 24 in `.nvmrc`) and pnpm — the version is
pinned by `packageManager`, so `corepack enable` is enough.

```sh
pnpm install
```

| Command                     | Does                                                |
| --------------------------- | --------------------------------------------------- |
| `pnpm run build`            | compiles both packages with `tsc`                   |
| `pnpm run typecheck`        | `tsc --build --noEmit` across the workspace         |
| `pnpm run lint`             | Biome check                                         |
| `pnpm run lint:fix`         | Biome check with fixes applied                      |
| `pnpm test`                 | vitest, both packages                               |
| `pnpm run test:coverage`    | vitest with the coverage gate                       |
| `pnpm run coverage:summary` | renders the last coverage run as a Markdown table   |

`typescript` is on the 7.x native compiler, so `tsc` *is* the fast one — there is
no separate `tsgo` binary to keep in sync. Each package also has a dev-run script
(`pnpm --filter @bitstack/nopy run nopy`) that executes the TypeScript sources
directly through `tsx`.

## Git hooks

Installed by `simple-git-hooks` on `pnpm install`, configured in the root
`package.json`:

- **pre-commit** — Biome check with fixes, on staged files only, re-staging what
  it fixed. Fast; blocks only on problems it cannot fix itself.
- **pre-push** — `lint:ci` → `typecheck` → `test:coverage`. This is the same gate
  CI runs, so a push that survives it will not surprise you on the runner.

Set `SKIP_SIMPLE_GIT_HOOKS=1` to bypass either one; re-install them after
changing the config with `pnpm exec simple-git-hooks`.

## Coverage

Both packages hold a hard **85 % branch** floor, enforced by
`coverage.thresholds` in their `vitest.config.ts` rather than by a CI-only flag —
`pnpm run test:coverage` fails the same way locally, in the `pre-push` hook, and
on the runner. Barrel files and CLI argv wiring are excluded; everything with
behaviour in it is not.
