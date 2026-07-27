import { cubes } from '@bitsquare/nopy';

export default cubes.Manifest({
  name: '[apt-more] Test dependencies',
  dependencies: () => [['apt/essentials']],
});
