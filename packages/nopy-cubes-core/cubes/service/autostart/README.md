# TypeStack Install Cube

Deploys a Node.js/TypeScript application from a Git repository as a systemd service with Docker Compose and PM2 support.

## Features

- Clones Git repository
- Installs dependencies with Yarn
- Builds the application
- Starts Docker Compose services
- Creates a systemd service for automatic startup
- Configures PM2 for process management
- Automatic restart on failure

## Requirements

- Git (for cloning repository)
- Yarn (for dependency management)
- Docker and Docker Compose
- PM2 (for process management)
- Node.js/NVM installed
- SSH key access to the repository (if using private repos)

## Configuration Parameters

### Required

- **USER**: System user to run the application (default: `teclabmin`)
- **REPO**: Git repository URL (default: `git@github.com:bennidi/teclab-flintstone.git`)
- **APP**: Application name/directory name (default: `flintstone`)

### Optional

- **ENV**: Application environment (default: `production`)
- **AUTOSTART**: Enable and start service immediately (default: `True`)
- **NODE_PATH**: Path to Node.js binaries (default: `/home/teclabmin/.nvm/versions/node/v21.7.3/bin`)

## Example Usage

### Basic Configuration

```json
{
  "USER": "myuser",
  "REPO": "git@github.com:myorg/myapp.git",
  "APP": "myapp"
}
```

### Advanced Configuration

```json
{
  "USER": "appuser",
  "REPO": "git@github.com:myorg/myapp.git",
  "APP": "myapp",
  "ENV": "staging",
  "AUTOSTART": false,
  "NODE_PATH": "/home/appuser/.nvm/versions/node/v20.0.0/bin"
}
```

## What This Cube Does

1. **Clone Repository**: Clones the specified Git repository to `/home/<USER>/<APP>`
2. **Install Dependencies**: Runs `yarn install` to install all dependencies
3. **Build Application**: Runs `yarn build` to compile the application
4. **Start Docker Services**: Runs `docker compose up -d` to start containerized services
5. **Create Startup Script**: Creates `/home/<USER>/<APP>.service.sh` that:
   - Starts Docker Compose services
   - Starts PM2 with ecosystem.config.js
6. **Create Systemd Service**: Creates `/etc/systemd/system/<APP>.service` that:
   - Runs after Docker service
   - Uses the specified user
   - Configures proper environment (HOME, PATH)
   - Auto-restarts on failure
7. **Enable & Start Service**: Enables and starts the service (if AUTOSTART=True)

## Service Management

### Check service status

```bash
sudo systemctl status <APP>
```

### Start the service

```bash
sudo systemctl start <APP>
```

### Stop the service

```bash
sudo systemctl stop <APP>
```

### Restart the service

```bash
sudo systemctl restart <APP>
```

### View service logs

```bash
sudo journalctl -u <APP> -f
```

### Disable autostart

```bash
sudo systemctl disable <APP>
```

## File Structure

After deployment:

```
/home/<USER>/
├── <APP>/                      # Application directory
│   ├── ecosystem.config.js     # PM2 configuration
│   ├── docker-compose.yml      # Docker services
│   └── ...                     # Application files
├── <APP>.service.sh            # Startup script
/etc/systemd/system/
└── <APP>.service               # Systemd service file
```

## Troubleshooting

### Service fails to start

1. Check service logs:
   ```bash
   sudo journalctl -u <APP> -n 50
   ```

2. Verify Docker is running:
   ```bash
   sudo systemctl status docker
   ```

3. Check if Node.js path is correct:
   ```bash
   which node
   which pm2
   ```

### Repository clone fails

- Ensure SSH keys are properly configured for the user
- Test SSH access: `ssh -T git@github.com`
- Check repository URL is correct

### Docker Compose fails

- Verify Docker is installed and running
- Check docker-compose.yml exists in the application directory
- Ensure user has Docker permissions: `sudo usermod -aG docker <USER>`

### PM2 not starting

- Verify PM2 is installed: `pm2 --version`
- Check ecosystem.config.js exists
- Verify NODE_PATH includes PM2 binary location

## Notes

- The service type is set to `forking` to support PM2's daemon mode
- Service will auto-restart on failure with a 5-second delay
- Maximum 5 restart attempts in the burst period
- The service waits for Docker to be ready before starting
- Environment variables can be configured in the ecosystem.config.js file
