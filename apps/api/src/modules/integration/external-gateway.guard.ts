import { createHash } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { IntegrationCredentialType } from '@prisma/client';
import type { Request } from 'express';
import { AppError } from '../../common/app-error';
import { EXTERNAL_GATEWAY_BYPASS } from './external-gateway.decorator';
import { GatewayService } from './gateway.service';

interface GatewayRequest extends Request {
  externalGatewayContext?: Awaited<ReturnType<GatewayService['authorize']>>;
  rawBody?: Buffer;
}

const header = (request: Request, name: string): string | undefined =>
  request.header(name)?.trim() || undefined;

@Injectable()
export class ExternalGatewayGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(GatewayService) private readonly gateway: GatewayService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<GatewayRequest>();
    if (!request.path.startsWith('/api/v1/external/')) return true;
    const bypass = this.reflector.getAllAndOverride<string>(
      EXTERNAL_GATEWAY_BYPASS,
      [context.getHandler(), context.getClass()],
    );
    if (bypass) return true;

    const pathname = new URL(request.originalUrl, 'https://gateway.invalid')
      .pathname;
    const rawBody =
      request.rawBody ?? Buffer.from(JSON.stringify(request.body ?? null));
    const declaredBytes = Number(header(request, 'content-length') ?? 0);
    const accessToken = header(request, 'authorization')?.match(
      /^Bearer\s+(.+)$/i,
    )?.[1];
    const keyId = header(request, 'x-scm-key-id');
    const signature = header(request, 'x-scm-signature');
    const certificateFingerprint = this.certificateFingerprint(request);
    const correlationId = header(request, 'x-correlation-id');
    const secret = header(request, 'x-scm-api-secret');
    const timestamp = header(request, 'x-scm-timestamp');
    const type: IntegrationCredentialType = accessToken
      ? 'OAUTH2_CLIENT'
      : signature
        ? 'HMAC'
        : certificateFingerprint
          ? 'MTLS'
          : 'API_KEY';
    if (!accessToken && !keyId)
      throw new AppError(
        'GATEWAY_CREDENTIAL_REQUIRED',
        'Gateway credential is required',
        401,
      );

    request.externalGatewayContext = await this.gateway.authorize({
      ...(accessToken ? { accessToken } : {}),
      body: request.body,
      bodyHash: createHash('sha256').update(rawBody).digest('hex'),
      ...(certificateFingerprint ? { certificateFingerprint } : {}),
      ...(correlationId ? { correlationId } : {}),
      ipAddress: request.ip || request.socket.remoteAddress || 'unknown',
      ...(keyId ? { keyId } : {}),
      method: request.method,
      requestBytes: Math.max(
        rawBody.length,
        Number.isSafeInteger(declaredBytes) ? declaredBytes : 0,
      ),
      route: pathname,
      ...(secret ? { secret } : {}),
      sensitive: header(request, 'x-scm-sensitive') === 'true',
      ...(signature ? { signature } : {}),
      ...(timestamp ? { timestamp } : {}),
      type,
    });
    return true;
  }

  private certificateFingerprint(request: Request): string | undefined {
    const socket = request.socket as typeof request.socket & {
      authorized?: boolean;
      getPeerCertificate?: () => { fingerprint256?: string };
    };
    if (socket.authorized && socket.getPeerCertificate)
      return socket.getPeerCertificate().fingerprint256;
    if (
      process.env.TRUST_CLIENT_CERT_HEADER === 'true' &&
      process.env.TRUST_PROXY
    )
      return header(request, 'x-client-certificate-fingerprint');
    return undefined;
  }
}
