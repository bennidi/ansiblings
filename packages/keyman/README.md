# Keyman - SSH Key Management with Age Encryption

Keyman is a simple command line tool built around the `age` encryption tool. It allows you to manage SSH keys in public GitHub repositories securely by encrypting the private keys.

## Features

- 🔐 Encrypt SSH private keys with age encryption
- 📁 Organized vault structure: `vault/keys/` for encrypted keys, `vault/tmp/` for decrypted keys
- ⚙️ Configurable via `.keymanrc.json` with sensible defaults
- 🔍 Interactive CLI for encrypting, decrypting, and listing keys
- 🔄 Support for key rotation

## Quick Start

### 1. Generate Age Encryption Key

```bash
# Create vault structure
mkdir -p vault/keys vault/tmp

# Generate age encryption key (keep this secret!)
age-keygen -o vault/age.key

# Add to .gitignore
echo "vault/age.key" >> .gitignore
echo "vault/tmp/" >> .gitignore
```

### 2. Generate SSH Keys

```bash
# Generate SSH key pair
ssh-keygen -t ed25519 -f vault/tmp/id_deploy -N "" -C "deploy@myapp.dev"
```

### 3. Run Keyman

```bash
# Run keyman interactively
VAULT_ROOT=./vault keyman

# Or if you have .keymanrc.json configured, just run:
keyman
```

## Configuration

Keyman uses sensible defaults but can be customized via `.keymanrc.json`:

```json
{
  "vaultRoot": "./vault",
  "keysDir": "keys",
  "tmpDir": "tmp",
  "ageKeyFile": "age.key"
}
```

### Configuration Priority

1. **VAULT_ROOT** environment variable (highest priority)
2. **.keymanrc.json** file (searched from current directory upward)
3. **Default values** (lowest priority)

### Default Values

- `vaultRoot`: `"vault"`
- `keysDir`: `"keys"`
- `tmpDir`: `"tmp"`
- `ageKeyFile`: `"age.key"`

## Vault Structure

```
project/
├── vault/
│   ├── age.key         # Master encryption key (NEVER commit!)
│   ├── keys/           # Encrypted keys (safe to commit)
│   │   └── deploy/     # Each key has its own folder
│   │       ├── id_deploy.pub        # Public key
│   │       └── id_deploy.age        # Encrypted private key
│   └── tmp/            # Decrypted keys (NEVER commit!)
│       ├── id_deploy       # Decrypted private key
│       └── id_deploy.pub   # Public key
└── .keymanrc.json      # Configuration (optional)
```

## Operations

Keyman provides an interactive menu-driven interface with the following operations:

- **📋 List keys** - Compact view showing all keys with checkbox indicators for their locations
- **🔒 Encrypt keys** - Encrypt SSH keys from `vault/tmp/` and store in `vault/keys/`
- **🔓 Decrypt keys** - Decrypt keys from `vault/keys/` to `vault/tmp/` or `~/.ssh/`
- **❌ Quit** - Exit the program

After completing any operation, keyman automatically returns to the main menu, allowing you to perform multiple operations in a single session without restarting the tool.

### List Keys Output

The list command shows a compact, unified view of all SSH keys with their locations:

```
🔑 SSH Keys:

  Key Name                      [Vault] [Tmp] [.ssh]
  ──────────────────────────────────────────────────────────
  ✅ id_deploy (.pub)              [✓]   [ ]  [✓]
  🔓 id_github (.pub)              [✓]   [✓]  [ ]
  🔒 id_backup (.pub)              [✓]   [ ]  [ ]
  ⚠️  id_local (.pub)               [ ]   [ ]  [✓]

  Legend:
  ✅ = Managed (encrypted in vault + active in .ssh)
  🔓 = Decrypted (in vault + decrypted to tmp)
  🔒 = Encrypted only (in vault, not decrypted)
  ⚠️  = Unmanaged (in .ssh or tmp, not encrypted in vault)
```

**Features:**
- Public keys are indicated with `(.pub)` suffix instead of separate entries
- Status emoji shows management state at a glance
- Checkboxes `[✓]` show presence in three locations:
  - **[Vault]** - Encrypted in vault/keys/
  - **[Tmp]** - Decrypted in vault/tmp/
  - **[.ssh]** - Active in ~/.ssh/
- Alphabetically sorted for easy scanning
- New **🔓** status for keys decrypted to tmp but not yet in .ssh

## Example Usage

```bash
# Using environment variable
VAULT_ROOT=../../vault keyman

# Using default configuration
keyman

# Keyman will show:
# 📁 Vault Root: /path/to/vault
# 🔑 Keys Directory: /path/to/vault/keys
# 📂 Temp Directory: /path/to/vault/tmp
# 🔐 Age Key: /path/to/vault/age.key
```

## Best Practices

1. **Never commit** `vault/age.key` or `vault/tmp/` to version control
2. **Always backup** your `age.key` securely (password manager, encrypted USB)
3. **Commit** `vault/keys/` - encrypted keys are safe to share
4. **Use environment variables** for CI/CD: `VAULT_ROOT=/path/to/vault keyman`
5. **Keep .keymanrc.json** in your project root for team consistency
