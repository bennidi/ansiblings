# caddy-spa

**Configure Caddy to serve a Single Page Application**

## Purpose

This cube adds a reverse proxy configuration to Caddy for serving a Single Page Application (SPA) from a local backend server, with automatic HTTPS support.

## What This Cube Does

1. **Adds domain configuration to Caddyfile**
   - Creates a site block for the specified domain
   - Configures reverse proxy to forward traffic to local application
   - Imports TLS configuration from the `caddy` cube

2. **Configures reverse proxy**
   - Proxies all requests to `localhost:{PORT}`
   - Preserves headers and client information
   - Handles WebSocket connections

3. **Restarts Caddy service**
   - Applies the new configuration immediately

## Configuration

### Parameters

- **DOMAIN** (string, default: `''`)
  - Domain name for the SPA application
  - Example: `'myapp.example.com'`
  - Must have DNS pointing to your server's IP

- **PORT** (number, default: `5432`)
  - Port number where the SPA will be served
  - Your application should be listening on this port locally

## Dependencies

- **caddy** cube (implicitly required) - Must be installed first to provide the `tls_cert` snippet

## What Gets Configured

This cube adds the following to `/etc/caddy/Caddyfile`:

```
# BEGIN DOMAIN myapp.example.com
myapp.example.com {
    import tls_cert
    reverse_proxy localhost:5432
}
# END myapp.example.com
```

## Use Cases

**Deploy a React/Vue/Angular app**:
```javascript
exec('caddy-spa', {
  DOMAIN: 'app.example.com',
  PORT: 3000
})
```

**Deploy multiple SPAs**:
```javascript
exec('caddy-spa', { DOMAIN: 'app1.example.com', PORT: 3000 })
exec('caddy-spa', { DOMAIN: 'app2.example.com', PORT: 3001 })
exec('caddy-spa', { DOMAIN: 'app3.example.com', PORT: 3002 })
```

## How It Works

1. User visits `https://myapp.example.com`
2. Caddy receives the request on port 443 (HTTPS)
3. Caddy automatically handles SSL/TLS encryption
4. Request is forwarded to `localhost:5432`
5. Your application receives the request and returns a response
6. Caddy sends the encrypted response back to the user

## Prerequisites

Before deploying this cube:

1. **Install the caddy cube first**
   - Provides the base Caddy installation and TLS configuration

2. **Ensure your application is running**
   - Your SPA backend should be listening on the specified PORT
   - Example: `npm start` or `pm2 start app.js`

3. **Configure DNS**
   - Point your domain's A record to your server's IP address
   - Wait for DNS propagation (can take a few minutes to hours)

4. **Open firewall ports**
   - Ensure ports 80 and 443 are open (for automatic HTTPS)
   - `sudo ufw allow 80/tcp`
   - `sudo ufw allow 443/tcp`

## Post-Installation

Verify the configuration:
```bash
sudo caddy validate --config /etc/caddy/Caddyfile
```

Check Caddy status:
```bash
sudo systemctl status caddy
```

View Caddy logs:
```bash
sudo journalctl -u caddy -f
```

## Common Issues

**502 Bad Gateway**:
- Your application isn't running on the specified PORT
- Check: `netstat -tlnp | grep {PORT}`

**Certificate errors**:
- DNS not pointing to your server
- Ports 80/443 blocked by firewall
- Check Caddy logs: `sudo journalctl -u caddy -f`

**Domain not resolving**:
- DNS propagation not complete yet
- Verify with: `dig +short myapp.example.com`

## Notes

- Caddy automatically obtains and renews Let's Encrypt certificates
- The reverse proxy preserves the original client IP and headers
- WebSocket connections are automatically supported
- You can add multiple domains by running this cube multiple times with different parameters
