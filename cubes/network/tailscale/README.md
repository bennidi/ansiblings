# Tailscale Cube

Installs and authenticates the Tailscale client on a Linux host.

## Features

- **Automated Installation**: Adds the official Tailscale repository and installs the package.
- **Headless Authentication**: Uses a Tailscale Auth Key for zero-interaction setup.
- **Headscale Support**: Can be configured to connect to a custom login server.
- **Startup persistence**: Ensures the `tailscaled` daemon is enabled and running.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTH_KEY` | `""` | Tailscale Auth Key (recommended to use a 'reusable' or 'ephemeral' key). |
| `LOGIN_SERVER` | `https://controlplane.tailscale.com` | The coordination server URL. Set this to your Headscale instance URL if applicable. |
| `EXTRA_ARGS` | `""` | Additional flags to pass to `tailscale up` (e.g., `--advertise-exit-node`). |
| `FORCE_REAUTH` | `false` | If true, forces the client to re-authenticate. |

## Usage

```bash
nopy install tailscale
```

When prompted, provide your `AUTH_KEY`. If you are using Headscale, also provide the `LOGIN_SERVER` URL.
