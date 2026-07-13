import {
  ArgumentsHost,
  Catch,
  HttpException,
  type ExceptionFilter,
} from '@nestjs/common';
import type { ApiError } from '@scm/shared';
import type { Request, Response } from 'express';
import { AppError } from './app-error';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    const correlationId =
      request.header('X-Correlation-Id') ?? 'missing-correlation-id';

    if (exception instanceof AppError) {
      const body: ApiError = {
        ...(exception.options.businessRef
          ? { businessRef: exception.options.businessRef }
          : {}),
        code: exception.code,
        correlationId,
        ...(exception.options.fieldErrors
          ? { fieldErrors: exception.options.fieldErrors }
          : {}),
        message: exception.message,
        retryable: exception.options.retryable ?? false,
      };
      response.status(exception.statusCode).json(body);
      return;
    }

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      response.status(statusCode).json({
        code: `HTTP_${statusCode}`,
        correlationId,
        message: exception.message,
        retryable: false,
      } satisfies ApiError);
      return;
    }

    console.error('api.request.failed', {
      correlationId,
      errorName: exception instanceof Error ? exception.name : 'UnknownError',
      message:
        exception instanceof Error ? exception.message : 'Unknown failure',
      path: request.path,
    });
    response.status(500).json({
      code: 'INTERNAL_ERROR',
      correlationId,
      message: 'The request could not be completed',
      retryable: false,
    } satisfies ApiError);
  }
}
