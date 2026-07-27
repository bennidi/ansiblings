import { cubes } from '@bitsquare/nopy';
import { z } from 'zod';

export default cubes.Manifest({
  id: 'ssh:keyman',
  name: 'Deploy an ssh key managed by keyman',
  dependencies: () => [],
  schema: z.object({
    KEY_NAME: z
      .string()
      .describe('Name of the SSH key file (without extension)')
      .default('id_ed25519'),
    USER: z.string().describe('Username for which to deploy the SSH key').default('vagrant'),
    HOSTS: z
      .string()
      .describe('Space-separated list of hosts to add to known_hosts')
      .default('github.com'),
  }),
});
