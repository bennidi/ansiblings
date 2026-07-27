import { cubes } from '@bitstack/nopy';
import { z } from 'zod';

export default cubes.Manifest({
  id: 'runtime:docker',
  name: 'Install docker and tools',
  dependencies: () => [],
  schema: z.object({
    DISTRO: z.enum(['ubuntu', 'debian']).default('ubuntu').describe('Linux distribution to target'),
  }),
});
