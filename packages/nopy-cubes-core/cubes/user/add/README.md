# user-add

**Add a user with Fish shell and tools**

## Purpose

This cube creates a new user account with a modern shell environment (Fish), SSH key authentication, and enhanced productivity tools pre-configured.

## What This Cube Does

1. **Creates a new user account**
   - Sets up home directory with proper permissions
   - Configures password authentication
   - Adds user to specified groups (e.g., `docker`, `sudo`)
   - Sets Fish as the default login shell

2. **Configures SSH access**
   - Deploys the specified SSH public key for passwordless authentication
   - Creates `.ssh` directory with proper permissions
   - Sets up SSH config file
   - Configures SSH agent auto-loading for Fish shell

3. **Installs Fish shell enhancements**
   - Installs **Oh My Fish** (OMF) - Fish shell framework with themes and plugins
   - Deploys custom Fish configuration (`config.fish`)
   - Sets up Fish rc directory for modular configurations

4. **Creates workspace directories**
   - Creates `/home/{USER}/tmp` directory for temporary files

## Configuration

### Parameters

- **USER** (string, auto-generated)
  - Username for the new user account
  - Default: `userXXXXX` (randomly generated 5-character suffix)

- **PASSWORD** (string, **secret**)
  - Password for the new user account
  - Default: the literal `changeme` — a placeholder, not a credential. Change it
    on first login, or pass a real one.
  - Declared in the manifest's `secrets`, so it is never written to a session or
    history file and is masked in printed commands. A replay asks for it again.
  - It used to default to a randomly generated password. That was removed: since
    the value is not recorded, an unattended run created an account with a
    credential nobody had seen, and replaying that run produced a different one.

- **GROUPS** (string, default: `''`)
  - Space-separated list of additional groups (e.g., `"docker sudo"`)
  - Common groups:
    - `docker` - Run Docker without sudo
    - `sudo` - Administrative privileges
    - `www-data` - Web server file access

- **PUBKEY** (string, default: `''`)
  - SSH public key to authorize for the user
  - Empty (the default) authorizes no key at all — the account is created with
    password login only. Some users simply do not need one.
  - The default is deliberately empty, never a specific key. It used to be a
    personal key, so accepting the default authorized *someone else's* key on
    the new account.

## Dependencies

- **apt:essentials** - Provides Fish shell and basic tools

## What is Fish?

Fish (Friendly Interactive Shell) is a modern command-line shell that focuses on usability:

- **Smart autosuggestions**: Suggests commands as you type based on history
- **Syntax highlighting**: Color-codes commands in real-time
- **Tab completions**: Comprehensive, discoverable command completions
- **No configuration needed**: Works great out of the box

## Post-Installation

After deployment:
- SSH into the server as the new user: `ssh {USER}@server`
- Your SSH key will be pre-authorized (no password needed if using key)
- Fish shell will start automatically with OMF installed
- SSH agent auto-loads to manage your SSH keys

## Notes

- If the user already exists, the cube does nothing at all — rerunning it would
  reset the password and overwrite `~/.config/fish`, so an existing account is
  left untouched.
- The user's home directory is created at `/home/{USER}`
- Fish configuration is stored in `/home/{USER}/.config/fish/`
- Oh My Fish provides package management: `omf install <package>`
- To switch shells: `chsh -s /bin/bash` (or back to fish: `chsh -s /usr/bin/fish`)

Fish's own key bindings and the plugins this cube installs are documented
upstream — `fish_key_reader` lists what is bound, and `omf help` what is
installed. They used to be reproduced here at length, which is not something
this cube knows anything about.
