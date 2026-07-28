import { Manifest } from '@bitsquare/nopy-cube';
import { z } from 'zod';

export default Manifest({
  id: 'ssh:keygen',
  name: 'Generate SSH key for a given $USER',
  dependencies: () => ['user:add'],
  schema: z.object({
    SUFFIX: z
      .string()
      .describe('Suffix for keyname, e.g. github => id_github.pub')
      .default('ed25519'),
    EMAIL: z
      .string()
      .describe('Email address to associate with the SSH key')
      .default('undefined@bitsquare.dev'),
    ALGORITHM: z.enum(['rsa', 'ed25519']).describe('SSH key algorithm type').default('ed25519'),
    USER: z.string().describe('Username for which to generate the SSH key').default('vagrant'),
  }),
});
