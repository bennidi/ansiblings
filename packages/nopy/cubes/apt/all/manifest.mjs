import { cubes } from '@bitsquare/nopy';

export default cubes.Manifest({
  name: '[apt-all] Test dependencies',
  dependencies: () => ['apt/more'],
});
