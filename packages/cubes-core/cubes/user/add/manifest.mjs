import { Manifest, uniqid } from '@bitsquare/nopy-cube';
import { z } from 'zod';

export default Manifest({
  id: 'user:add',
  name: 'Add a user with fish shell and tools',
  dependencies: () => ['apt:essentials'],
  secrets: ['PASSWORD'],
  schema: z.object({
    USER: z
      .string()
      .describe('Username for the new user account')
      .default(() => `user${uniqid(5)}`),
    // A fixed placeholder, not a generated one: the password is never recorded
    // in a session, so a generated default meant every run produced credentials
    // nobody had seen and a replay produced different ones again.
    PASSWORD: z.string().describe('Password for the new user account').default('changeme'),
    GROUPS: z
      .string()
      .describe('Comma-separated list of additional groups (e.g., "docker,sudo")')
      .default(''),
    // No default on purpose. This used to carry a specific personal key, which
    // meant an unattended run authorised someone else's key on the new account.
    // Leaving it required makes `--use-defaults` refuse by name instead of
    // guessing, and there is no key that would be a sensible guess.
    PUBKEY: z.string().describe('SSH public key to authorize for the user'),
  }),
});
