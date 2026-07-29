import { Manifest } from '@bitsquare/nopy-cubes';
import { z } from 'zod';

export default Manifest({
  id: 'armor:ufw',
  name: 'Activate ufw (uncomplicated firewall)',
  dependencies: () => ['apt:essentials'],
  schema: z.object({
    ALLOW_HTTP: z.boolean().describe('Allow incoming HTTP traffic on port 80').default(true),
  }),
});
