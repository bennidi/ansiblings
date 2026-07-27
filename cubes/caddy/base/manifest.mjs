import { cubes } from '@bitstack/nopy';
import { z } from 'zod';

export default cubes.Manifest({
  id: 'caddy',
  name: 'Install Caddy webserver',
  dependencies: () => [],
  schema: z.object({
    // tls /path/to/cert.pem /path/to/key.pem
    TLS: z
      .string()
      .default('')
      .describe(`
            <empty-string> --> enabled and automatically managed
            internal --> use Caddy custom root CA for self-signed certs (for testing purpose)
            /path/to/cert /path/to/key --> Provide custom certificates
            `),
  }),
});
