import { cubes } from '@bitsquare/nopy';

export default cubes.Manifest({
  name: '[test:apt-all] Test dependencies',
  dependencies: () => ['test:apt-more'],
});
