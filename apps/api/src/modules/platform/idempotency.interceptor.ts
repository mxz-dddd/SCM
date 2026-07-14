import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { catchError, from, mergeMap, type Observable, of, throwError } from 'rxjs';
import { AppError } from '../../common/app-error';
import { isPrismaErrorCode } from '../../common/prisma-error';
import { PrismaService } from '../../database/prisma.service';
import type { TenantRequest } from './auth/tenant-context.middleware';
import { IDEMPOTENCY_SCOPE } from './idempotent.decorator';
import { hashIdempotencyRequest } from './idempotency.service';

interface Reservation {
  readonly id: string;
  readonly replay?: { readonly body: unknown; readonly responseCode: number };
}

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const scope = this.reflector.getAllAndOverride<string>(IDEMPOTENCY_SCOPE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!scope) return next.handle();

    const request = context.switchToHttp().getRequest<TenantRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    const key = request.header('Idempotency-Key')?.trim();
    if (!key)
      throw new AppError(
        'IDEMPOTENCY_KEY_REQUIRED',
        'Idempotency-Key is required for this command',
        400,
      );
    if (key.length > 200)
      throw new AppError(
        'IDEMPOTENCY_KEY_INVALID',
        'Idempotency-Key must not exceed 200 characters',
        400,
      );

    const reservation = await this.reserve({
      actorId: request.tenantContext.accountId,
      key,
      requestHash: hashIdempotencyRequest({
        body: request.body,
        params: request.params,
        query: request.query,
      }),
      scope,
      tenantId: request.tenantContext.tenantId,
    });
    if (reservation.replay) {
      response.status(reservation.replay.responseCode);
      return of(reservation.replay.body);
    }

    return next.handle().pipe(
      mergeMap(async (body: unknown) => {
        const responseBody = JSON.parse(
          JSON.stringify({ value: body ?? null }),
        ) as Prisma.InputJsonObject;
        await this.prisma.idempotencyRecord.update({
          data: {
            responseBody,
            responseCode: response.statusCode,
            status: 'ACTIVE',
            updatedBy: request.tenantContext.accountId,
            version: { increment: 1 },
          },
          where: { id: reservation.id },
        });
        return body;
      }),
      catchError((error: unknown) => {
        if (error instanceof AppError) {
          const body = {
            ...(error.options.businessRef
              ? { businessRef: error.options.businessRef }
              : {}),
            code: error.code,
            correlationId: request.header('X-Correlation-Id') ?? 'missing',
            ...(error.options.fieldErrors
              ? { fieldErrors: error.options.fieldErrors }
              : {}),
            message: error.message,
            retryable: error.options.retryable ?? false,
          };
          return from(
            this.prisma.idempotencyRecord.update({
              data: {
                responseBody: jsonEnvelope(body),
                responseCode: error.statusCode,
                status: 'ACTIVE',
                updatedBy: request.tenantContext.accountId,
                version: { increment: 1 },
              },
              where: { id: reservation.id },
            }),
          ).pipe(mergeMap(() => throwError(() => error)));
        }
        return from(
          this.prisma.idempotencyRecord.deleteMany({
            where: { id: reservation.id, status: 'INACTIVE' },
          }),
        ).pipe(mergeMap(() => throwError(() => error)));
      }),
    );
  }

  private async reserve(input: {
    readonly actorId: string;
    readonly key: string;
    readonly requestHash: string;
    readonly scope: string;
    readonly tenantId: string;
  }): Promise<Reservation> {
    const unique = {
      key: input.key,
      scope: input.scope,
      tenantId: input.tenantId,
    };
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: { tenantId_scope_key: unique },
    });
    if (existing) return this.existing(existing, input.requestHash);

    try {
      const created = await this.prisma.idempotencyRecord.create({
        data: {
          createdBy: input.actorId,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          key: input.key,
          requestHash: input.requestHash,
          responseBody: {},
          responseCode: 102,
          scope: input.scope,
          status: 'INACTIVE',
          tenantId: input.tenantId,
          updatedBy: input.actorId,
        },
      });
      return { id: created.id };
    } catch (error) {
      if (!isPrismaErrorCode(error, 'P2002')) throw error;
      const raced = await this.prisma.idempotencyRecord.findUnique({
        where: { tenantId_scope_key: unique },
      });
      if (!raced) throw error;
      return this.existing(raced, input.requestHash);
    }
  }

  private existing(
    record: {
      readonly id: string;
      readonly requestHash: string;
      readonly responseBody: Prisma.JsonValue;
      readonly responseCode: number;
      readonly status: 'ACTIVE' | 'INACTIVE';
    },
    requestHash: string,
  ): Reservation {
    if (record.requestHash !== requestHash)
      throw new AppError(
        'IDEMPOTENCY_KEY_CONFLICT',
        'Idempotency-Key was already used with different content',
        409,
      );
    if (record.status !== 'ACTIVE')
      throw new AppError(
        'IDEMPOTENCY_REQUEST_IN_PROGRESS',
        'The request with this Idempotency-Key is still in progress',
        409,
        { retryable: true },
      );
    const envelope = record.responseBody as { readonly value?: unknown };
    return {
      id: record.id,
      replay: { body: envelope.value, responseCode: record.responseCode },
    };
  }
}

function jsonEnvelope(value: unknown): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify({ value: value ?? null })) as Prisma.InputJsonObject;
}
