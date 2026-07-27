import { cubes } from '@bitstack/nopy';
import { z } from 'zod';

export default cubes.Manifest({
  id: 'caddy:spa',
  name: 'Install single page application',
  dependencies: () => [],
  schema: z.object({
    DOMAIN: z.string().describe('Domain name for the SPA application').default(''),
    PORT: z.number().describe('Port number where the SPA will be served').default(5432),
  }),
});
