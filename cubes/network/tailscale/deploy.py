from pyinfra import host
from pyinfra.operations import server, apt

# Variables from manifest
AUTH_KEY = host.data.AUTH_KEY
LOGIN_SERVER = host.data.LOGIN_SERVER
EXTRA_ARGS = host.data.EXTRA_ARGS
FORCE_REAUTH = host.data.FORCE_REAUTH

# 1. Install Tailscale using the official one-liner script
server.shell(
    name="Install Tailscale",
    commands=["curl -fsSL https://tailscale.com/install.sh | sh"],
    _sudo=True
)

# 2. Ensure Tailscale is enabled and running
# Manually (Linux): sudo systemctl enable --now tailscaled
server.service(
    name="Ensure tailscaled is running and enabled on boot",
    service="tailscaled",
    running=True,
    enabled=True,
    _sudo=True
)

# 3. Authenticate and bring Tailscale up
# We use --authkey for headless mode
# We use --login-server if it's different from the default
up_command = f"tailscale up --authkey {AUTH_KEY}"

if LOGIN_SERVER and LOGIN_SERVER != "https://controlplane.tailscale.com":
    up_command += f" --login-server {LOGIN_SERVER}"

if FORCE_REAUTH:
    up_command += " --force-reauth"

if EXTRA_ARGS:
    up_command += f" {EXTRA_ARGS}"

server.shell(
    name="Authenticate Tailscale (Headless)",
    commands=[up_command],
    _sudo=True
)
