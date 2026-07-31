import { Manifest } from '@bitsquare/nopy-cubes';
import { z } from 'zod';

export default Manifest({
  id: 'runtime:nodevm',
  name: 'Install nvm and nodejs with global packages',
  dependencies: () => [],
  schema: z.object({
    VERSION: z
      .string()
      .describe('Node.js version to install. It is recommended to use semver notation')
      .default('v22.20.0'),
    USER: z.string().describe('Username for which to install nodejs').default('vagrant'),
    ALIAS: z.string().describe('The alias for this node version').default('nodelts'),
    // The list the deploy script used to hardcode. It is the default rather than
    // a constant so that setting the variable adds to nothing and replaces
    // everything — which is what "space-separated list" reads as.
    GLOBAL_PACKAGES: z
      .string()
      .describe('Space-separated list of global npm packages to install')
      .default('pm2 yarn local-web-server node-gyp inquirer execa @dotenvx/dotenvx'),
    // fish is the default because nvm wires itself into whichever shell installed
    // it: switching would leave an existing user — whose login shell `user:add`
    // set to fish — with node installed and invisible.
    SHELL: z
      .enum(['fish', 'bash'])
      .describe('Login shell to install through. fish needs Oh My Fish; bash needs nothing')
      .default('fish'),
  }),
});
