import { cubes } from '@bitsquare/nopy';
import { z } from 'zod';

export default cubes.Manifest({
  name: '[test:apt-essentials] Install essential packages',
  dependencies: () => [],
  schema: z.object({
    UPDATE: z.boolean().default(false),
  }),
});
