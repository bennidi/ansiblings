/**
 * Interactive prompts for nopy CLI
 * @module nopy.prompts
 */

import Enquirer from 'enquirer';
import fuzzy from 'fuzzy';
import inquirer from 'inquirer';
import type { z } from 'zod';
import { type AnyObjectSchema, type Cube, zodInner, zodKind } from './cubes/index.js';
import type { Variables } from './nopy.common.js';

interface CubeChoice {
  /** Submitted value — enquirer returns the `name` of each selected choice. */
  name: string;
  /** Label rendered in the list. */
  message: string;
}

/**
 * Fuzzy-filters the cube list against what the user has typed so far.
 *
 * Handed to enquirer as `suggest`, which calls it on every keystroke with the
 * current input and the full choice list.
 */
function suggestCubes(input: string | undefined, choices: CubeChoice[]): CubeChoice[] {
  if (!input) return choices;
  return fuzzy
    .filter(input, choices, { extract: (choice: CubeChoice) => choice.message })
    .map((result) => result.original);
}

/**
 * Prompts the user to select cubes to execute with filtering support
 */
export async function CubeSelection(
  cubes: Record<string, Cube>
): Promise<{ selectedCubes: string[] }> {
  // The package a cube came from is part of the label rather than a separate
  // column: `suggest` filters on the label, so typing a package name narrows
  // the list to that bundle.
  const cubeChoices: CubeChoice[] = Object.values(cubes)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((cube) => ({
      name: cube.id,
      message:
        cube.source.type === 'package'
          ? `${cube.id} - ${cube.name} (${cube.source.packageName})`
          : `${cube.id} - ${cube.name}`,
    }));

  // Clear terminal and move cursor to top
  process.stdout.write('\x1B[2J\x1B[0f');

  const terminalHeight = process.stdout.rows || 24;
  const pageSize = Math.max(10, terminalHeight - 5);

  console.log('\n  Cube Selection\n');
  console.log('  Type to filter • Space to select • Enter to confirm\n');

  const prompt = new (Enquirer as any).AutoComplete({
    name: 'selectedCubes',
    message: 'Select cubes:',
    limit: pageSize,
    multiple: true,
    choices: cubeChoices,
    suggest: suggestCubes,
  });

  try {
    return { selectedCubes: await prompt.run() };
  } catch {
    // User cancelled
    return { selectedCubes: [] };
  }
}

export async function AuthSelection(useAuthKey?: boolean): Promise<{
  authMethod: string;
  username?: string;
  password?: string;
}> {
  if (useAuthKey) return { authMethod: 'ssh-key' };
  const answers = await inquirer.prompt([
    {
      // `select`, not `list`: inquirer 14 dropped the legacy name and rejects
      // an unknown type outright.
      type: 'select',
      name: 'authMethod',
      message: 'Select authentication method:',
      choices: ['ssh-key', 'password'],
    },
    {
      type: 'input',
      name: 'username',
      message: 'Enter username:',
      when: (answers) => answers.authMethod !== 'ssh-key',
    },
    {
      type: 'password',
      name: 'password',
      message: 'Enter password:',
      when: (answers) => answers.authMethod !== 'ssh-key',
    },
  ]);
  return answers as { authMethod: string; username?: string; password?: string };
}

export async function PasswordSelection(username: string): Promise<string> {
  const { password } = await inquirer.prompt([
    {
      type: 'password',
      name: 'password',
      message: `Enter password for ${username}:`,
    },
  ]);
  return password;
}

export async function HostSelection(hosts: string[]): Promise<string> {
  const selectedHost = await inquirer.prompt([
    {
      type: 'select',
      name: 'host',
      message: 'Select host from inventory',
      choices: ['docker', 'vagrant', ...hosts, 'custom'],
    },
    {
      type: 'input',
      name: 'customHost',
      message: 'Specify custom host address:',
      when: (answers) => answers.host === 'custom',
    },
    {
      type: 'input',
      name: 'vagrantVM',
      message: 'Specify vagrant machine:',
      default: 'default',
      when: (answers) => answers.host === 'vagrant',
    },
    {
      type: 'input',
      name: 'dockerContainer',
      message: 'Specify docker container name:',
      when: (answers) => answers.host === 'runtime:docker',
    },
  ]);
  if (selectedHost.host === 'vagrant') return `@vagrant/${selectedHost.vagrantVM}`;
  if (selectedHost.host === 'runtime:docker') return `@docker/${selectedHost.dockerContainer}`;
  return selectedHost.customHost ?? selectedHost.host;
}

/**
 * Turns a form answer — always a string — back into what the schema declares.
 *
 * Discriminates on {@link zodKind} rather than `instanceof`: the schema may
 * have been built by a copy of zod that is not the one this file imported, and
 * `instanceof` would then fail open and leave every value a string.
 */
function coerceValue(value: unknown, zodType: z.core.$ZodType): unknown {
  if (typeof value !== 'string') return value;

  switch (zodKind(zodType)) {
    case 'default':
    case 'optional':
      return coerceValue(value, zodInner(zodType));
    case 'nullable':
      if (value === 'null' || value === '') return null;
      return coerceValue(value, zodInner(zodType));
    case 'boolean':
      return value === 'true' || value === 'yes' || value === '1';
    case 'number': {
      const num = Number(value);
      return Number.isNaN(num) ? value : num;
    }
    default:
      return value;
  }
}

interface FormChoice {
  name: string;
  message: string;
  initial: string;
}

/**
 * Asks the user for a cube's variables and records the answers.
 *
 * Reads what to offer out of `variables`, so the caller is expected to have
 * assigned the schema defaults first — which `BuildContext.resolveCube` does.
 * Deliberately not falling back to `cube.getDefaults()` here: calling it a
 * second time re-evaluates every lazily declared default, so a cube generating
 * one would show a different value than the one the run had already recorded.
 */
export async function VariableAssignment<S extends AnyObjectSchema>(
  cube: Cube<S>,
  variables: Variables,
  opts: { keys?: string[] } = {}
) {
  const schema = cube.manifest.schema.shape;
  const resolved = variables.get(cube.id);
  const variablesToConfigure: Record<string, unknown> = {};

  // Every schema key is offered by default, not just the ones carrying a
  // `.default()` — a field without one is precisely the field that has to be
  // asked about. `opts.keys` narrows that to a subset, which is how a replay
  // asks only about the gaps it cannot fill itself.
  //
  // A key a dependency or hook supplied is left alone. The value shown is the
  // one the run would otherwise use, so `env` from `.nopyrc.json` is visible
  // (and editable) rather than silently overridden by whatever is typed.
  for (const key of opts.keys ?? Object.keys(schema)) {
    if (variables.of(cube.id, key)?.origin === 'param') continue;
    variablesToConfigure[key] = resolved[key];
  }

  if (Object.keys(variablesToConfigure).length === 0) return;

  const choices: FormChoice[] = Object.entries(variablesToConfigure).map(([key, value]) => {
    const zodType = schema[key];
    const description = zodType?.description || key;
    return { name: key, message: description, initial: String(value ?? '') };
  });

  const form = new (Enquirer as any).Form({
    name: 'variables',
    message: `[${cube.id}] ${cube.name}\n  (↑↓ navigate, Enter to submit)`,
    choices,
  });

  try {
    const result = await form.run();
    const coercedResult: Record<string, any> = {};
    for (const [key, value] of Object.entries(result)) {
      const zodType = schema[key];
      coercedResult[key] = zodType ? coerceValue(value, zodType) : value;
    }
    variables.assign(cube.id, 'prompt', coercedResult);
  } catch {
    // User cancelled
  }
}
