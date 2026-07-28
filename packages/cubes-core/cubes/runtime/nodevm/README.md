# nodevm

**Install Node.js with essential global packages**

## Purpose

This cube installs the latest LTS (Long Term Support) version of Node.js along with essential global npm packages commonly needed for development and deployment.

## What is Node.js?

Node.js is a JavaScript runtime built on Chrome's V8 engine that allows you to run JavaScript on the server. It's widely used for:

- Building web servers and APIs
- Command-line tools
- Build tools and task runners
- Real-time applications (chat, notifications)
- Microservices

## What This Cube Does

1. **Installs Node.js LTS**
   - Downloads and runs the official NodeSource setup script
   - Installs the latest LTS version of Node.js
   - Includes npm (Node Package Manager)

2. **Installs build dependencies**
   - `libssl-dev` - SSL/TLS libraries
   - `libtool` - Library building tools
   - `cmake` - Cross-platform build system
   - `libpng-dev`, `libjpeg-dev`, `libvips-dev` - Image processing libraries

3. **Installs global npm packages**
   - **npm@11.1.0** - Latest npm version
   - **pm2** - Production process manager for Node.js apps
   - **yarn** - Alternative package manager
   - **local-web-server** - Local development web server
   - **node-gyp** - Node.js native addon build tool
   - **inquirer** - Interactive command-line prompts
   - **execa** - Better child process execution
   - **@dotenvx/dotenvx** - Environment variable management

## Configuration

This cube currently has no configurable parameters.

## Dependencies

None - this cube can run standalone.

## Post-Installation

Verify installation:
```bash
node --version
npm --version
```

Common commands:
- Run a Node.js app: `node app.js`
- Start with PM2: `pm2 start app.js`
- Install packages: `npm install <package>`
- Use yarn: `yarn add <package>`

## PM2 - Process Manager

PM2 is included for production deployments. Common PM2 commands:

```bash
pm2 start app.js              # Start application
pm2 list                      # List running apps
pm2 stop app                  # Stop application
pm2 restart app               # Restart application
pm2 logs                      # View logs
pm2 startup                   # Enable PM2 on boot
pm2 save                      # Save current process list
```

## Notes

- Node.js is installed system-wide
- Global packages are accessible to all users
- npm cache is stored in `~/.npm`
- Use `nvm` if you need multiple Node.js versions
