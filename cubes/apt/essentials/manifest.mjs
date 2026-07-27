import { cubes } from '@bitsquare/nopy';
import { z } from 'zod';

export default cubes.Manifest({
  id: 'apt:essentials',
  name: 'Install essential packages',
  dependencies: () => [],
  schema: z.object({
    UPDATE: z.boolean().describe('If already installed should packages be updated').default(true),
  }),
});
