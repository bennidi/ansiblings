import { cubes } from '@bitstack/nopy';
import { z } from 'zod';

export default cubes.Manifest({
  id: 'service:autostart',
  name: 'Manage systemd service autostart',
  dependencies: () => [],
  schema: z.object({
    APP: z.string().describe('The name of the systemd service (e.g., flintstone)'),
    SERVICE_NAME: z
      .string()
      .optional()
      .describe('Display name for the service')
      .default('Application'),
    AUTOSTART: z.boolean().describe('Should the service be enabled and started?').default(true),
  }),
});
