/**
 * Runs one real enquirer variable form and prints what it produced.
 *
 * Driven by `tests/prompts.pty.test.ts` under a pty of a chosen size. Nothing
 * here is mocked — the point is the prompt library's own behaviour on a
 * terminal that reports no size, which cannot be observed from inside a vitest
 * worker because there is no TTY there to misreport.
 *
 * Prints one line, `NOPY_PROBE <json>`, holding the values the form assigned at
 * the `prompt` origin. An empty object means the form submitted nothing.
 */

import { Cube, Manifest } from '@bitsquare/nopy-cubes';
import { z } from 'zod';
import { Variables } from '../../src/nopy.common.js';
import { VariableAssignment } from '../../src/nopy.prompts.js';

const KEYS = ['ALPHA', 'BETA'];

const cube = new Cube(
  Manifest({
    id: 'probe',
    name: 'Zero-rows probe',
    schema: z.object({
      ALPHA: z.string().describe('First value').default(''),
      BETA: z.string().describe('Second value').default(''),
    }),
  }),
  '/cubes/probe',
  'deploy.py'
);

const variables = new Variables();
await VariableAssignment(cube, variables);

const assigned: Record<string, unknown> = {};
for (const key of KEYS) {
  const variable = variables.of('probe', key);
  if (variable?.origin === 'prompt') assigned[key] = variable.value;
}

process.stdout.write(`\nNOPY_PROBE ${JSON.stringify(assigned)}\n`);
