import { describe, expect, it } from 'vitest';
import { selectPreferredRemoteAddress } from '../../packages/web-host/src/networkAddress';

describe('selectPreferredRemoteAddress', () => {
  it('prefers Tailscale over earlier corporate or LAN adapters', () => {
    const nets = {
      'Ethernet 2': [
        {
          family: 'IPv4',
          internal: false,
          address: '10.21.53.222',
        },
      ],
      Tailscale: [
        {
          family: 'IPv4',
          internal: false,
          address: '100.87.187.54',
        },
      ],
      Ethernet: [
        {
          family: 'IPv4',
          internal: false,
          address: '192.168.0.4',
        },
      ],
    } as Parameters<typeof selectPreferredRemoteAddress>[0];

    expect(selectPreferredRemoteAddress(nets)).toBe('100.87.187.54');
  });

  it('ignores link-local addresses when choosing a remote URL', () => {
    const nets = {
      WiFi: [
        {
          family: 'IPv4',
          internal: false,
          address: '169.254.20.10',
        },
      ],
      Ethernet: [
        {
          family: 'IPv4',
          internal: false,
          address: '192.168.0.4',
        },
      ],
    } as Parameters<typeof selectPreferredRemoteAddress>[0];

    expect(selectPreferredRemoteAddress(nets)).toBe('192.168.0.4');
  });
});
