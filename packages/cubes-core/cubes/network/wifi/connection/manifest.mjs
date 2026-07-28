import { Manifest } from '@bitsquare/nopy-cube';
import { z } from 'zod';

// [agnt://cogen/cogen/network-wifi-connection-1]{cartridge: "ansiblings/cubes", action: "generated", status: "generated"}

/**
 * Manifest for the network:wifi:connection cube.
 * Configures a WiFi client connection using NetworkManager (nmcli).
 */
export default Manifest({
  id: 'net:wifi:connection',
  name: 'network:wifi:connection - Connect to a WiFi network',
  secrets: ['PASSWORD'],
  schema: z.object({
    SSID: z.string().min(1).describe('The SSID of the WiFi network to connect to'),
    PASSWORD: z.string().min(8).describe('The password for the WiFi network'),
    AUTOCONNECT: z
      .boolean()
      .default(true)
      .describe('Whether to automatically connect to this network'),
    CONNECTION_NAME: z
      .string()
      .optional()
      .describe('Optional name for the connection (defaults to SSID)'),
  }),
});
