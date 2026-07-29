import { Manifest } from '@bitsquare/nopy-cubes';
import { z } from 'zod';

// [agnt://cogen/cogen/user-edit-1]{cartridge: "ansiblings/cubes", action: "generated", status: "generated"}

/**
 * Manifest for the user:edit cube.
 * Allows modifying existing user accounts (password, groups).
 */
export default Manifest({
  id: 'user:edit',
  name: 'user:edit - Modify an existing user account',
  dependencies: () => [],
  secrets: ['PASSWORD'],
  schema: z.object({
    USER: z.string().describe('The username of the account to modify'),
    PASSWORD: z.string().optional().describe('New password for the user (optional)'),
    GROUPS: z
      .string()
      .optional()
      .describe('Comma-separated list of groups the user SHOULD be in (optional)'),
    GROUPS_ABSENT: z
      .string()
      .optional()
      .describe('Comma-separated list of groups to REMOVE from the user (optional)'),
  }),
});
