import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/app-error';

export type DnsResolver = (
  hostname: string,
) => Promise<readonly { address: string; family: number }[]>;

const metadataHosts = new Set([
  '169.254.169.254',
  'instance-data.ec2.internal',
  'metadata.google.internal',
  'metadata.azure.internal',
]);

const ipv4Number = (address: string): number =>
  address
    .split('.')
    .reduce((value, octet) => (value << 8) + Number(octet), 0) >>> 0;
const inV4 = (value: number, network: string, bits: number): boolean => {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (ipv4Number(network) & mask);
};

export function isPublicWebhookAddress(input: string): boolean {
  const address = input.toLowerCase().replace(/^\[|\]$/g, '');
  if (isIP(address) === 4) {
    const value = ipv4Number(address);
    return ![
      ['0.0.0.0', 8],
      ['10.0.0.0', 8],
      ['100.64.0.0', 10],
      ['127.0.0.0', 8],
      ['169.254.0.0', 16],
      ['172.16.0.0', 12],
      ['192.0.0.0', 24],
      ['192.0.2.0', 24],
      ['192.168.0.0', 16],
      ['198.18.0.0', 15],
      ['198.51.100.0', 24],
      ['203.0.113.0', 24],
      ['224.0.0.0', 4],
      ['240.0.0.0', 4],
    ].some(([network, bits]) => inV4(value, String(network), Number(bits)));
  }
  if (isIP(address) !== 6) return false;
  if (address.startsWith('::ffff:')) {
    const suffix = address.slice('::ffff:'.length);
    if (isIP(suffix) === 4) return isPublicWebhookAddress(suffix);
    const parts = suffix.split(':');
    if (parts.length === 2) {
      const high = Number.parseInt(parts[0]!, 16);
      const low = Number.parseInt(parts[1]!, 16);
      if (Number.isInteger(high) && Number.isInteger(low))
        return isPublicWebhookAddress(
          `${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`,
        );
    }
    return false;
  }
  const first = Number.parseInt(address.split(':')[0] || '0', 16);
  return !(
    address === '::' ||
    address === '::1' ||
    (first & 0xe000) !== 0x2000 ||
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xff00) === 0xff00 ||
    address.startsWith('2001:db8:')
  );
}

@Injectable()
export class WebhookEndpointPolicy {
  constructor(
    private readonly resolver: DnsResolver = async (hostname) =>
      lookup(hostname, { all: true, verbatim: true }),
  ) {}

  async validate(value: string): Promise<{
    addresses: readonly { address: string; family: number }[];
    url: string;
  }> {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw this.invalid();
    }
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (
      url.protocol !== 'https:' ||
      Boolean(url.username || url.password) ||
      !hostname ||
      metadataHosts.has(hostname) ||
      hostname.endsWith('.internal') ||
      hostname === 'localhost' ||
      hostname.endsWith('.localhost')
    )
      throw this.invalid();
    let addresses: readonly { address: string; family: number }[];
    try {
      addresses = isIP(hostname)
        ? [{ address: hostname, family: isIP(hostname) }]
        : await this.resolver(hostname);
    } catch {
      throw this.invalid();
    }
    if (
      addresses.length === 0 ||
      addresses.some(({ address }) => !isPublicWebhookAddress(address))
    )
      throw this.invalid();
    return { addresses, url: url.toString() };
  }

  private invalid(): AppError {
    return new AppError(
      'WEBHOOK_ENDPOINT_FORBIDDEN',
      'Webhook endpoint must resolve only to public HTTPS addresses',
      400,
    );
  }
}
