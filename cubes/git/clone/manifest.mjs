import { cubes } from '@bitstack/nopy';
import { z } from 'zod';

export default cubes.Manifest({
  id: 'git:clone',
  name: 'Clone a repository',
  dependencies: () => [],
  schema: z.object({
    USER: z.string().describe('Username for which to clone the repository').default('vagrant'),
    REPO: z.string().default(''),
    APP: z.string().describe('The internal name used for this application').default(''),
  }),
});
