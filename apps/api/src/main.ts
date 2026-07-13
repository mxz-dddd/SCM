import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { CORRELATION_ID_HEADER } from '@scm/shared';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use((request: Request, response: Response, next: NextFunction) => {
    const correlationId = request.header(CORRELATION_ID_HEADER) ?? randomUUID();
    request.headers[CORRELATION_ID_HEADER.toLowerCase()] = correlationId;
    response.setHeader(CORRELATION_ID_HEADER, correlationId);
    next();
  });
  await app.listen(Number(process.env.PORT ?? 3000));
}

void bootstrap();
