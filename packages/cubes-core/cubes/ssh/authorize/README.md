# ssh-authorize

**Authorize SSH public key for a user**

## Purpose

This cube adds a specific SSH public key to a user's `authorized_keys` file on the remote server, allowing them to log in via SSH using the corresponding private key.

## Configuration

### Parameters

- **USER** (string, default: `'vagrant'`)
  - The username on the remote server to authorize.
  - If the user does not exist, `pyinfra` will attempt to create it (though a full user creation with shell/groups is better handled by `user-add`).

- **PUBKEY** (string, required)
  - The actual content of the public key (e.g., `ssh-ed25519 AAAA...`).

## Use Cases

Grant access to a developer:
```javascript
exec('ssh-authorize', {
  USER: 'developer',
  PUBKEY: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA...'
})
```

## Dependencies

None.
