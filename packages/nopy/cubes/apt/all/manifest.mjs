import { cubes } from '@bitstack/nopy';

export default cubes.Manifest({
  name: '[apt-all] Test dependencies',
  dependencies: () => ['apt/more'],
});
