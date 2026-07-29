import { Manifest } from '@bitsquare/nopy-cubes';
import { z } from 'zod';

export default Manifest({
  id: 'net:tailscale',
  name: 'Install and authenticate Tailscale',
  dependencies: () => ['apt:essentials'],
  secrets: ['AUTH_KEY'],
  schema: z.object({
    AUTH_KEY: z.string().describe('Tailscale Auth Key for headless authentication').default(''),
    LOGIN_SERVER: z
      .string()
      .describe('Custom login server (e.g., for Headscale)')
      .default('https://controlplane.tailscale.com'),
    EXTRA_ARGS: z.string().describe('Additional arguments for tailscale up').default(''),
    FORCE_REAUTH: z.boolean().describe('Force re-authentication').default(false),
  }),
});
