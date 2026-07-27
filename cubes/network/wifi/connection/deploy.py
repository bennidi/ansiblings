from pyinfra import host
from pyinfra.operations import apt, server, systemd

# [agnt://cogen/cogen/network-wifi-connection-2]{cartridge: "ansiblings/cubes", action: "generated", status: "generated"}

"""
Deployment script for network:wifi:connection.
Uses nmcli to configure a WiFi client connection.
"""

SSID = host.data.SSID
PASSWORD = host.data.PASSWORD
AUTOCONNECT = "yes" if host.data.get('AUTOCONNECT', True) else "no"
CONNECTION_NAME = host.data.get('CONNECTION_NAME', SSID)

# Install NetworkManager if not present
apt.packages(
    name='Install NetworkManager',
    packages=['network-manager'],
    update=True,
    _sudo=True
)

# Ensure NetworkManager is running
systemd.service(
    name='Ensure NetworkManager is running',
    service='NetworkManager',
    running=True,
    enabled=True,
    _sudo=True
)

# Add/Update the WiFi connection
# We delete first to ensure a clean state with the new password/settings
server.shell(
    name=f"Configure WiFi connection for {SSID}",
    commands=[
        f'nmcli connection delete "{CONNECTION_NAME}" || true',
        f'nmcli device wifi connect "{SSID}" password "{PASSWORD}" name "{CONNECTION_NAME}"',
        f'nmcli connection modify "{CONNECTION_NAME}" connection.autoconnect {AUTOCONNECT}',
    ],
    _sudo=True
)
