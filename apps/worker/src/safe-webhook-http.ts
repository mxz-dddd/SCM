import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';

export interface ResolvedAddress {
  readonly address: string;
  readonly family: number;
}

export type WebhookResolver = (
  hostname: string,
) => Promise<readonly ResolvedAddress[]>;

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

export function isPublicAddress(input: string): boolean {
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
    if (isIP(suffix) === 4) return isPublicAddress(suffix);
    const parts = suffix.split(':');
    if (parts.length === 2) {
      const high = Number.parseInt(parts[0]!, 16);
      const low = Number.parseInt(parts[1]!, 16);
      if (Number.isInteger(high) && Number.isInteger(low))
        return isPublicAddress(
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

export async function resolvePublicWebhook(
  value: string,
  resolver: WebhookResolver = async (hostname) =>
    lookup(hostname, { all: true, verbatim: true }),
): Promise<{ address: ResolvedAddress; url: URL }> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('WEBHOOK_ENDPOINT_FORBIDDEN');
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
    throw new Error('WEBHOOK_ENDPOINT_FORBIDDEN');
  let addresses: readonly ResolvedAddress[];
  try {
    addresses = isIP(hostname)
      ? [{ address: hostname, family: isIP(hostname) }]
      : await resolver(hostname);
  } catch {
    throw new Error('WEBHOOK_ENDPOINT_FORBIDDEN');
  }
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => !isPublicAddress(address))
  )
    throw new Error('WEBHOOK_ENDPOINT_FORBIDDEN');
  return { address: addresses[0]!, url };
}

export async function readBoundedWebhookBody(
  stream: AsyncIterable<Uint8Array>,
  maximumBytes = 65_536,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.from(chunk);
    length += buffer.length;
    if (length > maximumBytes) throw new Error('WEBHOOK_RESPONSE_TOO_LARGE');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export async function safeWebhookFetch(
  value: string,
  init: RequestInit,
  resolver?: WebhookResolver,
): Promise<Response> {
  const { address, url } = await resolvePublicWebhook(value, resolver);
  const body =
    typeof init.body === 'string' ? Buffer.from(init.body) : Buffer.alloc(0);
  return new Promise<Response>((resolve, reject) => {
    const pinnedLookup = ((_hostname, _options, callback) =>
      callback(
        null,
        address.address,
        address.family as 4 | 6,
      )) as LookupFunction;
    const request = httpsRequest(
      url,
      {
        agent: false,
        headers: Object.fromEntries(new Headers(init.headers).entries()),
        lookup: pinnedLookup,
        method: init.method ?? 'POST',
        servername: url.hostname.replace(/^\[|\]$/g, ''),
        signal: init.signal ?? AbortSignal.timeout(15_000),
      },
      (response) => {
        void readBoundedWebhookBody(response)
          .then((responseBody) => {
            const headers = new Headers();
            for (const [name, content] of Object.entries(response.headers)) {
              if (Array.isArray(content))
                content.forEach((item) => headers.append(name, item));
              else if (content !== undefined)
                headers.set(name, String(content));
            }
            resolve(
              new Response(responseBody.toString('utf8'), {
                headers,
                status: response.statusCode ?? 500,
                ...(response.statusMessage
                  ? { statusText: response.statusMessage }
                  : {}),
              }),
            );
          })
          .catch((error: unknown) => {
            response.destroy();
            reject(error);
          });
      },
    );
    request.setTimeout(5_000, () =>
      request.destroy(new Error('WEBHOOK_CONNECT_TIMEOUT')),
    );
    request.on('error', reject);
    if (body.length > 0) request.write(body);
    request.end();
  });
}
