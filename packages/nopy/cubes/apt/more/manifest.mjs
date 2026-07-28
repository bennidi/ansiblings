import { cubes } from '@bitsquare/nopy';

export default cubes.Manifest({
  name: '[test:apt-more] Test dependencies',
  dependencies: () => [['test:apt-essentials']],
});
