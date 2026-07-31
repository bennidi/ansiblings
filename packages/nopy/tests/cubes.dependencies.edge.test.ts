/**
 * Edge cases for BuildContext: unknown cubes, session replay and auth flags.
 */

import { type AnyObjectSchema, Cube, Manifest } from '@bitsquare/nopy-cubes';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { BuildContext } from '../src/cubes/dependencies.js';
import { Variables } from '../src/nopy.common.js';
import type { NopyConfig } from '../src/nopy.config.js';
import type { NopySession } from '../src/nopy.session.js';

vi.mock('../src/nopy.prompts.js', async () => {
  const actual = await vi.importActual('../src/nopy.prompts.js');
  return { ...actual, VariableAssignment: vi.fn() };
});

import { VariableAssignment } from '../src/nopy.prompts.js';

const testCube = (id: string, schema = z.object({})) =>
  new Cube(Manifest.create({ id, name: `Test ${id}`, schema }), `/test/${id}`, 'deploy.py');

/** A cube whose PASSWORD the manifest declares a secret. */
const secretCube = (id: string, schema: AnyObjectSchema) =>
  new Cube(
    Manifest.create({ id, name: `Test ${id}`, schema, secrets: ['PASSWORD'] }),
    `/test/${id}`,
    'deploy.py'
  );

const config = { env: {} } as NopyConfig;
const session = (cubes: NopySession['cubes'] = []) => ({ cubes }) as NopySession;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('BuildContext error handling', () => {
  it('throws when the requested cube does not exist', async () => {
    const context = new BuildContext({}, new Variables(), session(), config, { method: 'ssh' });

    await expect(context.resolveCube('ghost', 'host1')).rejects.toThrow('Cube not found: ghost');
  });

  it('throws when a dependency does not exist', async () => {
    const cubeB = new Cube(
      Manifest.create({
        id: 'cube-b',
        name: 'B',
        schema: z.object({}),
        dependencies: () => ['ghost'],
      }),
      '/test/cube-b',
      'deploy.py'
    );
    const context = new BuildContext({ 'cube-b': cubeB }, new Variables(), session(), config, {
      method: 'ssh',
    });

    await expect(context.resolveCube('cube-b', 'host1')).rejects.toThrow('Cube not found: ghost');
  });
});

describe('BuildContext session replay', () => {
  it('takes variables from the session instead of prompting', async () => {
    const cube = testCube('cube-a', z.object({ PORT: z.string().default('3000') }));
    const vars = new Variables();
    const context = new BuildContext(
      { 'cube-a': cube },
      vars,
      session([{ key: 'cube-a', variables: { PORT: '9090' } }]),
      config,
      { method: 'ssh' },
      { isSessionReplay: true }
    );

    await context.resolveCube('cube-a', 'host1');

    expect(VariableAssignment).not.toHaveBeenCalled();
    expect(context.deployCalls[0].env.PORT).toBe('9090');
  });

  it('falls back to schema defaults when the session has no entry for the cube', async () => {
    const cube = testCube('cube-a', z.object({ PORT: z.string().default('3000') }));
    const context = new BuildContext(
      { 'cube-a': cube },
      new Variables(),
      session([{ key: 'other', variables: { PORT: '9090' } }]),
      config,
      { method: 'ssh' },
      { isSessionReplay: true }
    );

    await context.resolveCube('cube-a', 'host1');

    expect(VariableAssignment).not.toHaveBeenCalled();
    expect(context.deployCalls[0].env.PORT).toBe('3000');
  });

  it('prompts when not replaying', async () => {
    const context = new BuildContext(
      { 'cube-a': testCube('cube-a') },
      new Variables(),
      session(),
      config,
      { method: 'ssh' }
    );

    await context.resolveCube('cube-a', 'host1');

    expect(VariableAssignment).toHaveBeenCalled();
  });

  it('lets a recorded value beat config env', async () => {
    const cube = testCube('cube-a', z.object({ PORT: z.string().default('3000') }));
    const context = new BuildContext(
      { 'cube-a': cube },
      new Variables({ PORT: '2222' }),
      session([{ key: 'cube-a', variables: { PORT: '9090' } }]),
      { env: { PORT: '2222' } } as NopyConfig,
      { method: 'ssh' },
      { isSessionReplay: true }
    );

    await context.resolveCube('cube-a', 'host1');

    expect(context.deployCalls[0].env.PORT).toBe('9090');
  });
});

describe('BuildContext replay gaps', () => {
  const replay = (
    cube: Cube,
    recorded: Record<string, string> = {},
    options = {},
    variables = new Variables()
  ) =>
    new BuildContext(
      { [cube.id]: cube },
      variables,
      session([{ key: cube.id, variables: recorded }]),
      config,
      { method: 'ssh' },
      { isSessionReplay: true, ...options }
    );

  it('asks for a required variable the session never recorded', async () => {
    const cube = testCube('cube-a', z.object({ SSID: z.string() }));
    vi.mocked(VariableAssignment).mockImplementation(async (_cube, variables) => {
      variables.assign('cube-a', 'prompt', { SSID: 'typed' });
    });

    const context = replay(cube);
    await context.resolveCube('cube-a', 'host1');

    expect(VariableAssignment).toHaveBeenCalledWith(cube, expect.anything(), { keys: ['SSID'] });
    expect(context.deployCalls[0].env.SSID).toBe('typed');
  });

  it('asks for a secret even though a default already filled it in', async () => {
    const cube = secretCube('cube-a', z.object({ PASSWORD: z.string().default('changeme') }));
    vi.mocked(VariableAssignment).mockImplementation(async (_cube, variables) => {
      variables.assign('cube-a', 'prompt', { PASSWORD: 'real' });
    });

    const context = replay(cube);
    await context.resolveCube('cube-a', 'host1');

    expect(VariableAssignment).toHaveBeenCalledWith(cube, expect.anything(), {
      keys: ['PASSWORD'],
    });
    expect(context.deployCalls[0].env.PASSWORD).toBe('real');
  });

  it('asks nothing when the session covers everything', async () => {
    const cube = testCube('cube-a', z.object({ SSID: z.string() }));

    await replay(cube, { SSID: 'recorded' }).resolveCube('cube-a', 'host1');

    expect(VariableAssignment).not.toHaveBeenCalled();
  });

  it('refuses to deploy when the form came back empty', async () => {
    const cube = testCube('cube-a', z.object({ SSID: z.string() }));
    // A form that resolves is not proof of an answer: enquirer renders
    // `Math.min(limit, height)` fields, so a terminal misreporting its height
    // submits `{}` without the user having seen a question. The gap check has
    // to run again afterwards or the cube ships without the variable.
    vi.mocked(VariableAssignment).mockResolvedValue(undefined);

    const context = replay(cube);

    await expect(context.resolveCube('cube-a', 'host1')).rejects.toThrow(
      'Cube "cube-a" is missing SSID. Nothing supplied it'
    );
    expect(context.deployCalls).toHaveLength(0);
  });

  it('cannot fill a gap when --use-defaults forbids prompting', async () => {
    const cube = secretCube('cube-a', z.object({ PASSWORD: z.string().default('changeme') }));

    const context = replay(cube, {}, { useDefaults: true });

    // A schema default is deliberately not good enough for a secret: it would
    // deploy a different credential than the run being replayed.
    await expect(context.resolveCube('cube-a', 'host1')).rejects.toThrow(
      /cannot be replayed with --use-defaults: PASSWORD would have to be entered\..*not accepted for a secret/s
    );
  });

  it('accepts a secret supplied through config env under --use-defaults', async () => {
    const cube = secretCube('cube-a', z.object({ PASSWORD: z.string().default('changeme') }));
    const context = replay(
      cube,
      {},
      { useDefaults: true },
      new Variables({ PASSWORD: 'from-env' }, ['PASSWORD'])
    );

    await context.resolveCube('cube-a', 'host1');

    expect(VariableAssignment).not.toHaveBeenCalled();
    expect(context.deployCalls[0].env.PASSWORD).toBe('from-env');
  });

  it('accepts a required variable a dependency passed under --use-defaults', async () => {
    const cube = testCube('cube-a', z.object({ SSID: z.string() }));
    const context = replay(cube, {}, { useDefaults: true });

    await context.resolveCube('cube-a', 'host1', { SSID: 'from-param' });

    expect(context.deployCalls[0].env.SSID).toBe('from-param');
  });
});

describe('BuildContext session recording', () => {
  it('records every value the run settled on, not only the prompted ones', async () => {
    const cube = testCube('cube-a', z.object({ PORT: z.string().default('3000') }));
    const context = new BuildContext(
      { 'cube-a': cube },
      new Variables({ REGION: 'eu' }),
      session(),
      config,
      { method: 'ssh' },
      { useDefaults: true }
    );

    await context.resolveCube('cube-a', 'host1');

    expect(context.cubeSessions[0].variables).toEqual({ PORT: '3000', REGION: 'eu' });
  });

  it('keeps a declared secret out of the session', async () => {
    const cube = secretCube(
      'cube-a',
      z.object({ USER: z.string().default('bob'), PASSWORD: z.string().default('changeme') })
    );
    const context = new BuildContext(
      { 'cube-a': cube },
      new Variables(),
      session(),
      config,
      { method: 'ssh' },
      { useDefaults: true }
    );

    await context.resolveCube('cube-a', 'host1');

    // Still handed to pyinfra — just never written down.
    expect(context.deployCalls[0].env.PASSWORD).toBe('changeme');
    expect(context.deployCalls[0].secrets).toEqual(['PASSWORD']);
    expect(context.cubeSessions[0].variables).toEqual({ USER: 'bob' });
  });
});

describe('BuildContext secret broadcast', () => {
  // The field run put PASSWORD under `env` because the docs said to, and watched
  // it appear unmasked on the command line of every cube that was not user:add.
  const resolveBoth = async () => {
    const declaring = secretCube('cube-a', z.object({ PASSWORD: z.string().default('changeme') }));
    const innocent = testCube('cube-b', z.object({ PORT: z.string().default('22') }));
    const context = new BuildContext(
      { 'cube-a': declaring, 'cube-b': innocent },
      new Variables({ PASSWORD: 'wildpass123', KEY_DIR: '/vault' }, ['PASSWORD']),
      session(),
      config,
      { method: 'ssh' },
      { useDefaults: true }
    );

    await context.resolveCube('cube-a', 'host1');
    await context.resolveCube('cube-b', 'host1');
    return context;
  };

  it('never puts an env secret on a cube that does not declare it', async () => {
    const context = await resolveBoth();
    const [, forB] = context.deployCalls;

    expect(forB.cube).toBe('cube-b');
    expect(forB.env).not.toHaveProperty('PASSWORD');
    expect(forB.command.join(' ')).not.toContain('wildpass123');
  });

  it('still delivers it to the cube that declares it', async () => {
    const context = await resolveBoth();
    const [forA] = context.deployCalls;

    expect(forA.env.PASSWORD).toBe('wildpass123');
    expect(forA.secrets).toEqual(['PASSWORD']);
  });

  it('leaves an ordinary env key broadcast to both', async () => {
    const context = await resolveBoth();

    expect(context.deployCalls.map((call) => call.env.KEY_DIR)).toEqual(['/vault', '/vault']);
  });
});

describe('BuildContext --use-defaults', () => {
  const withDefaults = (cube: Cube, variables = new Variables(), cfg = config) =>
    new BuildContext(
      { [cube.id]: cube },
      variables,
      session(),
      cfg,
      { method: 'ssh' },
      { useDefaults: true }
    );

  it('skips the prompts and deploys the schema defaults', async () => {
    const cube = testCube('cube-a', z.object({ PORT: z.string().default('3000') }));
    const context = withDefaults(cube);

    await context.resolveCube('cube-a', 'host1');

    expect(VariableAssignment).not.toHaveBeenCalled();
    expect(context.deployCalls[0].env.PORT).toBe('3000');
  });

  it('lets global env steer the run', async () => {
    const cube = testCube('cube-a', z.object({ PORT: z.string().default('3000') }));
    const context = withDefaults(cube, new Variables({ PORT: '8080' }));

    await context.resolveCube('cube-a', 'host1');

    expect(context.deployCalls[0].command.join(' ')).toContain('--data "PORT=8080"');
  });

  it('refuses to run a cube whose variable nothing can supply', async () => {
    const cube = testCube('cube-a', z.object({ SSID: z.string(), PSK: z.string() }));
    const context = withDefaults(cube);

    await expect(context.resolveCube('cube-a', 'host1')).rejects.toThrow(
      /Cube "cube-a" cannot run with --use-defaults: SSID, PSK have no default values/
    );
    expect(context.deployCalls).toHaveLength(0);
  });

  it('names a single missing variable in the singular', async () => {
    const cube = testCube('cube-a', z.object({ SSID: z.string() }));

    await expect(withDefaults(cube).resolveCube('cube-a', 'host1')).rejects.toThrow(
      'SSID has no default value'
    );
  });

  it('accepts a required variable supplied by global env', async () => {
    const cube = testCube('cube-a', z.object({ SSID: z.string() }));
    const context = withDefaults(cube, new Variables({ SSID: 'home' }));

    await context.resolveCube('cube-a', 'host1');

    expect(context.deployCalls[0].env.SSID).toBe('home');
  });

  it('accepts a required variable supplied by a dependency', async () => {
    const cube = testCube('cube-a', z.object({ SSID: z.string() }));
    const context = withDefaults(cube);

    await context.resolveCube('cube-a', 'host1', { SSID: 'from-dep' });

    expect(context.deployCalls[0].env.SSID).toBe('from-dep');
  });

  it('still resolves dependencies and hooks', async () => {
    const dep = testCube('dep');
    const main = new Cube(
      Manifest.create({
        id: 'main',
        name: 'Main',
        schema: z.object({ FLAG: z.boolean().default(true) }),
        dependencies: (vars: Record<string, unknown>) => (vars.FLAG ? ['dep'] : []),
      }),
      '/test/main',
      'deploy.py'
    );
    const context = new BuildContext(
      { dep, main },
      new Variables(),
      session(),
      config,
      { method: 'ssh' },
      { useDefaults: true }
    );

    await context.resolveCube('main', 'host1');

    expect(context.deployCalls.map((c) => c.cube)).toEqual(['dep', 'main']);
  });
});

describe('BuildContext interactive completeness', () => {
  const interactive = (cube: Cube, variables = new Variables()) =>
    new BuildContext({ [cube.id]: cube }, variables, session(), config, { method: 'ssh' });

  it('refuses to deploy when the form submitted nothing', async () => {
    const cube = testCube('cube-a', z.object({ SSID: z.string() }));
    // What a 0-row terminal does: the form renders no fields, the user sees no
    // question, enquirer resolves `{}` and the run used to carry on and deploy
    // the cube with SSID simply absent from `--data`.
    vi.mocked(VariableAssignment).mockResolvedValue(undefined);

    const context = interactive(cube);

    await expect(context.resolveCube('cube-a', 'host1')).rejects.toThrow(
      /Cube "cube-a" is missing SSID\. Nothing supplied it/
    );
    expect(context.deployCalls).toHaveLength(0);
  });

  it('deploys when the form answered', async () => {
    const cube = testCube('cube-a', z.object({ SSID: z.string() }));
    vi.mocked(VariableAssignment).mockImplementation(async (_cube, variables) => {
      variables.assign('cube-a', 'prompt', { SSID: 'typed' });
    });

    const context = interactive(cube);
    await context.resolveCube('cube-a', 'host1');

    expect(context.deployCalls[0].env.SSID).toBe('typed');
  });
});

describe('BuildContext command construction', () => {
  const build = (auth: { method: string; username?: string; password?: string }) => {
    const context = new BuildContext(
      { 'cube-a': testCube('cube-a') },
      new Variables(),
      session(),
      config,
      auth
    );
    return context.resolveCube('cube-a', 'host1').then(() => context);
  };

  it('adds --user/--password for complete password auth', async () => {
    const context = await build({ method: 'password', username: 'deploy', password: 'pw' });

    expect(context.deployCalls[0].command.join(' ')).toContain('--user deploy --password pw');
  });

  it('omits credentials for ssh auth', async () => {
    const context = await build({ method: 'ssh' });

    expect(context.deployCalls[0].command.join(' ')).not.toContain('--user');
  });

  it('omits credentials when the password is missing', async () => {
    const context = await build({ method: 'password', username: 'deploy' });

    expect(context.deployCalls[0].command.join(' ')).not.toContain('--user');
  });

  it('omits credentials when the username is missing', async () => {
    const context = await build({ method: 'password', password: 'pw' });

    expect(context.deployCalls[0].command.join(' ')).not.toContain('--user');
  });

  it('passes cube variables as --data flags and points at the deploy script', async () => {
    const cube = testCube('cube-a', z.object({ PORT: z.string().default('3000') }));
    const context = new BuildContext({ 'cube-a': cube }, new Variables(), session(), config, {
      method: 'ssh',
    });

    await context.resolveCube('cube-a', 'host1');
    const command = context.deployCalls[0].command.join(' ');

    expect(command).toContain('--data "PORT=3000"');
    expect(command).toContain('--chdir /test/cube-a');
    expect(command).toContain('/test/cube-a/deploy.py');
    expect(context.deployCalls[0].cwd).toBe('/test/cube-a');
  });

  it('builds a separate call per host but records the cube session once', async () => {
    const context = new BuildContext(
      { 'cube-a': testCube('cube-a') },
      new Variables(),
      session(),
      config,
      { method: 'ssh' }
    );

    await context.resolveCube('cube-a', 'host1');
    await context.resolveCube('cube-a', 'host2');

    expect(context.deployCalls.map((c) => c.host)).toEqual(['host1', 'host2']);
    expect(context.cubeSessions).toHaveLength(1);
  });

  it('applies caller overrides as params', async () => {
    const cube = testCube('cube-a', z.object({ PORT: z.string().default('3000') }));
    const context = new BuildContext({ 'cube-a': cube }, new Variables(), session(), config, {
      method: 'ssh',
    });

    await context.resolveCube('cube-a', 'host1', { PORT: '8080' });

    expect(context.deployCalls[0].env.PORT).toBe('8080');
  });
});
