import type { Prisma } from '@prisma/client';
import { lastValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../common/app-error';
import { IdempotencyInterceptor } from './idempotency.interceptor';

interface RecordRow {
  id: string;
  key: string;
  requestHash: string;
  responseBody: Prisma.JsonValue;
  responseCode: number;
  scope: string;
  status: 'ACTIVE' | 'INACTIVE';
  tenantId: string;
}

function harness() {
  const rows: RecordRow[] = [];
  const prisma = {
    idempotencyRecord: {
      create: ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `record-${rows.length + 1}`,
          ...data,
        } as unknown as RecordRow;
        rows.push(row);
        return Promise.resolve(row);
      },
      deleteMany: ({ where }: { where: { id: string } }) => {
        const index = rows.findIndex(({ id }) => id === where.id);
        if (index >= 0) rows.splice(index, 1);
        return Promise.resolve({ count: index >= 0 ? 1 : 0 });
      },
      findUnique: ({
        where,
      }: {
        where: { tenantId_scope_key: Record<string, string> };
      }) =>
        Promise.resolve(
          rows.find(
            ({ key, scope, tenantId }) =>
              key === where.tenantId_scope_key.key &&
              scope === where.tenantId_scope_key.scope &&
              tenantId === where.tenantId_scope_key.tenantId,
          ) ?? null,
        ),
      update: ({
        data,
        where,
      }: {
        data: Record<string, unknown>;
        where: { id: string };
      }) => {
        const row = rows.find(({ id }) => id === where.id)!;
        Object.assign(row, data, { version: 2 });
        return Promise.resolve(row);
      },
    },
  };
  const interceptor = new IdempotencyInterceptor(
    prisma as never,
    {
      getAllAndOverride: () => 'oms.order.create.v1',
    } as never,
  );
  return { interceptor, rows };
}

function execution(body: Record<string, unknown>, key?: string) {
  const response = {
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    statusCode: 201,
  };
  const request = {
    body,
    header: (name: string) => (name === 'Idempotency-Key' ? key : undefined),
    params: {},
    query: {},
    tenantContext: {
      accountId: '10000000-0000-4000-8000-000000000001',
      tenantId: '10000000-0000-4000-8000-000000000002',
    },
  };
  return {
    context: {
      getClass: () => class TestController {},
      getHandler: () => function create() {},
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    },
    response,
  };
}

describe('common Idempotency-Key interceptor', () => {
  it('returns the original body and status without executing the handler twice', async () => {
    const { interceptor, rows } = harness();
    let executions = 0;
    const first = execution({ externalOrderNo: 'SO-1' }, 'same-key');
    const firstStream = await interceptor.intercept(first.context as never, {
      handle: () => {
        executions += 1;
        return of({ orderId: 'order-1', version: 1 });
      },
    });
    await expect(lastValueFrom(firstStream)).resolves.toEqual({
      orderId: 'order-1',
      version: 1,
    });

    const replay = execution({ externalOrderNo: 'SO-1' }, 'same-key');
    const replayStream = await interceptor.intercept(replay.context as never, {
      handle: () => {
        executions += 1;
        return of({ orderId: 'wrong' });
      },
    });
    await expect(lastValueFrom(replayStream)).resolves.toEqual({
      orderId: 'order-1',
      version: 1,
    });
    expect(replay.response.statusCode).toBe(201);
    expect(executions).toBe(1);
    expect(rows).toHaveLength(1);
  });

  it('returns 409 when the same key is reused with different content', async () => {
    const { interceptor } = harness();
    const first = execution({ externalOrderNo: 'SO-1' }, 'conflict-key');
    await lastValueFrom(
      await interceptor.intercept(first.context as never, {
        handle: () => of({ orderId: 'order-1' }),
      }),
    );
    const conflict = execution({ externalOrderNo: 'SO-2' }, 'conflict-key');
    await expect(
      interceptor.intercept(conflict.context as never, {
        handle: () => of({}),
      }),
    ).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_CONFLICT',
      statusCode: 409,
    });
  });

  it('replays a deterministic command error without executing it twice', async () => {
    const { interceptor } = harness();
    let executions = 0;
    const first = execution({ externalOrderNo: 'SO-CONFLICT' }, 'error-key');
    const firstStream = await interceptor.intercept(first.context as never, {
      handle: () => {
        executions += 1;
        return throwError(
          () =>
            new AppError(
              'ORDER_EXTERNAL_CONTENT_CONFLICT',
              'External order content conflicts',
              409,
            ),
        );
      },
    });
    await expect(lastValueFrom(firstStream)).rejects.toMatchObject({
      code: 'ORDER_EXTERNAL_CONTENT_CONFLICT',
    });
    const replay = execution({ externalOrderNo: 'SO-CONFLICT' }, 'error-key');
    const replayStream = await interceptor.intercept(replay.context as never, {
      handle: () => {
        executions += 1;
        return of({ wrong: true });
      },
    });
    await expect(lastValueFrom(replayStream)).resolves.toMatchObject({
      code: 'ORDER_EXTERNAL_CONTENT_CONFLICT',
      retryable: false,
    });
    expect(replay.response.statusCode).toBe(409);
    expect(executions).toBe(1);
  });

  it('requires the header on marked write endpoints', async () => {
    const { interceptor } = harness();
    const missing = execution({ externalOrderNo: 'SO-1' });
    await expect(
      interceptor.intercept(missing.context as never, { handle: () => of({}) }),
    ).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REQUIRED',
      statusCode: 400,
    });
  });
});
