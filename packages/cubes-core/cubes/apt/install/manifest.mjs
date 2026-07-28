import { Manifest } from '@bitsquare/nopy-cube';
import { z } from 'zod';

export default Manifest({
  id: 'apt:install',
  name: 'Install packages with apt',
  dependencies: () => [],
  schema: z.object({
    UPDATE: z.boolean().describe('Update package cache before installing').default(false),
    PACKAGES: z
      .string()
      .describe('Space-separated list of packages to install')
      .default('vim htop curl'),
  }),
});
