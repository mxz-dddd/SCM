import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { AccountKind, SessionClaims } from '@scm/shared';
import { AppError } from '../../../common/app-error';

const ISSUER = 'scm-cloud';
const AUDIENCE = 'scm-api';

interface JwtPayload {
  accountKind: AccountKind;
  aud: string;
  deviceId: string;
  exp: number;
  iat: number;
  iss: string;
  jti: string;
  organizationIds: string[];
  permissionVersion: number;
  sub: string;
  tenantId: string;
}

function encode(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function requireSecret(environment: NodeJS.ProcessEnv): string {
  const secret = environment.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new AppError(
      'JWT_SECRET_INVALID',
      'JWT_SECRET must contain at least 32 characters',
      500,
    );
  }
  return secret;
}

function sign(input: string, secret: string): string {
  return createHmac('sha256', secret).update(input).digest('base64url');
}

function isPayload(value: unknown): value is JwtPayload {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Partial<JwtPayload>;
  return (
    payload.iss === ISSUER &&
    payload.aud === AUDIENCE &&
    typeof payload.sub === 'string' &&
    typeof payload.tenantId === 'string' &&
    typeof payload.deviceId === 'string' &&
    typeof payload.permissionVersion === 'number' &&
    typeof payload.iat === 'number' &&
    typeof payload.exp === 'number' &&
    typeof payload.jti === 'string' &&
    Array.isArray(payload.organizationIds) &&
    payload.organizationIds.every((id) => typeof id === 'string') &&
    ['PLATFORM_ADMIN', 'TENANT_ADMIN', 'USER'].includes(
      payload.accountKind ?? '',
    )
  );
}

export class JwtTokenService {
  constructor(private readonly environment: NodeJS.ProcessEnv = process.env) {}

  issue(
    input: Omit<SessionClaims, 'expiresAt' | 'issuedAt' | 'tokenId'>,
    options: { now?: number; ttlSeconds?: number } = {},
  ): { accessToken: string; claims: SessionClaims; expiresIn: number } {
    const now = options.now ?? Math.floor(Date.now() / 1000);
    const ttlSeconds = options.ttlSeconds ?? 3600;
    const payload: JwtPayload = {
      accountKind: input.accountKind,
      aud: AUDIENCE,
      deviceId: input.deviceId,
      exp: now + ttlSeconds,
      iat: now,
      iss: ISSUER,
      jti: randomUUID(),
      organizationIds: [...input.organizationIds],
      permissionVersion: input.permissionVersion,
      sub: input.subject,
      tenantId: input.tenantId,
    };
    const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}`;
    const accessToken = `${unsigned}.${sign(unsigned, requireSecret(this.environment))}`;
    return {
      accessToken,
      claims: this.toClaims(payload),
      expiresIn: ttlSeconds,
    };
  }

  verify(token: string, now = Math.floor(Date.now() / 1000)): SessionClaims {
    const segments = token.split('.');
    if (segments.length !== 3) {
      throw this.invalidToken();
    }
    const [header, payloadText, signature] = segments;
    if (!header || !payloadText || !signature) {
      throw this.invalidToken();
    }
    const unsigned = `${header}.${payloadText}`;
    const expected = Buffer.from(
      sign(unsigned, requireSecret(this.environment)),
      'utf8',
    );
    const actual = Buffer.from(signature, 'utf8');
    if (
      expected.length !== actual.length ||
      !timingSafeEqual(expected, actual)
    ) {
      throw this.invalidToken();
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(
        Buffer.from(payloadText, 'base64url').toString('utf8'),
      );
    } catch {
      throw this.invalidToken();
    }
    if (!isPayload(decoded) || decoded.exp <= now || decoded.iat > now + 60) {
      throw this.invalidToken();
    }
    return this.toClaims(decoded);
  }

  private invalidToken(): AppError {
    return new AppError(
      'AUTH_TOKEN_INVALID',
      'Authentication token is invalid',
      401,
    );
  }

  private toClaims(payload: JwtPayload): SessionClaims {
    return {
      accountKind: payload.accountKind,
      deviceId: payload.deviceId,
      expiresAt: payload.exp,
      issuedAt: payload.iat,
      organizationIds: payload.organizationIds,
      permissionVersion: payload.permissionVersion,
      subject: payload.sub,
      tenantId: payload.tenantId,
      tokenId: payload.jti,
    };
  }
}
