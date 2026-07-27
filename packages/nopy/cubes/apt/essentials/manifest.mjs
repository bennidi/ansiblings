import { cubes } from '@bitstack/nopy';
import { z } from 'zod';

export default cubes.Manifest({
  name: '[apt:essentials] Install essential packages',
  dependencies: () => [],
  schema: z.object({
    UPDATE: z.boolean().default(false),
  }),
});
