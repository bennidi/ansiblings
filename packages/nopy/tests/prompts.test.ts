/**
 * Tests for nopy.prompts.
 *
 * inquirer and enquirer are mocked so nothing touches a TTY. What is actually
 * under test is the logic wrapped around them: choice construction, the `when`
 * predicates, host-string mapping and zod-driven value coercion.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const { inquirerPrompt, formRun, formCtor, autoCompleteRun, autoCompleteCtor } = vi.hoisted(() => ({
  inquirerPrompt: vi.fn(),
  formRun: vi.fn(),
  formCtor: vi.fn(),
  autoCompleteRun: vi.fn(),
  autoCompleteCtor: vi.fn(),
}));

vi.mock('inquirer', () => ({
  default: { prompt: inquirerPrompt },
}));
vi.mock('enquirer', () => ({
  default: {
    Form: class {
      run = formRun;
      constructor(options: unknown) {
        formCtor(options);
      }
    },
    AutoComplete: class {
      run = autoCompleteRun;
      constructor(options: unknown) {
        autoCompleteCtor(options);
      }
    },
  },
}));

import { Cube, Manifest } from '@bitsquare/nopy-cubes';
import { Variables } from '../src/nopy.common.js';
import {
  AuthSelection,
  CubeSelection,
  HostSelection,
  PasswordSelection,
  VariableAssignment,
} from '../src/nopy.prompts.js';
import { foreignZodSchema } from './helpers/foreign-zod.js';

/** Grabs the single question object passed to the last inquirer.prompt call. */
const questions = () => inquirerPrompt.mock.calls.at(-1)?.[0] as Record<string, any>[];
const question = (name: string) => questions().find((q) => q.name === name);

/** Grabs the options the last enquirer AutoComplete prompt was constructed with. */
const autoComplete = () => autoCompleteCtor.mock.calls.at(-1)?.[0] as Record<string, any>;

/** Grabs the choices the last enquirer Form prompt was constructed with. */
const formChoices = () => {
  const options = formCtor.mock.calls.at(-1)?.[0] as { choices: Record<string, any>[] };
  return options.choices;
};

const cube = (id: string, name: string, schema = z.object({})) =>
  new Cube(Manifest({ id, name, schema }), `/cubes/${id}`, 'deploy.py');

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

describe('CubeSelection', () => {
  const cubes = {
    b: cube('cube-b', 'Beta'),
    a: cube('cube-a', 'Alpha'),
  };

  it('returns the selection', async () => {
    autoCompleteRun.mockResolvedValue(['cube-a']);

    await expect(CubeSelection(cubes)).resolves.toEqual({ selectedCubes: ['cube-a'] });
  });

  it('sorts choices by cube id', async () => {
    autoCompleteRun.mockResolvedValue([]);

    await CubeSelection(cubes);

    const { choices } = autoComplete();
    expect(choices.map((c: { name: string }) => c.name)).toEqual(['cube-a', 'cube-b']);
    expect(choices[0].message).toBe('cube-a - Alpha');
  });

  it('returns every choice for an undefined filter', async () => {
    autoCompleteRun.mockResolvedValue([]);

    await CubeSelection(cubes);

    const { choices, suggest } = autoComplete();
    expect(suggest(undefined, choices)).toHaveLength(2);
    expect(suggest('', choices)).toHaveLength(2);
  });

  it('fuzzy filters on the visible label', async () => {
    autoCompleteRun.mockResolvedValue([]);

    await CubeSelection(cubes);

    const { choices, suggest } = autoComplete();
    expect(suggest('Alph', choices).map((c: { name: string }) => c.name)).toEqual(['cube-a']);
  });

  it('derives page size from the terminal height', async () => {
    autoCompleteRun.mockResolvedValue([]);
    const rows = process.stdout.rows;

    Object.defineProperty(process.stdout, 'rows', { value: 40, configurable: true });
    await CubeSelection(cubes);
    expect(autoComplete().limit).toBe(35);

    // Falls back to a floor of 10 on a short (or unknown) terminal.
    Object.defineProperty(process.stdout, 'rows', { value: 0, configurable: true });
    await CubeSelection(cubes);
    expect(autoComplete().limit).toBe(19);

    Object.defineProperty(process.stdout, 'rows', { value: rows, configurable: true });
  });

  it('selects nothing when the user cancels', async () => {
    autoCompleteRun.mockRejectedValue(new Error('cancelled'));

    await expect(CubeSelection(cubes)).resolves.toEqual({ selectedCubes: [] });
  });
});

describe('AuthSelection', () => {
  it('short-circuits to ssh-key without prompting', async () => {
    await expect(AuthSelection(true)).resolves.toEqual({ authMethod: 'ssh-key' });
    expect(inquirerPrompt).not.toHaveBeenCalled();
  });

  it('prompts when no key is forced', async () => {
    inquirerPrompt.mockResolvedValue({ authMethod: 'password', username: 'u', password: 'p' });

    await expect(AuthSelection()).resolves.toEqual({
      authMethod: 'password',
      username: 'u',
      password: 'p',
    });
  });

  it('asks for credentials only when the method is not ssh-key', async () => {
    inquirerPrompt.mockResolvedValue({ authMethod: 'ssh-key' });

    await AuthSelection(false);

    expect(question('username')?.when({ authMethod: 'password' })).toBe(true);
    expect(question('username')?.when({ authMethod: 'ssh-key' })).toBe(false);
    expect(question('password')?.when({ authMethod: 'password' })).toBe(true);
    expect(question('password')?.when({ authMethod: 'ssh-key' })).toBe(false);
  });
});

describe('PasswordSelection', () => {
  it('returns the entered password', async () => {
    inquirerPrompt.mockResolvedValue({ password: 'hunter2' });

    await expect(PasswordSelection('deploy')).resolves.toBe('hunter2');
    expect(question('password')?.message).toContain('deploy');
  });
});

describe('HostSelection', () => {
  it('offers the configured hosts alongside the built-ins', async () => {
    inquirerPrompt.mockResolvedValue({ host: 'web-1' });

    await HostSelection(['web-1', 'web-2']);

    expect(question('host')?.choices).toEqual(['docker', 'vagrant', 'web-1', 'web-2', 'custom']);
  });

  it('returns a plain host as-is', async () => {
    inquirerPrompt.mockResolvedValue({ host: 'web-1' });

    await expect(HostSelection(['web-1'])).resolves.toBe('web-1');
  });

  it('returns the custom address when custom is chosen', async () => {
    inquirerPrompt.mockResolvedValue({ host: 'custom', customHost: '10.0.0.5' });

    await expect(HostSelection([])).resolves.toBe('10.0.0.5');
  });

  it('prefixes a vagrant machine', async () => {
    inquirerPrompt.mockResolvedValue({ host: 'vagrant', vagrantVM: 'builder' });

    await expect(HostSelection([])).resolves.toBe('@vagrant/builder');
  });

  it('prefixes a docker container', async () => {
    inquirerPrompt.mockResolvedValue({ host: 'runtime:docker', dockerContainer: 'box' });

    await expect(HostSelection([])).resolves.toBe('@docker/box');
  });

  it('gates the follow-up questions on the chosen host', async () => {
    inquirerPrompt.mockResolvedValue({ host: 'web-1' });

    await HostSelection([]);

    expect(question('customHost')?.when({ host: 'custom' })).toBe(true);
    expect(question('customHost')?.when({ host: 'web-1' })).toBe(false);
    expect(question('vagrantVM')?.when({ host: 'vagrant' })).toBe(true);
    expect(question('vagrantVM')?.when({ host: 'web-1' })).toBe(false);
    expect(question('dockerContainer')?.when({ host: 'runtime:docker' })).toBe(true);
    expect(question('dockerContainer')?.when({ host: 'web-1' })).toBe(false);
  });
});

describe('question types', () => {
  it('declares only types the installed inquirer actually ships', async () => {
    // Checked against the real module, not the mock: `list` was accepted for
    // years and inquirer 14 dropped it, which took out host selection entirely
    // — a failure no amount of mocked prompting can see.
    const actual = await vi.importActual<typeof import('inquirer')>('inquirer');
    const supported = Object.keys(actual.createPromptModule().prompts);

    inquirerPrompt.mockResolvedValue({ host: 'web-1' });
    await HostSelection(['web-1']);
    inquirerPrompt.mockResolvedValue({ authMethod: 'password', username: 'u', password: 'p' });
    await AuthSelection(false);
    inquirerPrompt.mockResolvedValue({ password: 'p' });
    await PasswordSelection('deploy');

    const declared = new Set(
      inquirerPrompt.mock.calls.flatMap(([asked]: [Record<string, any>[]]) =>
        asked.map((q) => q.type ?? 'input')
      )
    );

    expect(declared.size).toBeGreaterThan(0);
    expect(supported).toEqual(expect.arrayContaining([...declared]));
  });
});

describe('VariableAssignment', () => {
  const schema = z.object({
    port: z.number().default(8080).describe('Listen port'),
    enabled: z.boolean().default(false),
    name: z.string().default('svc'),
  });

  it('does nothing when every default is already supplied as a param', async () => {
    const variables = new Variables();
    variables.assign('svc', 'param', { port: 1, enabled: true, name: 'x' });

    await VariableAssignment(cube('svc', 'Service', schema), variables);

    expect(formRun).not.toHaveBeenCalled();
  });

  it('does nothing for a cube with no defaults', async () => {
    await VariableAssignment(cube('bare', 'Bare'), new Variables());

    expect(formRun).not.toHaveBeenCalled();
  });

  it('leaves out a key a dependency already supplied', async () => {
    const variables = new Variables();
    variables.assign('svc', 'param', { port: 9090 });
    formRun.mockResolvedValue({});

    await VariableAssignment(cube('svc', 'Service', schema), variables);

    expect(formChoices().map((c) => c.name)).toEqual(['enabled', 'name']);
  });

  it('asks about a field that declares no default, with an empty initial value', async () => {
    const wifi = cube(
      'wifi',
      'WiFi',
      z.object({
        SSID: z.string().describe('Network name'),
        PRIORITY: z.number().default(10),
      })
    );
    const variables = new Variables();
    variables.assign('wifi', 'default', wifi.getDefaults());
    formRun.mockResolvedValue({});

    await VariableAssignment(wifi, variables);

    expect(formChoices()).toEqual([
      { name: 'SSID', message: 'Network name', initial: '' },
      { name: 'PRIORITY', message: 'PRIORITY', initial: '10' },
    ]);
  });

  it('offers the value the run would use, not the bare schema default', async () => {
    const svc = cube('svc', 'Service', schema);
    const variables = new Variables({ port: 2222 });
    variables.assign('svc', 'default', svc.getDefaults());
    formRun.mockResolvedValue({});

    await VariableAssignment(svc, variables);

    expect(formChoices().find((c) => c.name === 'port')?.initial).toBe('2222');
  });

  it('asks only about the given keys', async () => {
    const svc = cube('svc', 'Service', schema);
    const variables = new Variables();
    variables.assign('svc', 'default', svc.getDefaults());
    formRun.mockResolvedValue({});

    await VariableAssignment(svc, variables, { keys: ['name'] });

    expect(formChoices()).toEqual([{ name: 'name', message: 'name', initial: 'svc' }]);
  });

  it('coerces answers using the schema and stores them under prompts', async () => {
    const variables = new Variables();
    formRun.mockResolvedValue({ port: '9090', enabled: 'true', name: 'api' });

    await VariableAssignment(cube('svc', 'Service', schema), variables);

    expect(variables.get('svc')).toEqual({
      port: 9090,
      enabled: true,
      name: 'api',
    });
  });

  it('leaves an unparseable number as the raw string', async () => {
    const variables = new Variables();
    formRun.mockResolvedValue({ port: 'not-a-number', enabled: 'no', name: 'api' });

    await VariableAssignment(cube('svc', 'Service', schema), variables);

    expect(variables.get('svc').port).toBe('not-a-number');
    expect(variables.get('svc').enabled).toBe(false);
  });

  it('accepts yes and 1 as truthy booleans', async () => {
    const variables = new Variables();
    formRun.mockResolvedValue({ port: '1', enabled: 'yes', name: 'api' });

    await VariableAssignment(cube('svc', 'Service', schema), variables);

    expect(variables.get('svc').enabled).toBe(true);
  });

  it('unwraps optional and nullable schema types', async () => {
    const nullableSchema = z.object({
      maybe: z.number().nullable().default(1),
      opt: z.number().optional().default(2),
      given: z.number().nullable().default(3),
    });
    const variables = new Variables();
    formRun.mockResolvedValue({ maybe: 'null', opt: '7', given: '42' });

    await VariableAssignment(cube('svc', 'Service', nullableSchema), variables);

    expect(variables.get('svc')).toEqual({ maybe: null, opt: 7, given: 42 });
  });

  it('treats an empty string as null for a nullable field', async () => {
    const nullableSchema = z.object({ maybe: z.number().nullable().default(1) });
    const variables = new Variables();
    formRun.mockResolvedValue({ maybe: '' });

    await VariableAssignment(cube('svc', 'Service', nullableSchema), variables);

    expect(variables.get('svc').maybe).toBe(null);
  });

  it('passes non-string answers through untouched', async () => {
    const variables = new Variables();
    formRun.mockResolvedValue({ port: 9090, enabled: true, name: 'api' });

    await VariableAssignment(cube('svc', 'Service', schema), variables);

    expect(variables.get('svc').port).toBe(9090);
  });

  it('keeps answers for keys the schema does not describe', async () => {
    const variables = new Variables();
    formRun.mockResolvedValue({ port: '1', enabled: 'true', name: 'api', extra: 'kept' });

    await VariableAssignment(cube('svc', 'Service', schema), variables);

    expect(variables.get('svc').extra).toBe('kept');
  });

  it('assigns nothing when the user cancels the form', async () => {
    const variables = new Variables();
    formRun.mockRejectedValue(new Error('cancelled'));

    await expect(
      VariableAssignment(cube('svc', 'Service', schema), variables)
    ).resolves.toBeUndefined();
    expect(variables.get('svc')).toEqual({});
  });

  it('coerces against a schema built by a different copy of zod', async () => {
    // Guards the discriminant in `coerceValue`: under `instanceof` every check
    // here returns false and the answers stay strings, silently.
    const variables = new Variables();
    formRun.mockResolvedValue({ port: '9090', enabled: 'true', maybe: '' });

    await VariableAssignment(
      cube(
        'svc',
        'Service',
        foreignZodSchema(
          z.object({
            port: z.number().default(8080),
            enabled: z.boolean().default(false),
            maybe: z.number().nullable().default(1),
          })
        )
      ),
      variables
    );

    expect(variables.get('svc')).toEqual({ port: 9090, enabled: true, maybe: null });
  });
});
