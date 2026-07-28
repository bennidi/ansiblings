/**
 * Dynamic dependency resolution for cubes
 * @module cubes/dependencies
 */

import type { Cube, CubeVariables, HookContext } from '@bitsquare/nopy-cube';
import { getLogger } from '@logtape/logtape';
import type { Variables } from '../nopy.common.js';
import type { NopyConfig } from '../nopy.config.js';
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
   * Fails a non-interactive run that cannot fill a required variable.
   *
   * Without this the cube would be deployed with the key simply absent from
   * `--data`, and the deploy script would read `None` off `host.data`.
   */
  private assertVariablesComplete(cube: Cube): void {
    const missing = this.missingRequired(cube);
    if (missing.length === 0) return;

    const [one, them] =
      missing.length === 1 ? ['has no default value', 'it'] : ['have no default values', 'them'];
    throw new Error(
      `Cube "${cube.id}" cannot run with --use-defaults: ${missing.join(', ')} ${one}. ` +
        `Set ${them} under "env" in .nopyrc.json, pass ${them} from a dependency, ` +
        'or drop --use-defaults to be prompted.'
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
      throw new Error(
        `Cube "${cube.id}" cannot be replayed with --use-defaults: ${gaps.join(', ')} ` +
          'would have to be entered. Secrets are never recorded in a session. ' +
          'Replay without --use-defaults, or set the values under "env" in .nopyrc.json.'
      );
    }

    log.debug('Filling session gaps', { cubeId: cube.id, gaps });
    await VariableAssignment(cube, this.variables, { keys: gaps });

    // A cancelled form leaves the run short of a value it cannot invent.
    const stillMissing = this.missingRequired(cube);
    if (stillMissing.length > 0) {
      throw new Error(
        `Cube "${cube.id}" is missing ${stillMissing.join(', ')} and cannot be deployed.`
      );
    }
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
      throw new Error(`Cube not found: ${cubeId}`);
    }

    log.debug('Resolving cube', { cubeId, host });

    // 1. Declare secrets, then assign overrides and defaults. Declaring first
    //    means even the config `env` seeded on the cube's first assignment is
    //    already marked, so nothing reaches a session or a log unredacted.
    this.variables.declareSecrets(cubeId, cube.secrets);
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
