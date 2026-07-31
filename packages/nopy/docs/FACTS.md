# Requirements and facts

A proposal, not a record. Nothing here is built.

The question it answers: a cube should be able to say *"in order to run, a user
named xyz must exist, with fish as its shell, in these groups"* — and the engine
should check that against the real host rather than blindly running whatever
cube happens to create such a user.

Everything under [What pyinfra actually gives us](#what-pyinfra-actually-gives-us)
was measured against pyinfra **3.5.1**. Everything under
[The proposal](#the-proposal) is design.

## Contents

- [The problem with `dependencies`](#the-problem-with-dependencies)
- [What pyinfra actually gives us](#what-pyinfra-actually-gives-us)
- [The proposal](#the-proposal)
- [Why `facts.py` exposes a function, not a script](#why-factspy-exposes-a-function-not-a-script)
- [Execution model](#execution-model)
- [Sharp edges](#sharp-edges)
- [Measured vs. assumed](#measured-vs-assumed)

---

## The problem with `dependencies`

`manifest.dependencies` conflates two things that are not the same:

- **a requirement** — "this cube needs a user xyz to exist"
- **a remedy** — "therefore run `user:add`"

Today only the remedy is expressible. `user:add` declares
`dependencies: () => ['apt:essentials']`, which means *always run
`apt:essentials`*, on every host, forever, regardless of whether anything it
installs is missing.

### What that actually costs

Be honest about this, because it is smaller than it first looks and it changes
what the feature is for.

pyinfra operations are **already fact-diffed**. `server.user(present=True,
shell=…)` gathers `server.Users` itself and no-ops when the state matches. The
current design is therefore not *incorrect* — it is idempotent. What it costs is:

1. **Prompts.** Resolving `user:add` drags `apt:essentials` into the plan *and
   its variables into the prompt sequence*. The user is asked questions about a
   cube they never chose. This is the real, visible tax.
2. **Time.** A no-op pyinfra run is still a connection, a fact gather, and an
   operation build.
3. **Legibility.** The plan cannot say *"user xyz already exists, skipping"*.

This matters because the obvious objection to the whole feature is *"just write
`if not host.get_fact(…)` inside `deploy.py` — that is idiomatic pyinfra"*. The
answer is that nopy's layer is **planning and prompting**: deciding which cubes
enter the plan and which variables to ask for, before anything runs. A condition
inside `deploy.py` cannot help with either. That is the justification for lifting
facts into the Node runtime at all — and it means the feature buys **legibility
and prompt-avoidance, not correctness**.

## What pyinfra actually gives us

### The `fact` subcommand is not a machine interface

`pyinfra @local fact server.Groups` prints JSON — and prints it to **stderr**,
via `click.echo(jsonify(…), err=True)` in `pyinfra_cli/prints.py:print_fact`,
interleaved with `--> Loading config...` progress lines. Worse,
`_run_fact_operations` wraps each fact in `except PyinfraError: pass`, so the
command **exits 0 whether or not the fact resolved**.

Parsing that stream means fishing a JSON blob out of styled log output and
having no exit code to check. Rejected.

### A deploy file that prints to stdout is clean

pyinfra deploy files execute on the control machine at *build* time, and
`host.get_fact()` is available there — it is exactly how operations do their own
diffing. A file that gathers facts, prints JSON, and declares no operations
works:

```python
import json, sys
from pyinfra import host
from pyinfra.facts.server import Users, Which

users = host.get_fact(Users)
u = users.get(host.data.USER)
print("###NOPY-FACTS###" + json.dumps({
    "host": host.name,
    "exists": u is not None,
    "shell": (u or {}).get("shell"),
    "groups": (u or {}).get("groups", []),
}), file=sys.stdout)
```

```
$ pyinfra @local -y --data USER=someone facts.py
EXIT=0
--- STDOUT ---
###NOPY-FACTS###{"host": "@local", "exists": false, "shell": null, "groups": []}
--- STDERR ---
--> Loading config...
…
--> Results:
    Operation     Hosts   Success   Error   No Change
    Grand total   -       -         -       -
```

Confirmed properties:

- **stdout is exclusively ours.** Every byte pyinfra emits goes to stderr, which
  is the same reason nopy's own logging goes there (`configureLogtape`).
- **`--data` flows in identically** to a deploy script. Parameterising a probe
  is free.
- **Zero operations is legal.** `Grand total -`, exit 0.
- **`host.name` is available**, so multi-host output is self-tagging.
- **A custom `FactBase` subclass in a sibling module imports fine** under
  `--chdir`, so a cube can ship fact classes pyinfra does not have.
- **An exception exits 1** with a traceback on stderr.

### The trap

**An unreachable host exits 0 and prints nothing.**

```
$ pyinfra nonexistent.invalid.example -y probe.py
    nonexistent.invalid.example is neither an inventory file, a (list of) hosts…
EXIT=0
--- STDOUT ---   (empty)
```

Absence of a probe result must be a hard failure. It must never be read as
"this host has no requirements to check", which is the shape the bug would take.
The `###NOPY-FACTS###` sentinel exists for this: one line per host is *required*,
and a missing line is an error.

### `server.Users` already covers the motivating case

It returns `shell`, `groups`, `home`, `uid`, `gid`, `comment` and `password` per
user, keyed by name. `user:add` needs almost no custom fact code — see
[Sharp edges](#sharp-edges) for why `password` is a problem.

## The proposal

Split the one idea into two manifest fields, because there are two different
objects: what a cube can **report** about a host (owned by the cube responsible
for that state) and what a cube **demands** (owned by the consumer).

A single `facts:` field cannot be both.

### `provides` — on the cube that owns the state

```js
// cubes/user/add/manifest.mjs
export default Manifest({
  id: 'user:add',
  provides: {
    /** What the probe returns. Validated on the way back in. */
    schema: z.object({
      exists: z.boolean(),
      shell: z.string().nullable(),
      groups: z.array(z.string()),
    }),
    /** Schema keys the probe needs in order to look anything up. */
    params: ['USER'],
  },
  schema: z.object({ /* … unchanged … */ }),
});
```

Plus a `facts.py` in the cube directory, discovered by convention exactly as
`deploy.py` is.

### `requires` — on the consumer

```js
requires: (vars) => [{
  cube: 'user:add',
  with: { USER: vars.DEPLOY_USER },
  expect: z.object({
    exists: z.literal(true),
    shell: z.literal('/usr/bin/fish'),
    groups: z.array(z.string()).refine((g) => g.includes('docker')),
  }),
}],
```

Three deliberate choices:

**A requirement names its provider.** If `requires` stated only a predicate, the
engine would have to search the cube space for something that satisfies an
arbitrary Zod schema. That is a planner, and a planner is a research project.
Naming the cube keeps resolution linear and keeps the failure message legible.

**`requires` is `(vars) => …`, like `dependencies` already is.** A requirement
almost always depends on the consumer's own variables — you cannot know *which*
user to check for until the consumer has been asked.

**Zod is the predicate language.** It is already this repo's schema vocabulary,
`z.literal` and `.refine()` cover the cases, and `z.treeifyError()` produces the
failure report for free. The cost is that `.refine()` closures are not
serialisable, so a requirement can never be written into a session — only its
*result* can. See [Sharp edges](#sharp-edges).

### The engine's rule

This is the half of the design that "only run if requirements are fulfilled"
leaves out. When a requirement is **not** met, there are three possible answers:

| | |
| --- | --- |
| **Abort** | Honest, and useless. On a bare host nothing is fulfilled, so every fresh deploy fails. |
| **Skip the cube** | A silent no-op. Dangerous. |
| **Remedy** | Run the named cube. |

It has to be *remedy* — and remedy means "run the cube that provides it", which
is `dependencies` again. That is the actual insight here, and it is a much
smaller change than a parallel subsystem:

> **You do not need a new mechanism. You need dependencies to become conditional.**

So:

- requirement **met** → the provider is *not* scheduled and its variables are
  *not* prompted for. This is where the prompt tax disappears.
- requirement **unmet** → the provider is scheduled with `with` applied as
  overrides. `with` assigns at origin `param`, which already outranks every
  other origin (`default < env < session < prompt < param`), so no new
  precedence rule is needed.

## Why `facts.py` exposes a function, not a script

The obvious design is symmetry: `deploy.py` is a script, so `facts.py` is a
script. Reject it.

A recursive resolution over a dependency tree issues one probe per (cube, host,
params). At one pyinfra invocation each, that is one SSH connection each —
seconds apiece, multiplied by the tree. Unaffordable.

But probes are **pure reads with no ordering constraints between them**, which
means every probe for a given host can be gathered in a *single* pyinfra
invocation: one generated driver script that imports each cube's `facts.py`,
calls it with its params, and emits one JSON object per host. One connection per
host per resolution round, instead of one per cube.

A standalone script can only be run alone. A function can be batched:

```python
# cubes/user/add/facts.py
from pyinfra.facts.server import Users

def gather(host, params):
    u = host.get_fact(Users).get(params["USER"])
    return {
        "exists": u is not None,
        "shell": (u or {}).get("shell"),
        "groups": (u or {}).get("groups", []),
    }
```

Consequence: params arrive as one `--data NOPY_PROBES=<json>` blob rather than
per-cube `--data KEY=…`, since a batched run carries several cubes' params at
once. Probe results are memoised per (cube, host, params) in the `BuildContext`,
the same shape as the existing `resolvedCubes` set.

## Execution model

Probes run during **resolution**, before anything has deployed. That has a
consequence worth stating plainly rather than discovering later:

When the plan reads *"user absent → schedule `user:add` → then B"*, B's
requirement was never verified. It was **assumed** met because a remedy was
scheduled. Every tool in this space stops there.

Since the probe already exists, the loop can be closed for nearly nothing:

> **Re-run the provider's probe after it deploys, and fail loudly if the
> requirement still is not met.**

`facts.py` then serves as a post-condition test as well as a precondition check.
This is the single most valuable property of the design — it is strictly more
than Ansible's `when:` offers — and it should be built in from the start rather
than added as a later refinement.

Sketch of the resolution change in `BuildContext.resolveCube`, between steps 3
(`before` hooks) and 4 (dependencies):

1. Collect `manifest.requires?.(currentVars)`.
2. Batch every unmet-so-far probe for this host into one pyinfra run.
3. Parse each result against the provider's `provides.schema`, then against the
   consumer's `expect`.
4. For each failure, `resolveCube(req.cube, host, req.with)`.
5. After that provider's deploy call executes, re-probe and assert.

Step 5 does not fit the current shape: `deployCalls` are all built first and
executed later, so a post-condition needs the executor to call back into
probing. That is the one structurally invasive part of this proposal.

## Sharp edges

**`--print-only` purity.** A dry run touches no host today. Probing breaks that
outright. Needs an explicit answer — either a probe-free plan that renders
requirements as unevaluated, or an opt-in flag. Silently connecting during what
the user believes is a dry run is not acceptable.

**Secret leakage.** `server.Users` returns the **encrypted password hash** in
its `password` field. A probe result that reaches history, a plan dump, or a log
line is a credential leak. The existing `secrets` machinery is per-*variable*
and does not apply — facts need their own redaction rule. Easy to miss, hard to
take back.

**Sessions must never persist facts.** Facts are host state at a moment in time;
a replay must re-probe, never restore. Recording them in *history* for
diagnostics is fine and useful. This is also forced by `.refine()` being
unserialisable.

**Sudo.** Many useful facts require `_sudo`, and a probe runs before the deploy
has made any of its own auth decisions. Unresolved — worth a spike.

**Cycles.** `requires` introduces a second edge type into a graph that still has
no cycle detection (see *Known drift* in `CLAUDE.md`). Conditional edges make
"A requires B, B requires A under different params" considerably more reachable
than the current unconditional ones do.

**Naming.** `provides` / `requires` over the original `facts:`, because the
field names should say which side of the relationship they belong to.

## Measured vs. assumed

Measured against pyinfra 3.5.1, on this machine:

- `fact` subcommand writes JSON to stderr and exits 0 on fact failure
- a deploy file's stdout is uncontaminated by pyinfra output
- `--data` reaches a probe as `host.data.KEY`
- a deploy file with zero operations succeeds
- a custom `FactBase` in a sibling module resolves under `--chdir`
- an exception in a deploy file exits 1
- **an unreachable host exits 0 with empty stdout**

Assumed, not yet tested:

- batching several cubes' probes into one driver script works and is meaningfully
  cheaper than N invocations — this is the load-bearing cost assumption and
  should be the first thing spiked
- `host.get_fact()` accepts `_sudo` from within a probe function
- the post-condition re-probe can be threaded through `executeDeployCalls`
  without unpicking the build-then-execute split
