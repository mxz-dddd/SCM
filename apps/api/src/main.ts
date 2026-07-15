import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { CORRELATION_ID_HEADER } from '@scm/shared';
import {
  json,
  type NextFunction,
  type Request,
  type Response,
  urlencoded,
} from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';

const bytes = (value: string | undefined, fallback: string): string =>
  value?.trim() || fallback;

export function corsOrigins(environment: NodeJS.ProcessEnv): string[] {
  const configured = (environment.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const origins =
    configured.length > 0 || environment.NODE_ENV === 'production'
      ? configured
      : ['http://localhost:5173'];
  if (
    environment.NODE_ENV === 'production' &&
    (origins.length === 0 || origins.includes('*'))
  )
    throw new Error(
      'CORS_ALLOWED_ORIGINS must be an explicit production allowlist',
    );
  if (
    origins.some((origin) => {
      try {
        const url = new URL(origin);
        return (
          url.origin !== origin ||
          (url.protocol !== 'https:' && environment.NODE_ENV === 'production')
        );
      } catch {
        return true;
      }
    })
  )
    throw new Error('CORS_ALLOWED_ORIGINS contains an invalid origin');
  return origins;
}

const trustedProxy = (value: string | undefined): false | number | string => {
  const normalized = value?.trim();
  if (!normalized) return false;
  const hops = Number(normalized);
  return Number.isSafeInteger(hops) && hops >= 0 ? hops : normalized;
};

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const express = app.getHttpAdapter().getInstance() as {
    set(name: string, value: boolean | number | string): void;
  };
  express.set('trust proxy', trustedProxy(process.env.TRUST_PROXY));
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.enableCors({ credentials: true, origin: corsOrigins(process.env) });
  app.use((request: Request, response: Response, next: NextFunction) => {
    const supplied = request.header(CORRELATION_ID_HEADER)?.trim();
    const correlationId =
      supplied && supplied.length <= 100 ? supplied : randomUUID();
    request.headers[CORRELATION_ID_HEADER.toLowerCase()] = correlationId;
    response.setHeader(CORRELATION_ID_HEADER, correlationId);
    next();
  });
  const captureRawBody = (
    request: Request & { rawBody?: Buffer },
    _response: Response,
    buffer: Buffer,
  ) => {
    request.rawBody = Buffer.from(buffer);
  };
  app.use(
    json({
      limit: bytes(process.env.API_JSON_BODY_LIMIT, '1mb'),
      verify: captureRawBody,
    }),
  );
  app.use(
    urlencoded({
      extended: false,
      limit: bytes(process.env.API_URLENCODED_BODY_LIMIT, '64kb'),
      verify: captureRawBody,
    }),
  );
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3000));
}

void bootstrap();
