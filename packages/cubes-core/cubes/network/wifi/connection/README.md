# network:wifi:connection

**Configure a WiFi client connection using NetworkManager**

## Purpose

This cube allows you to connect your target host (e.g., a Raspberry Pi or a laptop) to an existing WiFi network using `nmcli`.

## What This Cube Does

1. Ensures `network-manager` is installed and running
2. Removes any existing connection with the same name to avoid conflicts
3. Connects to the specified `SSID` using the provided `PASSWORD`
4. Configures the connection to automatically connect on boot (optional)

## Configuration

| Variable | Type | Description | Required | Default |
| :--- | :--- | :--- | :--- | :--- |
| `SSID` | `string` | The WiFi network name | Yes | - |
| `PASSWORD` | `string` | The WiFi password | Yes | - |
| `AUTOCONNECT` | `boolean` | Automatically connect to this network | No | `true` |
| `CONNECTION_NAME` | `string` | Name for the connection in NetworkManager | No | `SSID` |

## Dependencies

- `apt/essentials`: Basic system utilities.

## Usage

### Simple Connection

```bash
nopy install network:wifi:connection --env SSID="MyHomeWiFi" --env PASSWORD="mysecurepassword"
```

### Connection with Custom Name and No Autoconnect

```bash
nopy install network:wifi:connection --env SSID="OfficeWiFi" --env PASSWORD="password123" --env CONNECTION_NAME="Work" --env AUTOCONNECT=false
```

## Security Notes

- `PASSWORD` is declared in the manifest's `secrets`: nopy keeps it out of session
  and history files and masks it in every command it prints. It is prompted for
  again on replay.
- That covers what nopy writes, not everything. The value is still on pyinfra's
  command line, so it is visible in `ps` while the deployment runs.
- WiFi passwords will be stored in `/etc/NetworkManager/system-connections/` on the target host.
- Passing passwords via `--env` may leave them in your local shell history.

## Troubleshooting

You can check the status of your WiFi connections on the target host with:
```bash
nmcli connection show
nmcli device status
```
