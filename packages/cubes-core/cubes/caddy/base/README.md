# caddy

**Install Caddy webserver**

## Purpose

This cube installs Caddy, a modern, powerful web server with automatic HTTPS that's designed to be easy to use and configure.

## What is Caddy?

Caddy is a next-generation web server that stands out for its simplicity and built-in security:

- **Automatic HTTPS**: Automatically obtains and renews SSL/TLS certificates from Let's Encrypt
- **Modern HTTP features**: HTTP/2, HTTP/3 (QUIC) support out of the box
- **Simple configuration**: Human-readable Caddyfile format
- **Reverse proxy**: Easy proxying to backend applications
- **Static file serving**: Fast and efficient static site hosting
- **Zero-downtime reloads**: Update config without dropping connections

## What This Cube Does

1. **Adds Caddy's official repository**
   - Installs required dependencies (debian-keyring, apt-transport-https, curl)
   - Downloads and installs Caddy's GPG signing key
   - Configures APT to use Caddy's official stable repository

2. **Installs Caddy**
   - Installs the latest stable version of Caddy
   - Sets up the Caddy service

3. **Configures TLS**
   - Creates a Caddyfile with a reusable TLS snippet
   - Configures TLS based on the `TLS` parameter

## Configuration

### Parameters

- **TLS** (string, default: `''`)
  - TLS certificate configuration
  - **Options**:
    - `''` (empty string) - Automatic HTTPS with Let's Encrypt (recommended)
    - `'internal'` - Use Caddy's internal CA for self-signed certs (testing only)
    - `'/path/to/cert /path/to/key'` - Provide custom certificate paths

## Dependencies

None - this cube can run standalone.

## TLS Configuration Examples

**Automatic HTTPS (Production)**:
```javascript
exec('caddy', { TLS: '' })
```
Caddy will automatically obtain SSL certificates from Let's Encrypt for your domain.

**Self-Signed for Testing**:
```javascript
exec('caddy', { TLS: 'internal' })
```
Uses Caddy's internal CA. Browsers will show security warnings.

**Custom Certificates**:
```javascript
exec('caddy', { TLS: '/etc/ssl/certs/mycert.pem /etc/ssl/private/mykey.pem' })
```
Use your own certificate and private key files.

## Post-Installation

The Caddyfile is created at `/etc/caddy/Caddyfile` with a reusable TLS snippet:

```
(tls_cert) {
    tls {TLS}
}
```

Other cubes (like `caddy-spa`) can import this snippet with `import tls_cert`.

## Managing Caddy

Start/stop/restart Caddy:
```bash
sudo systemctl start caddy
sudo systemctl stop caddy
sudo systemctl restart caddy
sudo systemctl status caddy
```

Reload configuration without downtime:
```bash
sudo systemctl reload caddy
```

Test configuration:
```bash
caddy validate --config /etc/caddy/Caddyfile
```

## Common Use Cases

- Reverse proxy for Node.js/Python/Go apps
- Static website hosting
- API gateway
- Load balancer
- SSL/TLS termination

## Notes

- Caddy runs on ports 80 (HTTP) and 443 (HTTPS) by default
- Ensure these ports are open in your firewall (UFW)
- For automatic HTTPS, your domain must point to your server's IP
- Caddy automatically redirects HTTP to HTTPS when using automatic HTTPS

## Additional Resources

- [Caddy Documentation](https://caddyserver.com/docs/)
- [Caddyfile Tutorial](https://caddyserver.com/docs/caddyfile-tutorial)
