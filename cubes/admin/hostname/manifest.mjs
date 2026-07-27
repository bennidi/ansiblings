import { cubes, uniqid } from '@bitstack/nopy';
import { z } from 'zod';

/**
 * Manifest for the admin:hostname cube.
 * This cube allows for setting and persistently changing the system's hostname.
 */
export default cubes.Manifest({
  id: 'admin:hostname',
  name: 'Permanently change the hostname',
  dependencies: () => [],
  schema: z.object({
    HOSTNAME: z
      .string()
      .min(1)
      .max(64)
      .describe('The new hostname for the target host')
      .default(`host-${uniqid()}`),
  }),
});
