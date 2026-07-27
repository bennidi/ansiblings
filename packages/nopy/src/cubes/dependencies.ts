/**
 * Dynamic dependency resolution for cubes
 * @module cubes/dependencies
 */

import { getLogger } from '@logtape/logtape';
import type { Variables } from '../nopy.common.js';
import type { NopyConfig } from '../nopy.config.js';
import type { DeployCall } from '../nopy.executor.js';
import { VariableAssignment } from '../nopy.prompts.js';
import type { CubeSession, NopySession } from '../nopy.session.js';
import type { Cube, CubeVariables, HookContext } from './types.js';

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
      useDefaults?: boolean;
      isSessionReplay?: boolean;
    } = {}
  ) {}

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

    // 1. Assign overrides and defaults
    if (Object.keys(overrides).length > 0) {
      this.variables.assign(cubeId, 'params', overrides);
    }
    this.variables.assign(cubeId, 'defaults', cube.getDefaults());

    // 2. Variable collection
    if (this.options.isSessionReplay) {
      const sessionCube = this.session.cubes.find((c) => c.key === cubeId);
      if (sessionCube) {
        this.variables.assign(cubeId, 'defaults', sessionCube.variables);
      }
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
      dependencies: [],
    });

    if (!this.cubeSessions.some((s) => s.key === cubeId)) {
      this.cubeSessions.push({
        key: cubeId,
        variables: this.variables.get(cubeId, 'prompts'),
      });
    }

    this.resolvedCubes.add(callKey);
  }
}
