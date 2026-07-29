# ssh-keygen

**Generate SSH key for a given user**

## Purpose

This cube generates a new SSH key pair for a specified user, which can be used for secure, passwordless authentication to remote servers and services like GitHub, GitLab, or other SSH-accessible systems.

## What are SSH Keys?

SSH keys provide a more secure and convenient way to authenticate compared to passwords:

- **Public key**: Shared with servers/services you want to access (like GitHub)
- **Private key**: Kept secret on your local machine, never shared
- **Passphrase-free**: This cube generates keys without a passphrase for automation
- **Algorithm support**: RSA (traditional) or Ed25519 (modern, recommended)

## What This Cube Does

1. Creates the `.ssh` directory with proper permissions (700)
2. Generates an SSH key pair using the specified algorithm
3. Saves the keys as `id_{SUFFIX}` and `id_{SUFFIX}.pub`
4. Logs the public key to the console for easy copying

## Configuration

### Parameters

- **SUFFIX** (string, default: `'ed25519'`)
  - Suffix for keyname (e.g., `github` → `id_github.pub`)
  - Helps identify the purpose of the key

- **EMAIL** (string, default: `'undefined@bitsquare.dev'`)
  - Email address to associate with the SSH key
  - Used as a comment in the public key

- **ALGORITHM** (enum: `'rsa'` | `'ed25519'`, default: `'ed25519'`)
  - SSH key algorithm type
  - **Ed25519**: Modern, faster, more secure (recommended)
  - **RSA**: Traditional, widely supported

- **USER** (string, default: `'vagrant'`)
  - Username for which to generate the SSH key
  - Inherited from `user-add` dependency

## Dependencies

- **user-add** - Creates the user account first

## Post-Installation

After the key is generated:

1. The public key will be logged to the console
2. Copy the public key and add it to the target service:
   - **GitHub**: Settings → SSH and GPG keys → New SSH key
   - **GitLab**: Preferences → SSH Keys
   - **Remote server**: Add to `~/.ssh/authorized_keys`

3. SSH config is automatically set up for the key

## Key Locations

- Private key: `/home/{USER}/.ssh/id_{SUFFIX}`
- Public key: `/home/{USER}/.ssh/id_{SUFFIX}.pub`

## Algorithm Comparison

**Ed25519** (Recommended):
- Smaller keys (256-bit)
- Faster generation and verification
- More secure against certain attacks
- Not supported on very old systems

**RSA**:
- Larger keys (2048-4096 bit)
- Universally supported
- Slower than Ed25519
- Well-tested and trusted

## Example Usage

Generate a key for GitHub access:
```javascript
exec('ssh-keygen', {
  SUFFIX: 'github',
  EMAIL: 'myemail@example.com',
  ALGORITHM: 'ed25519',
  USER: 'myuser'
})
```

This creates `id_github` and `id_github.pub` in `/home/myuser/.ssh/`.
