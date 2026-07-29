import { Manifest } from '@bitsquare/nopy-cubes';
import { z } from 'zod';

export default Manifest({
  id: 'apt:essentials',
  name: 'Install essential packages',
  dependencies: () => [],
  schema: z.object({
    UPDATE: z.boolean().describe('If already installed should packages be updated').default(true),
  }),
});
