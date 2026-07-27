/**
 * Dynamic dependency resolution for cubes
 * @module cubes/dependencies
 */
import { getLogger } from '@logtape/logtape';
import { VariableAssignment } from '../nopy.prompts.js';
const log = getLogger(['nopy', 'resolution']);
/**
 * Context for the resolution process
 */
export class BuildContext {
    allCubes;
    variables;
    session;
    config;
    auth;
    options;
    deployCalls = [];
    cubeSessions = [];
    resolvedCubes = new Set();
    constructor(allCubes, variables, session, config, auth, options = {}) {
        this.allCubes = allCubes;
        this.variables = variables;
        this.session = session;
        this.config = config;
        this.auth = auth;
        this.options = options;
    }
    /**
     * Resolves a cube, its dependencies, and hooks recursively
     */
    async resolveCube(cubeId, host, overrides = {}) {
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
            const sessionCube = this.session.cubes.find(c => c.key === cubeId);
            if (sessionCube) {
                this.variables.assign(cubeId, 'defaults', sessionCube.variables);
            }
        }
        else {
            await VariableAssignment(cube, this.variables);
        }
        const currentVars = this.variables.get(cubeId);
        const hookCtx = {
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
    buildDeployCall(cube, host) {
        const cubeId = cube.id;
        const callKey = `${cubeId}:${host}`;
        if (this.resolvedCubes.has(callKey))
            return;
        const parts = [];
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
        if (!this.cubeSessions.some(s => s.key === cubeId)) {
            this.cubeSessions.push({
                key: cubeId,
                variables: this.variables.get(cubeId, 'prompts'),
            });
        }
        this.resolvedCubes.add(callKey);
    }
}
