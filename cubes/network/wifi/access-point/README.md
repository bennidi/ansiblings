# WiFi Access Point Cube (NetworkManager)

Configures a Linux device as a WiFi Access Point using NetworkManager's `nmcli` command. **This approach allows the device to simultaneously act as an AP AND remain connected to another WiFi network as a client.**

## Key Features

- ✅ **Dual WiFi Mode**: Acts as AP while staying connected to another WiFi
- ✅ **Modern Approach**: Uses NetworkManager (nmcli) instead of hostapd
- ✅ **Auto-start**: Configured to start on boot
- ✅ **IP Sharing**: Built-in internet sharing with `ipv4.method shared`
- ✅ **Simple Configuration**: Minimal parameters, maximum functionality
- ✅ **Supports 2.4GHz and 5GHz bands**

## Requirements

- Device with WiFi capability (e.g., Raspberry Pi 4/5)
- NetworkManager installed and running
- WiFi hardware that supports AP mode

## Configuration Parameters

### Required

- **SSID**: WiFi network name (1-32 characters)
- **PASSWORD**: WPA2 password (8-63 characters)

### Optional (with defaults)

- **NETWORK_DEVICE**: WiFi interface to use (`wlan0` default)
- **BAND**: Frequency band - `2.4GHz` or `5GHz` (auto-detected from current connection if not specified)
- **CHANNEL**: WiFi channel (auto-detected from current connection if not specified)
  - 2.4GHz: 1-14
  - 5GHz: 36-165
- **IP_ADDRESS**: AP gateway address (`192.168.50.1` default)
- **CONNECTION_NAME**: NetworkManager connection name (`net:wifi:ap` default)

## Example Usage

### Basic Configuration

```json
{
  "SSID": "MyHomeWiFi",
  "PASSWORD": "SecurePass123"
}
```

### Advanced Configuration (5GHz with specific channel)

```json
{
  "SSID": "FastWiFi5G",
  "PASSWORD": "SuperSecure456",
  "NETWORK_DEVICE": "wlan1",
  "BAND": "5GHz",
  "CHANNEL": 36,
  "IP_ADDRESS": "10.0.0.1",
  "CONNECTION_NAME": "my-hotspot"
}
```

### Auto-Detection Configuration

When `BAND` and `CHANNEL` are not specified, the script will automatically detect the current AP's band and channel using `iw dev <interface> link` and use those values for the new hotspot. This is useful when you want the hotspot to operate on the same band/channel as your existing connection to avoid interference.

```json
{
  "SSID": "MyAutoAP",
  "PASSWORD": "SecurePass123"
}
```

## What This Cube Does

1. **Installs NetworkManager** (if not present)
2. **Enables NetworkManager service** and ensures it's running
3. **Auto-detects current AP settings** using `iw dev <interface> link` to find the band and channel
4. **Creates WiFi hotspot** using `nmcli` with auto-detected or specified settings
5. **Configures IP sharing** with `ipv4.method shared` (automatic DHCP + NAT)
6. **Enables IP forwarding** for internet routing
7. **Sets autoconnect** so the AP starts on boot

## How It Works (Dual WiFi Mode)

### Simultaneous AP + Client Mode

**Hardware Support Required:**

- Your WiFi hardware must support **simultaneous AP+STA (Station) mode**
- Most modern WiFi chips support this (e.g., Raspberry Pi 4/5, Intel WiFi cards)
- Older hardware may not support it (e.g., Raspberry Pi 3B and earlier have limitations)

**How NetworkManager Handles It:**

1. **Single Interface (e.g., wlan0):**
   - If hardware supports AP+STA: ✅ **Both client and AP run on same interface**
   - If hardware doesn't support it: ⚠️ **Client connection may be dropped**

2. **Multiple Interfaces (e.g., wlan0 + wlan1):**
   - NetworkManager will use one for client, another for AP
   - Always works regardless of hardware capabilities

**Example Scenario (Raspberry Pi 4):**

```
[Internet] <--WiFi--> [RPi4 wlan0 (Client+AP)] <--WiFi--> [Devices connect to AP]
```

**How to Check Hardware Support:**

```bash
iw list | grep -A 10 "valid interface combinations"
```

Look for: `* #{ managed } <= 1, #{ AP } <= 1` or `* #{ managed, AP } <= 2`

NetworkManager will:

- Share internet from **any** available source (WiFi client, Ethernet, cellular, etc.)
- Automatically handle routing and NAT
- Try to maintain client connection if hardware supports it

## Post-Installation

After deployment, the device will:

- ✅ Broadcast the WiFi network with your SSID
- ✅ Accept connections with your password
- ✅ Assign IP addresses to connected clients (via built-in DHCP)
- ✅ Share internet connection from any available interface
- ✅ Auto-start the AP on every boot
- ✅ Maintain client WiFi connection (if connected to another network)

## Managing the Hotspot

### View connection status

```bash
nmcli connection show
```

### Stop the hotspot

```bash
sudo nmcli connection down net:wifi:ap
```

### Start the hotspot

```bash
sudo nmcli connection up net:wifi:ap
```

### Disable autostart

```bash
sudo nmcli connection modify net:wifi:ap connection.autoconnect no
```

### Delete the hotspot

```bash
sudo nmcli connection delete net:wifi:ap
```

## Troubleshooting

### AP doesn't start

- Check NetworkManager status: `sudo systemctl status NetworkManager`
- Verify WiFi interface exists: `nmcli device status`
- Check if AP mode is supported: `iw list | grep -A 10 "Supported interface modes"`

### Can't connect to AP

- Verify password is correct (8+ characters)
- Check channel compatibility with your devices
- Try switching between 2.4GHz and 5GHz bands

### No internet on clients

- Verify host device has internet: `ping 8.8.8.8`
- Check IP forwarding: `sysctl net.ipv4.ip_forward`
- NetworkManager should handle NAT automatically with `ipv4.method shared`

### Hotspot conflicts with client WiFi

- This shouldn't happen with NetworkManager
- If it does, check if hardware supports simultaneous AP+STA mode:

  ```bash
  iw list | grep "valid interface combinations"
  ```

## Advantages Over Traditional Approach

| Feature | Traditional (hostapd) | NetworkManager (nmcli) |
|---------|----------------------|------------------------|
| **Dual WiFi** | ❌ No (conflicts with wpa_supplicant) | ✅ Yes (AP + client simultaneously) |
| **Configuration** | Complex (multiple files) | Simple (one command) |
| **DHCP** | Manual (dnsmasq) | Automatic |
| **NAT** | Manual (iptables) | Automatic |
| **Management** | Multiple services | Single service |
| **Dependencies** | hostapd, dnsmasq, iptables | NetworkManager only |

## Security Notes

- Always use a strong password (minimum 8 characters)
- WPA2 encryption is automatically enabled
- NetworkManager handles firewall rules automatically

## Compatibility

Tested on:

- Raspberry Pi 4/5 with built-in WiFi
- Ubuntu/Debian-based systems with NetworkManager
- Devices with WiFi hardware supporting AP mode

**Note**: Older Raspberry Pi models (3B and earlier) may have limitations with simultaneous AP + client mode due to hardware constraints.

## Troubleshooting

```bash


sudo nmcli con add type wifi con-name MyHotspot ifname wlan0 mode ap ssid YourNewAP ipv4.method shared wifi-sec.key-mgmt wpa-psk wifi-sec.psk "YourNewPassword"
sudo nmcli con up MyHotspot
sudo nmcli con down MyHotspot
sudo nmcli con mod MyHotspot wifi.band <band> wifi.channel <channel_number>
# Find the currently used band and channel
iw dev wlan0 link

```
