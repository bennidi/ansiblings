import { Manifest } from '@bitsquare/nopy-cubes';
import { z } from 'zod';

export default Manifest({
  id: '__CUBE_ID__',
  name: '__CUBE_NAME__',
  // dependencies: () => ['apt:essentials'],  // cubes to deploy first
  // secrets: ['API_TOKEN'],                  // schema keys to mask and never persist
  schema: z.object({
    GREETING: z
      .string()
      .describe('Message the deploy prints on the host')
      .default('hello from __CUBE_ID__'),
  }),
});
