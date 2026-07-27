import { cubes } from '@bitstack/nopy';
import { z } from 'zod';

export default cubes.Manifest({
  id: 'user:add',
  name: 'Add a user with fish shell and tools',
  dependencies: () => ['apt:essentials'],
  schema: z.object({
    USER: z
      .string()
      .describe('Username for the new user account')
      .default(() => `user${cubes.uniqid(5)}`),
    PASSWORD: z.string().describe('Password for the new user account').default(cubes.uniqid),
    GROUPS: z
      .string()
      .describe('Comma-separated list of additional groups (e.g., "docker,sudo")')
      .default(''),
    PUBKEY: z
      .string()
      .describe('SSH public key to authorize for the user')
      .default(
        'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICpnZ6IxwQKL1rBE4dy7w5Sd3s2tLFZUDfjH87C1QIlc bdiedrichsen@Benjamins-MBP.lan'
      ),
  }),
});
