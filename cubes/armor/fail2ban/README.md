# armor-fail2ban

**Install and enable fail2ban**

## Purpose

This cube installs and configures Fail2ban, an intrusion prevention software that protects your server from brute-force attacks and unauthorized access attempts.

## What is Fail2ban?

Fail2ban monitors log files (e.g., `/var/log/auth.log`) for suspicious activity, such as repeated failed login attempts. When it detects malicious behavior patterns, it automatically:

- Bans the offending IP address by updating firewall rules
- Prevents the attacker from making further connection attempts
- Can send email notifications about bans (if configured)

Common use cases include:
- Protecting SSH from brute-force password attacks
- Blocking repeated failed login attempts on web applications
- Preventing DoS attacks from specific IP addresses

## What This Cube Does

1. Installs the `fail2ban` package via apt
2. Deploys a custom configuration file (`jail.local`) to `/etc/fail2ban/jail.local`
3. Configures fail2ban with sensible defaults for common services

## Configuration

This cube currently has no configurable parameters. The default configuration is applied from the included `jail.local` file.

## Dependencies

None - this cube can run standalone.

## Notes

After deployment, you can:
- Check fail2ban status: `sudo fail2ban-client status`
- View banned IPs: `sudo fail2ban-client status sshd`
- Unban an IP: `sudo fail2ban-client set sshd unbanip <IP_ADDRESS>`
