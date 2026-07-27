# cockpit

**Install Cockpit web-based server management interface**

## Purpose

This cube installs Cockpit, a powerful web-based interface for managing Linux servers, making system administration accessible through your browser.

## What is Cockpit?

Cockpit is a modern, interactive server admin interface that runs in your web browser. It provides:

- **Real-time monitoring**: CPU, memory, disk, and network usage graphs
- **Container management**: View and manage Docker containers
- **Service management**: Start, stop, and manage systemd services
- **Storage administration**: Manage disks, RAID, and filesystems
- **Network configuration**: Configure network interfaces and firewall
- **Terminal access**: Built-in terminal for command-line access
- **User management**: Create and manage user accounts
- **Software updates**: View and apply system updates

Think of it as a control panel for your Linux server - all accessible from any web browser.

## What This Cube Does

1. Installs the `cockpit` package
2. Installs `sscg` (Simple Signed Certificate Generator) for HTTPS support
3. Starts the Cockpit service
4. Makes Cockpit accessible on port 9090

## Configuration

This cube currently has no configurable parameters.

## Dependencies

None - this cube can run standalone.

## Post-Installation

Access Cockpit by navigating to:
```
https://your-server-ip:9090
```

Login with any valid system user account (e.g., root or a user created with the `user-add` cube).

### Security Notes

- Cockpit uses HTTPS by default (self-signed certificate)
- Your browser will show a security warning on first access (expected with self-signed certs)
- Consider using UFW to restrict access: `sudo ufw allow from YOUR_IP to any port 9090`
- Disable Cockpit when not in use: `sudo systemctl stop cockpit.socket`

## Common Use Cases

- Monitor server performance in real-time
- Manage Docker containers without command-line
- View system logs and troubleshoot issues
- Configure network settings
- Apply system updates
- Manage storage and filesystems

## Managing Cockpit

Start/stop Cockpit:
```bash
sudo systemctl start cockpit.socket
sudo systemctl stop cockpit.socket
sudo systemctl status cockpit.socket
```

Disable Cockpit from starting on boot:
```bash
sudo systemctl disable cockpit.socket
```