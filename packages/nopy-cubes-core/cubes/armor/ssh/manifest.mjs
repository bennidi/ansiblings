import { Manifest } from '@bitsquare/nopy-cubes';
import { z } from 'zod';

export default Manifest({
  id: 'armor:ssh',
  name: 'Secure SSH server by disabling password authentication',
  dependencies: () => [],
  schema: z.object({
    DISABLE_PASSWORD: z
      .boolean()
      .describe('Disable password authentication for SSH connections')
      .default(true),
    DISABLE_PAM: z
      .boolean()
      .describe('Disable PAM (Pluggable Authentication Modules) for SSH')
      .default(true),
  }),
});
