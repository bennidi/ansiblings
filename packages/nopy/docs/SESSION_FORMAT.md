# Nopy Session Format

Nopy supports two session file formats: **JSON** and **MJS** (ES Module JavaScript).

## Supported Formats

### JSON Format (`.session.json`)

Traditional JSON format for session files:

```json
{
  "version": "1.0.0",
  "timestamp": "2025-10-15T00:00:00.000Z",
  "cubes": [
    {
      "key": "runtime:nodevm",
      "variables": {
        "VERSION": "22",
        "USER": "myuser"
      }
    }
  ],
  "hosts": ["@ssh/myhost.local"],
  "auth": {
    "method": "password",
    "username": "admin"
  },
  "env": {}
}
```

**Limitations:**
- No comments allowed (pure JSON)
- Cannot use dynamic values or computation
- No code reuse or imports

### MJS Format (`.session.mjs`) - **Recommended**

JavaScript module format with full ES Module support:

```javascript
// Nopy Session Configuration
// Comments are fully supported!

// You can import values from other files
import { commonHosts } from './common-config.mjs';

// You can use dynamic values
const timestamp = new Date().toISOString();
const nodeVersion = process.env.NODE_VERSION || "22";

export default {
  version: "1.0.0",
  timestamp,

  cubes: [
    // Inline comments for each cube
    {
      key: "runtime:nodevm",
      variables: {
        VERSION: nodeVersion,  // Dynamic value
        USER: "myuser",
        ALIAS: "nodelts",
        GLOBAL_PACKAGES: "pm2 yarn"
      }
    },

    // Add more cubes...
  ],

  hosts: commonHosts,  // Imported from another file

  auth: {
    method: "password",
    username: "admin"
  },

  env: {
    NODE_ENV: process.env.NODE_ENV || "production"
  }
};
```

**Advantages:**
- ✅ **Comments** - Document your configuration inline
- ✅ **Dynamic values** - Use environment variables, compute values
- ✅ **Code reuse** - Import common configurations from other files
- ✅ **Parameterization** - Easily parameterize sessions from external tools
- ✅ **Type safety** - Use JSDoc or TypeScript for validation
- ✅ **Computation** - Calculate values, filter arrays, etc.

## Advanced MJS Examples

### Using Environment Variables

```javascript
export default {
  version: "1.0.0",
  timestamp: new Date().toISOString(),

  cubes: [
    {
      key: "typestack-install",
      variables: {
        REPO: process.env.GIT_REPO || "git@github.com:org/repo.git",
        USER: process.env.DEPLOY_USER || "admin",
        APP: process.env.APP_NAME || "myapp",
        ENV: process.env.NODE_ENV || "production"
      }
    }
  ],

  hosts: [process.env.TARGET_HOST || "@ssh/localhost"],

  auth: {
    method: "password",
    username: process.env.SSH_USER || "admin"
  }
};
```

### Conditional Cube Inclusion

```javascript
const isDevelopment = process.env.NODE_ENV === 'development';

export default {
  version: "1.0.0",
  timestamp: new Date().toISOString(),

  cubes: [
    {
      key: "runtime:docker",
      variables: { DISTRO: "debian" }
    },

    // Only include in development
    ...(isDevelopment ? [{
      key: "debug-tools",
      variables: { INSTALL_GDB: true }
    }] : [])
  ],

  hosts: ["@ssh/myhost.local"],
  auth: { method: "ssh" }
};
```

### Importing Common Configuration

**common-config.mjs:**
```javascript
export const productionHosts = [
  "@ssh/prod-server-1.local",
  "@ssh/prod-server-2.local"
];

export const stagingHosts = [
  "@ssh/staging.local"
];

export const commonCubes = [
  {
    key: "apt:essentials",
    variables: { UPDATE: true }
  },
  {
    key: "runtime:docker",
    variables: { DISTRO: "debian" }
  }
];
```

**my-session.session.mjs:**
```javascript
import { productionHosts, commonCubes } from './common-config.mjs';

export default {
  version: "1.0.0",
  timestamp: new Date().toISOString(),

  cubes: [
    ...commonCubes,  // Include common cubes
    {
      key: "typestack-install",
      variables: {
        REPO: "git@github.com:myorg/myapp.git",
        USER: "appuser",
        APP: "myapp"
      }
    }
  ],

  hosts: productionHosts,  // Use imported hosts

  auth: {
    method: "password",
    username: "admin"
  }
};
```

### Programmatic Generation

You can even generate sessions programmatically from other tools:

**generate-session.mjs:**
```javascript
import fs from 'fs';

function generateSession(config) {
  const cubes = config.services.map(service => ({
    key: "typestack-install",
    variables: {
      REPO: service.repo,
      USER: config.user,
      APP: service.name,
      ENV: config.environment
    }
  }));

  const session = {
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    cubes,
    hosts: config.hosts,
    auth: {
      method: "password",
      username: config.user
    }
  };

  const content = `export default ${JSON.stringify(session, null, 2)};`;
  fs.writeFileSync('generated.session.mjs', content);
}

// Generate from external configuration
generateSession({
  user: "deploy",
  environment: "production",
  services: [
    { name: "api", repo: "git@github.com:org/api.git" },
    { name: "web", repo: "git@github.com:org/web.git" }
  ],
  hosts: ["@ssh/prod.local"]
});
```

## Loading Sessions

Both formats are loaded the same way:

```javascript
import { loadSession } from '@bitsquare/nopy';

// Load JSON
const jsonSession = await loadSession('./my-session.session.json');

// Load MJS
const mjsSession = await loadSession('./my-session.session.mjs');
```

The file extension determines which loader to use.

## Migration from JSON to MJS

To convert an existing JSON session to MJS:

1. Rename the file from `.session.json` to `.session.mjs`
2. Add `export default` before the configuration object
3. Remove quotes from property keys (optional)
4. Add comments and dynamic values as needed

**Before (JSON):**
```json
{
  "version": "1.0.0",
  "cubes": [...]
}
```

**After (MJS):**
```javascript
export default {
  version: "1.0.0",
  cubes: [...]
};
```

## Best Practices

1. **Use MJS for new sessions** - Take advantage of comments and flexibility
2. **Document your cubes** - Add comments explaining what each cube does
3. **Use environment variables** - Make sessions reusable across environments
4. **Extract common config** - Share configuration across multiple sessions
5. **Version control** - Both formats work well with git
6. **Validate at runtime** - The loader validates the structure regardless of format

## Session Schema

Both formats must export/contain an object with this structure:

```typescript
interface NopySession {
  version: string;              // Session format version
  timestamp: string;            // ISO timestamp
  cubes: CubeSession[];        // Array of cube configurations
  hosts: string[];             // Target hosts
  auth: AuthSession;           // Authentication configuration
  env?: Record<string, any>;   // Global environment variables
}

interface CubeSession {
  key: string;                 // Cube identifier
  variables: Record<string, any>; // Cube-specific variables
}

interface AuthSession {
  method: 'ssh-key' | 'password' | 'ssh';
  username?: string;
}
```
