from pyinfra.operations import server, files, apt, systemd
from pyinfra import host
import subprocess
import json


def get_keyman_config():
    """Get keyman configuration by calling keyman --print-config"""
    try:
        result = subprocess.run(
            ['keyman', '--print-config'],
            capture_output=True,
            text=True,
            check=True
        )
        return json.loads(result.stdout)
    except (subprocess.CalledProcessError, json.JSONDecodeError, FileNotFoundError):
        return None


# Load keyman config for defaults
keyman_config = get_keyman_config()

USER = host.data.USER
KEY = host.data.KEY_NAME

# Use KEY_DIR from host data, or fall back to keyman config tmpDir
DIR = host.data.get('KEY_DIR')
if not DIR and keyman_config:
    DIR = keyman_config.get('tmpDir')
if not DIR:
    DIR = '../../vault/tmp'  # Final fallback

# Support multiple hosts separated by space
HOSTS = map(str.lstrip, str(host.data.HOSTS).split(' '))

# 🔹 Define remote paths
SSH_DIR = f"/home/{USER}/.ssh" if USER != "root" else "/root/.ssh"
PRIVATE_KEY_PATH = f"{SSH_DIR}/{KEY}"
PUBLIC_KEY_PATH = f"{SSH_DIR}/{KEY}.pub"

# Ensure the .ssh directory exists
files.directory(
    name="Ensure .ssh directory exists",
    path=SSH_DIR,
    present=True,
    mode=700,
    user=USER,
    group=USER,
    _sudo=True
)
# Copy private key to the remote server
files.put(
    name="Copy private key",
    src=f"{DIR}/{KEY}",
    dest=PRIVATE_KEY_PATH,
    mode="600",
    user=USER,
    group=USER,
    _sudo=True,
)

# Copy public key to the remote server
files.put(
    name="Copy public key",
    src=f"{DIR}/{KEY}.pub",
    dest=PUBLIC_KEY_PATH,
    mode="644",
    user=USER,
    group=USER,
    _sudo=True,
)

# Ensure correct permissions for the private key
server.shell(
    name="Set correct permissions for private key",
    commands=[f"chmod 600 {PRIVATE_KEY_PATH}"],
    _sudo=True,
)

files.file(
    name="Ensure .ssh/config directory exists",
    path=f"/home/{USER}/.ssh/config",
    present=True,
    user=USER,
    group=USER,
    _sudo=True
)

for host in HOSTS:
  files.line(
    name=f"Configure SSH key for {host}",
    path=f"{SSH_DIR}/config",
    line=f"Host {host}\n    IdentityFile {SSH_DIR}/{KEY}\n    StrictHostKeyChecking no",
    _sudo=True
)