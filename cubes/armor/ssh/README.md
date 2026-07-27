# armor-ssh

**Secure SSH server by disabling password authentication**

## Purpose

This cube hardens your SSH server configuration by disabling less secure authentication methods, enforcing SSH key-based authentication only.

## Why Disable Password Authentication?

Password-based SSH authentication is vulnerable to:
- **Brute-force attacks**: Automated scripts trying millions of password combinations
- **Dictionary attacks**: Guessing common passwords
- **Credential stuffing**: Using leaked passwords from other breaches
- **Weak passwords**: Users choosing easily guessable passwords

**SSH key authentication is more secure** because:
- Keys are cryptographically strong (2048+ bit keys vs 8-12 character passwords)
- Private keys never travel over the network
- Immune to brute-force attacks
- Can be protected with passphrases for additional security

## What This Cube Does

1. **Disables challenge-response authentication**
   - Prevents keyboard-interactive authentication prompts

2. **Optionally disables password authentication** (default: enabled)
   - Forces users to authenticate with SSH keys only
   - Prevents password-based login attempts

3. **Optionally disables PAM** (Pluggable Authentication Modules)
   - Disables PAM-based authentication methods
   - Reduces attack surface

4. **Restarts SSH service**
   - Applies the new configuration immediately

## Configuration

### Parameters

- **DISABLE_PASSWORD** (boolean, default: `true`)
  - Disable password authentication for SSH connections
  - ⚠️ **WARNING**: Ensure you have SSH key access configured before enabling this!

- **DISABLE_PAM** (boolean, default: `true`)
  - Disable PAM (Pluggable Authentication Modules) for SSH
  - Recommended for key-only authentication setups

## Dependencies

None - this cube can run standalone.

## Security Best Practices

**Before deploying this cube**:
1. Ensure you have SSH key authentication set up and tested
2. Keep an alternative access method available (console access, VNC, etc.)
3. Test SSH key login before disabling passwords
4. Consider using the `user-add` or `ssh-keyman` cubes first

**After deployment**:
- Only SSH key authentication will work
- Password login attempts will be rejected
- Make sure to back up your private SSH key securely

## Post-Installation

The SSH service will restart automatically. Your current SSH session will remain active, but new connections must use SSH keys.

To verify the configuration:
```bash
sudo grep -E "PasswordAuthentication|ChallengeResponseAuthentication|UsePAM" /etc/ssh/sshd_config
```

## Recovery

If you get locked out:
1. Access the server via console (physical or cloud provider's web console)
2. Edit `/etc/ssh/sshd_config`
3. Set `PasswordAuthentication yes`
4. Restart SSH: `sudo systemctl restart ssh`
