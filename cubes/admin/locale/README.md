# Cube: admin/locale

Configures system keyboard layout permanently by updating `/etc/default/keyboard` and using `localectl`.

## Configuration

- `LAYOUT` (string): Keyboard layout (e.g. "ch", "us", "de"). Default: "ch".
- `MODEL` (string): Keyboard model. Default: "pc105".
- `VARIANT` (string): Keyboard variant. Default: "".
- `OPTIONS` (string): Keyboard options (comma separated). Default: "".

## Usage

```javascript
import { cubes } from '@bitstack/nopy';

export default cubes.Manifest({
  name: 'My Host Setup',
  dependencies: () => [
    ['admin:locale', { LAYOUT: 'de' }]
  ]
});
```
