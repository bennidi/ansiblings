from pyinfra.operations import apt, server, systemd
from pyinfra import host

# Extract variables with proper defaults
SSID = host.data.get('SSID')
PASSWORD = host.data.get('PASSWORD')
BAND = host.data.get('BAND', '2.4GHz')
CHANNEL = host.data.get('CHANNEL')  # Optional
AP_IP = host.data.get('AP_IP')
CONNECTION_NAME = host.data.get('CONNECTION_NAME')

# Determine band configuration
if BAND == '5GHz':
    BAND = 'a'
    default_channel = 36 if not CHANNEL else CHANNEL
else:  # 2.4GHz
    BAND = 'bg'
    default_channel = 6 if not CHANNEL else CHANNEL

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

# Check if connection already exists and delete it
server.shell(
    name='Delete existing AP connection if present',
    commands=[f'nmcli connection delete {CONNECTION_NAME} || true'],
    _sudo=True
)

# Add Wifi AP connection
server.shell(
    name='Detect WiFi interface',
    commands=[
        f'sudo nmcli con add type wifi con-name {CONNECTION_NAME} ifname wlan0 mode ap ssid {SSID} ipv4.method shared wifi-sec.key-mgmt wpa-psk wifi-sec.psk "{PASSWORD}"',
        # CRITICAL: Force WPA2 (rsn) instead of WPA (wpa)
        f'sudo nmcli connection modify {CONNECTION_NAME} wifi-sec.proto rsn',

        f'sudo nmcli connection modify {CONNECTION_NAME} ipv4.addresses {AP_IP}/24',

        # Use AES encryption (CCMP) instead of TKIP
        f'sudo nmcli connection modify {CONNECTION_NAME} wifi-sec.pairwise ccmp',
        f'sudo nmcli connection modify {CONNECTION_NAME} wifi-sec.group ccmp',

        # Set band
        f'sudo nmcli connection modify {CONNECTION_NAME} 802-11-wireless.band {BAND}',

        # Enable autostart
        f'sudo nmcli connection modify {CONNECTION_NAME} connection.autoconnect yes',
        f'sudo nmcli connection modify {CONNECTION_NAME} connection.autoconnect-priority 10',

        # Start the AP
        f'sudo nmcli connection up {CONNECTION_NAME}'
    ],
    _sudo=True
)

