import { Manifest } from '@bitsquare/nopy-cube';
import { z } from 'zod';

export default Manifest({
  id: 'ssh:authorize',
  name: 'Authorize SSH public key for a user',
  dependencies: () => [],
  schema: z.object({
    USER: z.string().describe('Username to authorize').default('vagrant'),
    PUBKEY: z.string().describe('SSH public key string').default(''),
  }),
});
