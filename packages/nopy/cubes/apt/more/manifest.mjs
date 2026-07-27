import { cubes } from '@bitstack/nopy';

export default cubes.Manifest({
  name: '[apt-more] Test dependencies',
  dependencies: () => [['apt/essentials']],
});
