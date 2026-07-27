import { cubes } from '@bitstack/nopy';
import { z } from 'zod';

export default cubes.Manifest({
  name: '[apt-more] Test dependencies',
  dependencies: () => [['apt/essentials']],
});
