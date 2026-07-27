# user:edit

**Modify an existing user's password or group membership**

## Purpose

This cube allows you to update existing user accounts on the target system. It can be used to change passwords, add users to new groups (like `docker` or `sudo`), or revoke group memberships.

## What This Cube Does

1. Identifies the existing user on the target system
2. Updates the user's password if `PASSWORD` is provided
3. Adds the user to the groups specified in `GROUPS`
4. Removes the user from the groups specified in `GROUPS_ABSENT`

## Configuration

| Variable | Type | Description | Required |
| :--- | :--- | :--- | :--- |
| `USER` | `string` | The username of the account to modify | Yes |
| `PASSWORD` | `string` | New password for the user | No |
| `GROUPS` | `string` | Comma-separated list of groups to ADD (e.g., `docker,sudo`) | No |
| `GROUPS_ABSENT` | `string` | Comma-separated list of groups to REMOVE | No |

## Dependencies

- `apt/essentials`: Standard system utilities.

## Usage

### Changing a Password

```bash
nopy install user:edit --env USER=myuser --env PASSWORD=newsecurepassword
```

### Adding a User to the Docker Group

```bash
nopy install user:edit --env USER=myuser --env GROUPS=docker
```

### Revoking Sudo Access

```bash
nopy install user:edit --env USER=myuser --env GROUPS_ABSENT=sudo
```

## Security Notes

- When setting passwords via the CLI, they may be visible in your shell history. Consider using a session file or interactive prompts for sensitive values.
- Changing your own user's groups or password may require a re-login to take full effect.
