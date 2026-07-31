/**
 * Dynamic dependency resolution for cubes
 * @module cubes/dependencies
 */

import type { Cube, CubeVariables, HookContext } from '@bitsquare/nopy-cubes';
import { getLogger } from '@logtape/logtape';
import type { Variables } from '../nopy.common.js';
import type { NopyConfig } from '../nopy.config.js';
import { NopyUsageError } from '../nopy.errors.js';
import type { DeployCall } from '../nopy.executor.js';
import { VariableAssignment } from '../nopy.prompts.js';
import type { CubeSession, NopySession } from '../nopy.session.js';

const log = getLogger(['nopy', 'resolution']);

/**
 * Context for the resolution process
 */
export class BuildContext {
  public readonly deployCalls: DeployCall[] = [];
  public readonly cubeSessions: CubeSession[] = [];
  private readonly resolvedCubes = new Set<string>();

  constructor(
    public readonly allCubes: Record<string, Cube>,
    public readonly variables: Variables,
    public readonly session: NopySession,
    public readonly config: NopyConfig,
    public readonly auth: {
      method: string;
      username?: string;
      password?: string;
    },
    public readonly options: {
      /** Skip the variable prompts and take whatever the non-interactive scopes hold. */
      useDefaults?: boolean;
      isSessionReplay?: boolean;
    } = {}
  ) {}

  /** Required schema keys that nothing has supplied a value for. */
  private missingRequired(cube: Cube): string[] {
    const resolved = this.variables.get(cube.id);
    return cube.requiredKeys().filter((key) => resolved[key] === undefined);
  }

  /**
   * Fails a run that cannot fill a required variable.
   *
   * Without this the cube would be deployed with the key simply absent from
   * `--data`, and the deploy script would read `None` off `host.data` — against
   * the documented guarantee that every schema key reaches it.
   *
   * Runs on the interactive path too, not only under `--use-defaults`. A prompt
   * is not proof of an answer: a terminal that misreports its size renders an
   * empty form and submits `{}` without the user seeing a field, which is
   * exactly how this was found.
   */
  private assertVariablesComplete(cube: Cube): void {
    const missing = this.missingRequired(cube);
    if (missing.length === 0) return;

    const list = missing.join(', ');
    const them = missing.length === 1 ? 'it' : 'them';
    const have = missing.length === 1 ? 'has no default value' : 'have no default values';

    throw new NopyUsageError(
      this.options.useDefaults
        ? `Cube "${cube.id}" cannot run with --use-defaults: ${list} ${have}. ` +
            `Set ${them} under "env" in .nopyrc.json, pass ${them} from a dependency, ` +
            'or drop --use-defaults to be prompted.'
        : `Cube "${cube.id}" is missing ${list}. Nothing supplied ${them} — the form may have ` +
            `been submitted empty. Re-run and fill ${them} in, or set ${them} under "env" ` +
            'in .nopyrc.json.'
    );
  }

  /**
   * Asks for the variables a replay cannot supply on its own.
   *
   * Two kinds. Required keys can be absent because the session predates them or
   * was recorded by a `--use-defaults` run. Secrets are absent by design: they
   * are never written to a session, so replaying without asking would deploy a
   * cube with the key missing — or, for a secret carrying a default, with a
   * value silently different from the run being replayed.
   *
   * Secrets are asked for even when a default did fill them in, which is why
   * this cannot key off "has no value": the whole point is that the recorded
   * answer is gone and only the user knows what it was.
   */
  private async fillSessionGaps(cube: Cube): Promise<void> {
    const gaps = [...new Set([...this.missingRequired(cube), ...cube.secrets])];
    if (gaps.length === 0) return;

    if (this.options.useDefaults) {
      // A gap is only a gap if nothing outside the session filled it. `env` and
      // `param` both say deliberately what the value is, which is exactly what
      // the old message told the user to do — and then failed anyway.
      //
      // `default` is not accepted here. The session dropped the secret on
      // purpose, so falling through to a manifest default would deploy a
      // different credential than the run being replayed, without saying so.
      const unsatisfied = gaps.filter((key) => {
        const origin = this.variables.of(cube.id, key)?.origin;
        return origin !== 'env' && origin !== 'param';
      });

      if (unsatisfied.length > 0) {
        const them = unsatisfied.length === 1 ? 'it' : 'them';
        const secret = unsatisfied.some((key) => cube.secrets.includes(key));
        throw new NopyUsageError(
          `Cube "${cube.id}" cannot be replayed with --use-defaults: ` +
            `${unsatisfied.join(', ')} would have to be entered. ` +
            (secret ? 'Secrets are never recorded in a session. ' : '') +
            `Set ${them} under "env" in .nopyrc.json` +
            (secret ? ' (a schema default is not accepted for a secret)' : '') +
            `, pass ${them} from a dependency, or replay without --use-defaults.`
        );
      }
      return;
    }

    log.debug('Filling session gaps', { cubeId: cube.id, gaps });
    await VariableAssignment(cube, this.variables, { keys: gaps });

    // A form that resolved is not a form that was answered — same check, and
    // the same reason for it, as the interactive path.
    this.assertVariablesComplete(cube);
  }

  /**
   * Resolves a cube, its dependencies, and hooks recursively
   */
  public async resolveCube(
    cubeId: string,
    host: string,
    overrides: CubeVariables = {}
  ): Promise<void> {
    const cube = this.allCubes[cubeId];
    if (!cube) {
      throw new NopyUsageError(`Cube not found: ${cubeId}`);
    }

    log.debug('Resolving cube', { cubeId, host });

    // 1. Declare secrets and schema, then assign overrides and defaults. Both
    //    declarations have to come first: the cube's first assignment is what
    //    seeds the config `env` onto it, and by then it must already be known
    //    which of those keys are secret (so nothing reaches a session or a log
    //    unredacted) and which the cube actually declares (so a secret it does
    //    not declare is never seeded at all).
    this.variables.declareSecrets(cubeId, cube.secrets);
    this.variables.declareSchema(cubeId, cube.schemaKeys());
    if (Object.keys(overrides).length > 0) {
      this.variables.assign(cubeId, 'param', overrides);
    }
    this.variables.assign(cubeId, 'default', cube.getDefaults());

    // 2. Variable collection
    if (this.options.isSessionReplay) {
      const sessionCube = this.session.cubes.find((c) => c.key === cubeId);
      if (sessionCube) {
        this.variables.assign(cubeId, 'session', sessionCube.variables);
      }
      await this.fillSessionGaps(cube);
    } else if (this.options.useDefaults) {
      log.debug('Skipping prompts, using defaults', { cubeId });
      this.assertVariablesComplete(cube);
    } else {
      await VariableAssignment(cube, this.variables);
      this.assertVariablesComplete(cube);
    }

    const currentVars = this.variables.get(cubeId);
    const hookCtx: HookContext = {
      exec: (id, vars) => this.resolveCube(id, host, vars),
    };

    // 3. Execute 'before' hooks
    if (cube.manifest.before) {
      for (const hook of cube.manifest.before) {
        await hook(hookCtx, currentVars);
      }
    }

    // 4. Resolve dynamic dependencies
    const depSpecs = cube.manifest.dependencies?.(currentVars) ?? [];
    for (const spec of depSpecs) {
      const depId = typeof spec === 'string' ? spec : spec[0];
      const depVars = typeof spec === 'string' ? {} : (spec[1] ?? {});
      await this.resolveCube(depId, host, depVars);
    }

    // 5. Build the deployment call
    this.buildDeployCall(cube, host);

    // 6. Execute 'after' hooks
    if (cube.manifest.after) {
      for (const hook of cube.manifest.after) {
        await hook(hookCtx, currentVars);
      }
    }
  }

  /**
   * Builds and stores a deployment call for a resolved cube
   */
  private buildDeployCall(cube: Cube, host: string): void {
    const cubeId = cube.id;
    const callKey = `${cubeId}:${host}`;

    if (this.resolvedCubes.has(callKey)) return;

    const parts: string[] = [];
    if (this.auth.method === 'password' && this.auth.username && this.auth.password) {
      parts.push(`--user ${this.auth.username} --password ${this.auth.password}`);
    }

    const cubeVars = this.variables.get(cubeId);
    Object.entries(cubeVars).forEach(([key, value]) => {
      parts.push(`--data "${key}=${value}"`);
    });

    parts.push(`--chdir ${cube.dir}`);
    parts.push(`${cube.dir}/${cube.deployScript}`);

    const command = ['pyinfra', host, '-y', ...parts];

    this.deployCalls.push({
      cube: cubeId,
      host,
      cwd: cube.dir,
      command,
      env: cubeVars,
      secrets: cube.secrets,
      dependencies: [],
    });

    if (!this.cubeSessions.some((s) => s.key === cubeId)) {
      // Every value the run settled on, not just the prompted ones — otherwise a
      // `--use-defaults` run records nothing and replaying it re-derives from
      // whatever the defaults and `env` happen to say now. Secrets are the one
      // exclusion; a replay asks for those again.
      this.cubeSessions.push({
        key: cubeId,
        variables: this.variables.persistable(cubeId),
      });
    }

    this.resolvedCubes.add(callKey);
  }
}
