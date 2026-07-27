# armor-ufw

**Activate UFW (Uncomplicated Firewall)**

## Purpose

This cube configures and enables UFW, a user-friendly firewall management tool for Linux systems, providing basic protection against unauthorized network access.

## What is UFW?

UFW (Uncomplicated Firewall) is a frontend for `iptables` designed to make firewall configuration simple and accessible. It provides:

- **Easy-to-understand syntax**: Commands like `ufw allow ssh` instead of complex iptables rules
- **Default deny policy**: Blocks all incoming connections except those explicitly allowed
- **Connection tracking**: Automatically handles related and established connections
- **Application profiles**: Pre-configured rules for common services

Think of UFW as a security gate for your server - it controls which network traffic is allowed in and out.

## What This Cube Does

1. Configures UFW to allow SSH connections (port 22)
   - Ensures you don't lock yourself out when enabling the firewall
2. Optionally allows HTTP traffic (port 80) based on the `ALLOW_HTTP` parameter
3. Enables the firewall with the configured rules

## Configuration

### Parameters

- **ALLOW_HTTP** (boolean, default: `true`)
  - Allow incoming HTTP traffic on port 80
  - Set to `false` if you're only using HTTPS or don't need web traffic

## Dependencies

- **apt:essentials** - Required for basic system tools

## Security Notes

**Important**: This cube automatically allows SSH to prevent lockouts. If you need to allow additional services, you can run:

```bash
sudo ufw allow [port number]/[protocol]
sudo ufw allow [service-name]
```

Examples:
- `sudo ufw allow 443/tcp` - Allow HTTPS
- `sudo ufw allow 3000/tcp` - Allow custom application port
- `sudo ufw allow https` - Allow HTTPS by service name

## Post-Installation

Check firewall status:
```bash
sudo ufw status verbose
sudo ufw status numbered
```

Common UFW commands:
- Delete rule: `sudo ufw delete [rule number]`
- Disable firewall: `sudo ufw disable`
- Reset to defaults: `sudo ufw reset`

## UFW File Locations

UFW rules are stored in the `/etc/ufw` directory:

- `/etc/ufw/user.rules` - Custom rules added via the `ufw` command
- `/etc/ufw/before.rules` - Rules processed before user rules (high priority)
- `/etc/ufw/after.rules` - Rules processed after user rules (exceptions)
- `/etc/ufw/sysctl.conf` - Kernel network parameters (e.g., packet forwarding)
- `/etc/ufw/applications.d/` - Application profiles for common services
- `/etc/default/ufw` - Global UFW settings and default policies

Understanding these locations is helpful for troubleshooting, manual edits, or backing up your firewall configuration.
