import { cubes } from '@bitstack/nopy';
import { z } from 'zod';

export default cubes.Manifest({
  id: 'runtime:nodevm',
  name: 'Install nvm and nodejs with global packages',
  dependencies: () => [],
  schema: z.object({
    VERSION: z
      .nullable(z.string())
      .describe('Node.js version to install. It is recommended to use semver notation')
      .default('v22.20.0'),
    USER: z.string().describe('Username for which to install nodejs').default('vagrant'),
    ALIAS: z.string().describe('The alias for this node version').default('nodelts'),
    GLOBAL_PACKAGES: z
      .string()
      .describe('Space-separated list of global npm packages to install')
      .default('npm-check-updates'),
  }),
});
