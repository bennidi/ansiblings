# ssh-keyman

**Deploy existing SSH keys to host**

## Purpose

This cube deploys pre-existing SSH key pairs from your local machine to a remote server, configuring them for automatic use with specified hosts (like GitHub, GitLab, etc.).

## What This Cube Does

1. **Copies SSH keys to the server**
   - Transfers both private and public keys from local directory to remote `.ssh` folder
   - Sets correct file permissions (600 for private, 644 for public)

2. **Configures SSH client**
   - Creates/updates `.ssh/config` to use the deployed key for specified hosts
   - Disables strict host key checking for easier automation
   - Maps each host to use the correct identity file

3. **Ensures security**
   - Sets proper directory permissions (700 for `.ssh`)
   - Ensures keys are owned by the specified user

## Configuration

### Parameters

- **KEY_NAME** (string, default: `'id_ed25519'`)
  - Name of the SSH key file (without extension)
  - Must exist in the KEY_DIR directory locally

- **USER** (string, default: `'vagrant'`)
  - Username for which to deploy the SSH key
  - Inherited from `user-add` dependency

- **HOSTS** (string, default: `'github.com'`)
  - Space-separated list of hosts to add to known_hosts
  - Example: `'github.com gitlab.com bitbucket.org'`

## Dependencies

- **user-add** - Creates the user account first

## Use Cases

Deploy GitHub SSH key:

```javascript
exec('ssh-keyman', {
  KEY_NAME: 'id_github',
  HOSTS: 'github.com'
})
```

Deploy key for multiple Git services:

```javascript
exec('ssh-keyman', {
  KEY_NAME: 'id_git',
  HOSTS: 'github.com gitlab.com bitbucket.org'
})
```

## What Gets Configured

After deployment, the `.ssh/config` file will contain entries like:

```
Host github.com
    IdentityFile /home/{USER}/.ssh/id_github
    StrictHostKeyChecking no
```

This means when you run `git clone git@github.com:user/repo.git`, it will automatically use the deployed key.

## Key File Requirements

The local KEY_DIR must contain:

- `{KEY_NAME}` - Private key file
- `{KEY_NAME}.pub` - Public key file

For example, if `KEY_NAME=id_github`, you need:

- `./vault/tmp/id_github`
- `./vault/tmp/id_github.pub`

## Security Considerations

- **Private keys are sensitive**: Ensure your local KEY_DIR is secure
- **StrictHostKeyChecking disabled**: Convenient but less secure
  - Consider enabling it for production: Edit `/home/{USER}/.ssh/config`
- **Backup your keys**: Keep secure copies of private keys
- **Use different keys**: Consider separate keys for different services

## Post-Installation

Test SSH connection:

```bash
ssh -T git@github.com
# Should show: "Hi username! You've successfully authenticated..."
```

Clone a repository:

```bash
git clone git@github.com:user/repo.git
# Should work without prompting for credentials
```
