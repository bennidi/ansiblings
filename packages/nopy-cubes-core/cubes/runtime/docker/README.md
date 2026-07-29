# docker

**Install Docker and tools**

## Purpose

This cube installs Docker Engine, Docker Compose, and popular Docker management tools to enable containerized application deployment and management.

## What is Docker?

Docker is a platform for developing, shipping, and running applications in containers. Containers package an application with all its dependencies, ensuring it runs consistently across different environments.

Key benefits:
- **Isolation**: Each container runs independently with its own filesystem, network, and processes
- **Portability**: Containers run the same way on any system that supports Docker
- **Efficiency**: Containers share the host OS kernel, making them lighter than virtual machines
- **Scalability**: Easily deploy and scale containerized applications

## What This Cube Does

1. **Adds Docker's official repository**
   - Downloads and installs Docker's GPG key
   - Configures APT to use Docker's official package repository

2. **Installs Docker components**
   - `docker-ce` - Docker Community Edition engine
   - `docker-ce-cli` - Command-line interface for Docker
   - `containerd.io` - Container runtime
   - `docker-buildx-plugin` - Extended build capabilities with BuildKit
   - `docker-compose-plugin` - Tool for defining multi-container applications

3. **Installs management tools**
   - **lazydocker** - Terminal UI for Docker and Docker Compose management
   - **docker-ctop** - Container metrics and monitoring (top-like interface for containers)

## Configuration

This cube currently has no configurable parameters.

## Dependencies

None - this cube can run standalone.

## Post-Installation

After deployment:
- Add users to the `docker` group to run Docker without sudo: `sudo usermod -aG docker username`
- Start using Docker: `docker run hello-world`
- Use lazydocker for easy management: `lazydocker`
- Monitor containers: `ctop`

## Notes

The Docker daemon starts automatically on boot. You can manage it with systemd:
- Check status: `sudo systemctl status docker`
- Restart: `sudo systemctl restart docker`

## Additional Resources

- [Installation tutorial Ubuntu 24.04](https://www.cherryservers.com/blog/install-docker-ubuntu)