import { Manifest, uniqid } from '@bitsquare/nopy-cubes';
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
      .describe('Space-separated list of additional groups (e.g., "docker sudo")')
      .default(''),
    // Empty by default, never a specific key: this used to carry a personal
    // key, which meant an unattended run authorised someone else's key on the
    // new account. Empty means no key is authorised — some users need none.
    PUBKEY: z
      .string()
      .describe('SSH public key to authorize for the user (empty for none)')
      .default(''),
  }),
});
