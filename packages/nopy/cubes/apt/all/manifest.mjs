import { cubes } from '@bitstack/nopy';
import { z } from 'zod';

export default cubes.Manifest({
  name: '[apt-all] Test dependencies',
  dependencies: () => ['apt/more'],
});
