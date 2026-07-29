import { Manifest } from '@bitsquare/nopy-cubes';
import { z } from 'zod';

export default Manifest({
  id: 'admin:locale',
  name: 'Configure system locale and keyboard layout',
  dependencies: () => [],
  schema: z.object({
    LAYOUT: z.string().describe('Keyboard layout (e.g. "ch", "us", "de")').default('ch'),
    MODEL: z.string().describe('Keyboard model').default('pc105'),
    VARIANT: z.string().describe('Keyboard variant').default(''),
    OPTIONS: z.string().describe('Keyboard options (comma separated)').default(''),
  }),
});
