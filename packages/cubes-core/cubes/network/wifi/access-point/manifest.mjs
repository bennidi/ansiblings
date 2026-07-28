import { Manifest } from '@bitsquare/nopy-cube';
import { z } from 'zod';

export default Manifest({
  id: 'net:wifi:access-point',
  name: 'Configure WiFi Access Point (NetworkManager)',
  dependencies: () => [],
  secrets: ['PASSWORD'],
  schema: z.object({
    SSID: z.string().min(1).max(32).default('PiPoint').describe('WiFi network name (SSID)'),
    PASSWORD: z
      .string()
      .min(8)
      .max(63)
      .default('1223334444')
      .describe('WPA2 password (8-63 characters)'),
    BAND: z.enum(['2.4GHz', '5GHz']).default('2.4GHz').describe('Frequency band'),
    AP_IP: z.string().default('192.168.4.1').describe('AP IP address'),
    CONNECTION_NAME: z.string().default('pi-point').describe('NetworkManager connection name'),
  }),
});
