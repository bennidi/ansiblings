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

- **PASSWORD** (string, auto-generated)
  - Password for the new user account
  - Default: randomly generated secure password

- **GROUPS** (string, default: `''`)
  - Comma-separated list of additional groups (e.g., `"docker,sudo"`)
  - Common groups:
    - `docker` - Run Docker without sudo
    - `sudo` - Administrative privileges
    - `www-data` - Web server file access

- **PUBKEY** (string, has default)
  - SSH public key to authorize for the user
  - Should be your public key for passwordless SSH access

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

- The user's home directory is created at `/home/{USER}`
- Fish configuration is stored in `/home/{USER}/.config/fish/`
- Oh My Fish provides package management: `omf install <package>`
- To switch shells: `chsh -s /bin/bash` (or back to fish: `chsh -s /usr/bin/fish`)

---

# 📌 Most Useful Fish Key Bindings (with Fisher Extensions)

## 🐟 Default Fish Key Bindings

- `Ctrl + C` → Cancel the current command  
- `Ctrl + D` → Exit the shell (or logout if in SSH)  
- `Ctrl + L` → Clear the terminal  
- `Ctrl + R` → Search command history (enhanced by `fzf.fish`)  
- `Ctrl + U` → Delete the entire command line  
- `Ctrl + W` → Delete the last word  
- `Alt + ← / →` → Move backward/forward by a word  

## 🔍 Enhanced with `fzf.fish`

- `Ctrl + R` → **Fuzzy search command history**  
- `Ctrl + T` → **Fuzzy search and insert file path**  
- `Alt + C` → **Fuzzy search directories (`cd` with `z`)**  

## 📂 Directory Navigation (with `z`)

- `z <dir>` → Jump to a frequently used directory  
- `z -l` → List most-used directories  
- `z -c` → Remove a directory from `z`'s database  

## 🔄 Process & Job Management

- `Ctrl + Z` → Suspend the current process  
- `fg` → Bring a suspended process back to foreground  
- `jobs` → List background jobs  

## 🎨 Other Handy Shortcuts

- `fish_vi_key_bindings` → Enable Vi mode (press `Esc` for normal mode)  
- `Ctrl + G` → Show Git status (if using `fzf.fish`)  
- `Ctrl + E` → Edit command line in `$EDITOR`  

## ⚙️ Useful Commands for Key Binding

```fish
# Set Fish default key bindings
fish_default_key_bindings

# Enable Vi mode
fish_vi_key_bindings

# Rebind a custom key (Example: Ctrl + G for git status)
bind \cg 'git status'
