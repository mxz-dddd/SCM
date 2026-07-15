import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  Prisma,
  type HandlingUnitType,
  type ReceiptMode,
  type ReceivingDisposition,
  type ReceivingVarianceType,
} from '@prisma/client';
import type { TenantContext } from '@scm/shared';
import { AppError } from '../../common/app-error';
import { isUuid } from '../../common/validation';
import { PrismaService } from '../../database/prisma.service';
import { MdmReferenceService } from '../mdm/public/mdm-reference.service';
import { businessNumber } from '../platform/public/numbering.facade';
import type { CommandMetadata } from '../platform/tenant.service';

interface QuantityInput {
  readonly quantityBase: string;
  readonly quantityOriginal: string;
}
interface ReceiptLotInput extends QuantityInput {
  readonly clientRef: string;
  readonly expiryDate?: string;
  readonly productionDate?: string;
  readonly supplierBatchNo: string;
}
interface ReceiptVarianceInput {
  readonly baseUom?: string;
  readonly originalUom?: string;
  readonly photoRefs?: readonly {
    readonly attachmentId: string;
    readonly contentVersion?: number;
    readonly fileName?: string;
  }[];
  readonly reason: string;
  readonly quantityDeltaBase?: string;
  readonly quantityDeltaOriginal?: string;
  readonly temperature?: string;
  readonly temperatureUom?: string;
  readonly type: ReceivingVarianceType;
}
export interface ReceiveInput {
  readonly expectedTaskVersion: number;
  readonly lines: readonly {
    readonly accepted: QuantityInput;
    readonly inboundLineId: string;
    readonly lots?: readonly ReceiptLotInput[];
    readonly packageSpecId?: string;
    readonly pending: QuantityInput;
    readonly received: QuantityInput;
    readonly rejected: QuantityInput;
    readonly serials?: readonly {
      readonly lotClientRef?: string;
      readonly serialNumber: string;
    }[];
    readonly variances?: readonly ReceiptVarianceInput[];
    readonly varianceReason?: string;
    readonly authorizationReference?: string;
  }[];
  readonly mode: ReceiptMode;
  readonly receivedAt: string;
  readonly taskId: string;
}
export interface CreateHandlingUnitInput {
  readonly contents: readonly (QuantityInput & {
    readonly receiptLineId: string;
  })[];
  readonly lpn?: string;
  readonly mixedAllowed?: boolean;
  readonly parentHandlingUnitId?: string;
  readonly type: HandlingUnitType;
}
export interface BuildHandlingUnitInput {
  readonly childExpectedVersion: number;
  readonly childId: string;
  readonly parentExpectedVersion: number;
}
export interface SplitHandlingUnitInput {
  readonly contents: readonly (QuantityInput & {
    readonly receiptLineId: string;
  })[];
  readonly expectedVersion: number;
  readonly targetLpn?: string;
  readonly targetType?: HandlingUnitType;
}
export interface MergeHandlingUnitInput {
  readonly sourceExpectedVersion: number;
  readonly sourceId: string;
  readonly targetExpectedVersion: number;
}
export interface VarianceInput {
  readonly inboundOrderId: string;
  readonly photoRefs?: ReceiptVarianceInput['photoRefs'];
  readonly reason: string;
  readonly receiptLineId?: string;
  readonly quantityDeltaBase?: string;
  readonly quantityDeltaOriginal?: string;
  readonly baseUom?: string;
  readonly originalUom?: string;
  readonly temperature?: string;
  readonly temperatureUom?: string;
  readonly type: ReceivingVarianceType;
}
export interface DispositionInput {
  readonly expectedVersion: number;
  readonly reason: string;
  readonly targetStatus: Exclude<ReceivingDisposition, 'PENDING'>;
}

const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
function decimal(value: string, field: string, allowZero = false) {
  try {
    const result = new Prisma.Decimal(value);
    if (
      !result.isFinite() ||
      result.isNegative() ||
      (!allowZero && result.isZero())
    )
      throw new Error();
    return result;
  } catch {
    throw new AppError(
      'RECEIVING_QUANTITY_INVALID',
      `${field} must be ${allowZero ? 'a non-negative' : 'a positive'} decimal`,
      400,
    );
  }
}
function signedDecimal(value: string, field: string) {
  try {
    const result = new Prisma.Decimal(value);
    if (!result.isFinite()) throw new Error();
    return result;
  } catch {
    throw new AppError(
      'RECEIVING_DECIMAL_INVALID',
      `${field} must be a decimal`,
      400,
    );
  }
}
function instant(value: string, field: string) {
  const result = new Date(value);
  if (Number.isNaN(result.valueOf()))
    throw new AppError('RECEIVING_DATE_INVALID', `${field} is invalid`, 400);
  return result;
}
function day(value: string | undefined, field: string) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new AppError('RECEIVING_DATE_INVALID', `${field} is invalid`, 400);
  return new Date(`${value}T00:00:00.000Z`);
}
function normalize(value: string, field: string) {
  const result = value.trim().toUpperCase();
  if (!result)
    throw new AppError('RECEIVING_INPUT_INVALID', `${field} is required`, 400);
  return result;
}

@Injectable()
export class ReceivingDetailService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MdmReferenceService) private readonly mdm: MdmReferenceService,
  ) {}

  async get(inboundId: string, context: TenantContext) {
    this.uuid(inboundId, 'inboundId');
    const order = await this.prisma.inboundOrder.findFirst({
      where: { id: inboundId, tenantId: context.tenantId },
    });
    if (!order)
      throw new AppError(
        'INBOUND_NOT_FOUND',
        'Inbound order was not found',
        404,
      );
    const [receiptLines, variances, lots, serials, handlingUnits] =
      await Promise.all([
        this.prisma.receiptLine.findMany({
          orderBy: { receivedAt: 'asc' },
          where: { inboundOrderId: inboundId, tenantId: context.tenantId },
        }),
        this.prisma.receivingVariance.findMany({
          orderBy: { createdAt: 'asc' },
          where: { inboundOrderId: inboundId, tenantId: context.tenantId },
        }),
        this.prisma.inventoryLot.findMany({
          orderBy: { createdAt: 'asc' },
          where: { inboundOrderId: inboundId, tenantId: context.tenantId },
        }),
        this.prisma.serialNumber.findMany({
          orderBy: { createdAt: 'asc' },
          where: { inboundOrderId: inboundId, tenantId: context.tenantId },
        }),
        this.prisma.handlingUnit.findMany({
          orderBy: { createdAt: 'asc' },
          where: { inboundOrderId: inboundId, tenantId: context.tenantId },
        }),
      ]);
    const handlingUnitIds = handlingUnits.map(({ id }) => id);
    const [handlingUnitContents, handlingUnitEvents, labelJobs] =
      handlingUnitIds.length
        ? await Promise.all([
            this.prisma.handlingUnitContent.findMany({
              where: {
                handlingUnitId: { in: handlingUnitIds },
                tenantId: context.tenantId,
              },
            }),
            this.prisma.handlingUnitEvent.findMany({
              orderBy: { occurredAt: 'asc' },
              where: {
                handlingUnitId: { in: handlingUnitIds },
                tenantId: context.tenantId,
              },
            }),
            this.prisma.labelJob.findMany({
              orderBy: { createdAt: 'asc' },
              where: {
                handlingUnitId: { in: handlingUnitIds },
                tenantId: context.tenantId,
              },
            }),
          ])
        : [[], [], []];
    return {
      handlingUnitContents,
      handlingUnitEvents,
      handlingUnits,
      inboundId,
      labelJobs,
      lots,
      receiptLines,
      serials,
      variances,
    };
  }

  async preview(id: string, mode: ReceiptMode, context: TenantContext) {
    this.uuid(id, 'inboundId');
    if (!['BLIND', 'ORDERED'].includes(mode))
      throw new AppError(
        'RECEIPT_MODE_INVALID',
        'Receipt mode is invalid',
        400,
      );
    const order = await this.prisma.inboundOrder.findFirst({
      where: { id, status: 'RECEIVING', tenantId: context.tenantId },
    });
    if (!order)
      throw new AppError(
        'RECEIPT_INBOUND_NOT_RECEIVING',
        'Receiving inbound was not found',
        409,
      );
    const lines = await this.prisma.inboundLine.findMany({
      orderBy: { lineNo: 'asc' },
      where: {
        inboundOrderId: id,
        status: 'ACTIVE',
        tenantId: context.tenantId,
      },
    });
    return {
      inboundId: id,
      mode,
      lines: await Promise.all(
        lines.map(async (line) => {
          const received = await this.prisma.receiptLine.aggregate({
            _sum: {
              receivedQuantityBase: true,
              receivedQuantityOriginal: true,
            },
            where: {
              inboundLineId: line.id,
              status: 'CONFIRMED',
              tenantId: context.tenantId,
            },
          });
          const base = {
            baseUom: line.baseUom,
            inboundLineId: line.id,
            lineNo: line.lineNo,
            originalUom: line.originalUom,
            productId: line.productId,
            productSnapshot: line.productSnapshot,
          };
          return mode === 'BLIND'
            ? base
            : {
                ...base,
                expectedQuantityBase: line.quantityBase.toString(),
                expectedQuantityOriginal: line.quantityOriginal.toString(),
                receivedQuantityBase:
                  received._sum.receivedQuantityBase?.toString() ?? '0',
                receivedQuantityOriginal:
                  received._sum.receivedQuantityOriginal?.toString() ?? '0',
              };
        }),
      ),
    };
  }

  receive(
    id: string,
    input: ReceiveInput,
    context: TenantContext,
    metadata: CommandMetadata,
    authorized = false,
  ) {
    return this.receiveInternal(id, input, context, metadata, authorized);
  }

  private async receiveInternal(
    id: string,
    input: ReceiveInput,
    context: TenantContext,
    metadata: CommandMetadata,
    authorized: boolean,
  ) {
    this.uuid(id, 'inboundId');
    this.uuid(input.taskId, 'taskId');
    if (
      !input.lines.length ||
      new Set(input.lines.map(({ inboundLineId }) => inboundLineId)).size !==
        input.lines.length
    )
      throw new AppError(
        'RECEIPT_LINES_INVALID',
        'Unique receipt lines are required',
        400,
      );
    const receivedAt = instant(input.receivedAt, 'receivedAt');
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${context.tenantId}:${id}:receiving`}, 0))`;
      const [order, task, lines] = await Promise.all([
        tx.inboundOrder.findFirst({
          where: { id, status: 'RECEIVING', tenantId: context.tenantId },
        }),
        tx.receiptTask.findFirst({
          where: {
            id: input.taskId,
            inboundOrderId: id,
            tenantId: context.tenantId,
          },
        }),
        tx.inboundLine.findMany({
          where: {
            id: { in: input.lines.map(({ inboundLineId }) => inboundLineId) },
            inboundOrderId: id,
            status: 'ACTIVE',
            tenantId: context.tenantId,
          },
        }),
      ]);
      if (!order)
        throw new AppError(
          'RECEIPT_INBOUND_NOT_RECEIVING',
          'Inbound is not receiving',
          409,
        );
      if (
        !task ||
        task.version !== input.expectedTaskVersion ||
        task.status !== 'IN_PROGRESS'
      )
        throw new AppError(
          'RECEIPT_TASK_VERSION_OR_STATE_INVALID',
          'Receipt task must be current and in progress',
          409,
        );
      if (lines.length !== input.lines.length)
        throw new AppError(
          'RECEIPT_LINE_NOT_FOUND',
          'Inbound line was not found',
          404,
        );

      const receiptIds: string[] = [];
      const varianceIds: string[] = [];
      const quarantinedLotIds: string[] = [];
      for (const item of input.lines) {
        const line = lines.find(
          ({ id: lineId }) => lineId === item.inboundLineId,
        )!;
        const original = decimal(
          item.received.quantityOriginal,
          'received.quantityOriginal',
        );
        const base = decimal(
          item.received.quantityBase,
          'received.quantityBase',
        );
        const acceptedOriginal = decimal(
          item.accepted.quantityOriginal,
          'accepted.quantityOriginal',
          true,
        );
        const acceptedBase = decimal(
          item.accepted.quantityBase,
          'accepted.quantityBase',
          true,
        );
        const rejectedOriginal = decimal(
          item.rejected.quantityOriginal,
          'rejected.quantityOriginal',
          true,
        );
        const rejectedBase = decimal(
          item.rejected.quantityBase,
          'rejected.quantityBase',
          true,
        );
        const pendingOriginal = decimal(
          item.pending.quantityOriginal,
          'pending.quantityOriginal',
          true,
        );
        const pendingBase = decimal(
          item.pending.quantityBase,
          'pending.quantityBase',
          true,
        );
        if (
          !original.equals(
            acceptedOriginal.add(rejectedOriginal).add(pendingOriginal),
          ) ||
          !base.equals(acceptedBase.add(rejectedBase).add(pendingBase))
        )
          throw new AppError(
            'RECEIPT_QUANTITY_NOT_CONSERVED',
            'Received quantity must equal accepted + rejected + pending',
            409,
          );
        for (const [left, right, field] of [
          [original, base, 'received'],
          [acceptedOriginal, acceptedBase, 'accepted'],
          [rejectedOriginal, rejectedBase, 'rejected'],
          [pendingOriginal, pendingBase, 'pending'],
        ] as const)
          if (
            !left.isZero() &&
            !left
              .mul(line.quantityBase)
              .equals(right.mul(line.quantityOriginal))
          )
            throw new AppError(
              'RECEIPT_QUANTITY_CONVERSION_INVALID',
              `${field} original/base quantity is inconsistent`,
              409,
            );
        const already = await tx.receiptLine.aggregate({
          _sum: {
            receivedQuantityBase: true,
            receivedQuantityOriginal: true,
          },
          where: {
            inboundLineId: line.id,
            status: 'CONFIRMED',
            tenantId: context.tenantId,
          },
        });
        const expectedBase = line.quantityBase.sub(
          already._sum.receivedQuantityBase ?? 0,
        );
        const expectedOriginal = line.quantityOriginal.sub(
          already._sum.receivedQuantityOriginal ?? 0,
        );
        if (!expectedBase.isPositive() || !expectedOriginal.isPositive())
          throw new AppError(
            'RECEIPT_LINE_ALREADY_CLOSED',
            'Inbound line has no remaining expected quantity',
            409,
          );
        const packageSubstitution =
          Boolean(item.packageSpecId) &&
          item.packageSpecId !== line.packageSpecId;
        const requiresAuthorization =
          !base.equals(expectedBase) ||
          !original.equals(expectedOriginal) ||
          packageSubstitution;
        if (requiresAuthorization && !authorized)
          throw new AppError(
            'RECEIPT_VARIANCE_AUTHORIZATION_REQUIRED',
            'Overage, shortage or substitute packaging requires supervisor permission',
            403,
          );
        if (
          requiresAuthorization &&
          (!item.varianceReason?.trim() || !item.authorizationReference?.trim())
        )
          throw new AppError(
            'RECEIPT_VARIANCE_REASON_REQUIRED',
            'Authorized variance requires reason and authorization reference',
            400,
          );
        let packageSpecSnapshot = json(line.packageSpecSnapshot);
        let packageVersion = line.packageSpecVersion;
        if (packageSubstitution) {
          const reference = await this.mdm.resolveOrderReferences(
            {
              lines: [
                {
                  packageSpecId: item.packageSpecId!,
                  productId: line.productId,
                },
              ],
            },
            context,
          );
          const specification = reference.packageSpecs[0];
          if (!specification || specification.productId !== line.productId)
            throw new AppError(
              'RECEIPT_PACKAGE_SUBSTITUTION_INVALID',
              'Substitute package specification is invalid',
              400,
            );
          packageSpecSnapshot = json(specification);
          packageVersion = specification.versionNumber;
        }
        const receiptId = randomUUID();
        await tx.receiptLine.create({
          data: {
            acceptedQuantityBase: acceptedBase,
            acceptedQuantityOriginal: acceptedOriginal,
            authorizationReference: item.authorizationReference?.trim() ?? null,
            createdBy: context.accountId,
            expectedBaseUom: line.baseUom,
            expectedOriginalUom: line.originalUom,
            expectedQuantityBase: expectedBase,
            expectedQuantityOriginal: expectedOriginal,
            id: receiptId,
            inboundLineId: line.id,
            inboundOrderId: id,
            mode: input.mode,
            packageSpecId: item.packageSpecId ?? line.packageSpecId,
            packageSpecSnapshot,
            packageSpecVersion: packageVersion,
            pendingQuantityBase: pendingBase,
            pendingQuantityOriginal: pendingOriginal,
            productId: line.productId,
            productSnapshot: json(line.productSnapshot),
            receiptTaskId: task.id,
            receivedAt,
            receivedBaseUom: line.baseUom,
            receivedOriginalUom: line.originalUom,
            receivedQuantityBase: base,
            receivedQuantityOriginal: original,
            rejectedQuantityBase: rejectedBase,
            rejectedQuantityOriginal: rejectedOriginal,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
            varianceReason: item.varianceReason?.trim() ?? null,
          },
        });
        receiptIds.push(receiptId);

        const snapshot = line.productSnapshot as Prisma.JsonObject;
        const lots = item.lots ?? [];
        const serials = item.serials ?? [];
        const controlledBase = acceptedBase.add(pendingBase);
        if (snapshot.batchControl === 'REQUIRED' && !lots.length)
          throw new AppError(
            'RECEIPT_BATCH_REQUIRED',
            'Supplier batch is required by product snapshot',
            400,
          );
        if (
          lots.length &&
          (!lots
            .reduce(
              (sum, lot) =>
                sum.add(decimal(lot.quantityBase, 'lot.quantityBase')),
              new Prisma.Decimal(0),
            )
            .equals(controlledBase) ||
            !lots
              .reduce(
                (sum, lot) =>
                  sum.add(
                    decimal(lot.quantityOriginal, 'lot.quantityOriginal'),
                  ),
                new Prisma.Decimal(0),
              )
              .equals(acceptedOriginal.add(pendingOriginal)))
        )
          throw new AppError(
            'RECEIPT_LOT_QUANTITY_INVALID',
            'Lot quantity must equal accepted + pending quantity',
            409,
          );
        if (
          new Set(lots.map(({ clientRef }) => clientRef)).size !== lots.length
        )
          throw new AppError(
            'RECEIPT_LOT_REFERENCE_DUPLICATE',
            'Lot client references must be unique',
            400,
          );
        const lotIds = new Map<string, { id: string; quarantined: boolean }>();
        for (const lot of lots) {
          const productionDate = day(lot.productionDate, 'productionDate');
          const expiryDate = day(lot.expiryDate, 'expiryDate');
          if (
            Number(snapshot.shelfLifeDays ?? 0) > 0 &&
            (!productionDate || !expiryDate)
          )
            throw new AppError(
              'RECEIPT_SHELF_LIFE_DATES_REQUIRED',
              'Production and expiry dates are required by product snapshot',
              400,
            );
          const minimum = Number(snapshot.minimumRemainingDays ?? 0);
          const remainingDays = expiryDate
            ? Math.floor(
                (expiryDate.valueOf() - receivedAt.valueOf()) / 86_400_000,
              )
            : Number.POSITIVE_INFINITY;
          const quarantined = remainingDays < minimum;
          const lotId = randomUUID();
          const lotOriginal = decimal(
            lot.quantityOriginal,
            'lot.quantityOriginal',
          );
          const lotBase = decimal(lot.quantityBase, 'lot.quantityBase');
          if (
            !lotOriginal
              .mul(line.quantityBase)
              .equals(lotBase.mul(line.quantityOriginal))
          )
            throw new AppError(
              'RECEIPT_LOT_CONVERSION_INVALID',
              'Lot original/base quantity is inconsistent',
              409,
            );
          await tx.inventoryLot.create({
            data: {
              baseUom: line.baseUom,
              createdBy: context.accountId,
              expiryDate,
              id: lotId,
              inboundOrderId: id,
              originalUom: line.originalUom,
              ownerId: order.ownerId,
              productId: line.productId,
              productionDate,
              quantityBase: lotBase,
              quantityOriginal: lotOriginal,
              quarantineReason: quarantined
                ? `MINIMUM_REMAINING_DAYS:${minimum}`
                : null,
              receiptLineId: receiptId,
              status: quarantined ? 'QUARANTINED' : 'RECEIVED',
              supplierBatchNo: normalize(
                lot.supplierBatchNo,
                'supplierBatchNo',
              ),
              tenantId: context.tenantId,
              updatedBy: context.accountId,
            },
          });
          lotIds.set(lot.clientRef, { id: lotId, quarantined });
          if (quarantined) quarantinedLotIds.push(lotId);
        }
        if (snapshot.serialControl === 'REQUIRED') {
          if (
            !controlledBase.isInteger() ||
            serials.length !== controlledBase.toNumber()
          )
            throw new AppError(
              'RECEIPT_SERIAL_COUNT_INVALID',
              'Serial count must equal accepted + pending base quantity',
              409,
            );
        }
        if (
          new Set(
            serials.map(({ serialNumber }) =>
              normalize(serialNumber, 'serialNumber'),
            ),
          ).size !== serials.length
        )
          throw new AppError(
            'RECEIPT_SERIAL_DUPLICATE',
            'Serial numbers must be unique',
            409,
          );
        for (const serial of serials) {
          const lot = serial.lotClientRef
            ? lotIds.get(serial.lotClientRef)
            : undefined;
          if (serial.lotClientRef && !lot)
            throw new AppError(
              'RECEIPT_SERIAL_LOT_INVALID',
              'Serial references an unknown lot',
              400,
            );
          await tx.serialNumber.create({
            data: {
              createdBy: context.accountId,
              inboundOrderId: id,
              inventoryLotId: lot?.id ?? null,
              productId: line.productId,
              receiptLineId: receiptId,
              serialNumber: normalize(serial.serialNumber, 'serialNumber'),
              status: lot?.quarantined ? 'QUARANTINED' : 'RECEIVED',
              tenantId: context.tenantId,
              updatedBy: context.accountId,
            },
          });
        }
        const automaticVariances: ReceiptVarianceInput[] = [
          ...(requiresAuthorization
            ? [
                {
                  reason: item.varianceReason!,
                  quantityDeltaBase: base.sub(expectedBase).toString(),
                  quantityDeltaOriginal: original
                    .sub(expectedOriginal)
                    .toString(),
                  baseUom: line.baseUom,
                  originalUom: line.originalUom,
                  type: 'QUANTITY' as const,
                },
              ]
            : []),
          ...(item.variances ?? []),
        ];
        for (const variance of automaticVariances) {
          const varianceId = await this.createVariance(
            tx,
            {
              inboundOrderId: id,
              ...(variance.photoRefs ? { photoRefs: variance.photoRefs } : {}),
              reason: variance.reason,
              receiptLineId: receiptId,
              ...('quantityDeltaBase' in variance
                ? {
                    baseUom: variance.baseUom,
                    originalUom: variance.originalUom,
                    quantityDeltaBase: variance.quantityDeltaBase,
                    quantityDeltaOriginal: variance.quantityDeltaOriginal,
                  }
                : {}),
              ...(variance.temperature
                ? { temperature: variance.temperature }
                : {}),
              ...(variance.temperatureUom
                ? { temperatureUom: variance.temperatureUom }
                : {}),
              type: variance.type,
            },
            context,
            metadata,
          );
          varianceIds.push(varianceId);
        }
      }
      await this.record(
        tx,
        id,
        'InboundOrder',
        order.version,
        'inbound.receipt-confirmed.v1',
        context,
        metadata,
        {
          authorizedVariance: authorized,
          inboundId: id,
          mode: input.mode,
          quarantinedLotIds,
          receiptIds,
          taskId: task.id,
          varianceIds,
        },
      );
      return { quarantinedLotIds, receiptIds, varianceIds };
    });
  }

  async createHandlingUnit(
    inboundId: string,
    input: CreateHandlingUnitInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(inboundId, 'inboundId');
    if (!input.contents.length && input.type !== 'PALLET')
      throw new AppError(
        'HANDLING_UNIT_CONTENT_REQUIRED',
        'Carton handling unit content is required',
        400,
      );
    const lpn = normalize(
      input.lpn ??
        (await businessNumber(
          this.prisma,
          'WMS_HANDLING_UNIT',
          context,
          metadata,
          `handling-unit:${inboundId}`,
        )),
      'lpn',
    );
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${context.tenantId}:${inboundId}:handling-unit`}, 0))`;
      const order = await tx.inboundOrder.findFirst({
        where: {
          id: inboundId,
          status: 'RECEIVING',
          tenantId: context.tenantId,
        },
      });
      if (!order)
        throw new AppError(
          'HANDLING_UNIT_INBOUND_INVALID',
          'Inbound is not receiving',
          409,
        );
      const contents = await this.validateHuContents(
        tx,
        inboundId,
        input.contents,
        context,
      );
      const parent = input.parentHandlingUnitId
        ? await this.hu(tx, input.parentHandlingUnitId, context)
        : null;
      if (parent && parent.inboundOrderId !== inboundId)
        throw new AppError(
          'HANDLING_UNIT_PARENT_INVALID',
          'Parent belongs to another inbound',
          409,
        );
      await this.assertMixing(
        tx,
        parent,
        contents.map(({ productId }) => productId),
        context,
      );
      const id = randomUUID();
      const unit = await tx.handlingUnit.create({
        data: {
          createdBy: context.accountId,
          id,
          inboundOrderId: inboundId,
          labelNumber: lpn,
          lpn,
          mixedAllowed: input.mixedAllowed ?? false,
          parentHandlingUnitId: parent?.id ?? null,
          tenantId: context.tenantId,
          type: input.type,
          updatedBy: context.accountId,
        },
      });
      for (const content of contents)
        await tx.handlingUnitContent.create({
          data: {
            baseUom: content.baseUom,
            createdBy: context.accountId,
            handlingUnitId: id,
            originalUom: content.originalUom,
            productId: content.productId,
            quantityBase: content.quantityBase,
            quantityOriginal: content.quantityOriginal,
            receiptLineId: content.receiptLineId,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
      await tx.handlingUnitEvent.create({
        data: {
          createdBy: context.accountId,
          handlingUnitId: id,
          payload: { lpn, type: input.type },
          tenantId: context.tenantId,
          toParentId: parent?.id ?? null,
          type: 'CREATED',
          updatedBy: context.accountId,
        },
      });
      const labelJob = await this.labelJob(
        tx,
        unit,
        null,
        'INITIAL_LABEL',
        1,
        context,
        metadata,
      );
      await this.record(
        tx,
        id,
        'HandlingUnit',
        unit.version,
        'wms.handling-unit-created.v1',
        context,
        metadata,
        { handlingUnitId: id, inboundId, labelJobId: labelJob.id, lpn },
      );
      return {
        handlingUnitId: id,
        labelJobId: labelJob.id,
        labelNumber: unit.labelNumber,
        lpn,
        version: unit.version,
      };
    });
  }

  async buildHandlingUnit(
    parentId: string,
    input: BuildHandlingUnitInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(parentId, 'parentId');
    this.uuid(input.childId, 'childId');
    return this.prisma.$transaction(async (tx) => {
      const [parent, child] = await Promise.all([
        this.hu(tx, parentId, context),
        this.hu(tx, input.childId, context),
      ]);
      if (
        parent.version !== input.parentExpectedVersion ||
        child.version !== input.childExpectedVersion ||
        parent.status !== 'ACTIVE' ||
        child.status !== 'ACTIVE' ||
        parent.inboundOrderId !== child.inboundOrderId ||
        parent.id === child.id
      )
        throw this.huConflict();
      let cursor: string | null = parent.parentHandlingUnitId;
      while (cursor) {
        if (cursor === child.id)
          throw new AppError(
            'HANDLING_UNIT_CYCLE',
            'Handling unit hierarchy cannot contain a cycle',
            409,
          );
        cursor =
          (
            await tx.handlingUnit.findFirst({
              where: { id: cursor, tenantId: context.tenantId },
            })
          )?.parentHandlingUnitId ?? null;
      }
      const products = await this.huProducts(tx, child.id, context);
      await this.assertMixing(tx, parent, products, context);
      const changed = await tx.handlingUnit.updateMany({
        data: {
          parentHandlingUnitId: parent.id,
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: {
          id: child.id,
          status: 'ACTIVE',
          version: input.childExpectedVersion,
        },
      });
      if (changed.count !== 1) throw this.huConflict();
      const parentChanged = await tx.handlingUnit.updateMany({
        data: { updatedBy: context.accountId, version: { increment: 1 } },
        where: {
          id: parent.id,
          status: 'ACTIVE',
          version: input.parentExpectedVersion,
        },
      });
      if (parentChanged.count !== 1) throw this.huConflict();
      await tx.handlingUnitEvent.create({
        data: {
          createdBy: context.accountId,
          fromParentId: child.parentHandlingUnitId,
          handlingUnitId: child.id,
          payload: { operation: 'BUILD' },
          targetHandlingUnitId: parent.id,
          tenantId: context.tenantId,
          toParentId: parent.id,
          type: 'BUILT',
          updatedBy: context.accountId,
        },
      });
      await this.record(
        tx,
        child.id,
        'HandlingUnit',
        child.version + 1,
        'wms.handling-unit-built.v1',
        context,
        metadata,
        { childId: child.id, inboundId: child.inboundOrderId, parentId },
      );
      return {
        childId: child.id,
        parentId,
        parentVersion: parent.version + 1,
        version: child.version + 1,
      };
    });
  }

  async splitHandlingUnit(
    sourceId: string,
    input: SplitHandlingUnitInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(sourceId, 'sourceId');
    if (!input.contents.length)
      throw new AppError(
        'HANDLING_UNIT_SPLIT_EMPTY',
        'Split content is required',
        400,
      );
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${context.tenantId}:${sourceId}:split`}, 0))`;
      const source = await this.hu(tx, sourceId, context);
      if (
        source.status !== 'ACTIVE' ||
        source.version !== input.expectedVersion
      )
        throw this.huConflict();
      const rows = await tx.handlingUnitContent.findMany({
        where: {
          handlingUnitId: sourceId,
          status: 'ACTIVE',
          tenantId: context.tenantId,
        },
      });
      const targetId = randomUUID();
      const targetLpn = normalize(
        input.targetLpn ??
          (await businessNumber(
            this.prisma,
            'WMS_HANDLING_UNIT',
            context,
            metadata,
            `handling-unit-split:${sourceId}:${source.version}`,
          )),
        'targetLpn',
      );
      const target = await tx.handlingUnit.create({
        data: {
          createdBy: context.accountId,
          id: targetId,
          inboundOrderId: source.inboundOrderId,
          labelNumber: targetLpn,
          lpn: targetLpn,
          mixedAllowed: source.mixedAllowed,
          parentHandlingUnitId: source.parentHandlingUnitId,
          tenantId: context.tenantId,
          type: input.targetType ?? source.type,
          updatedBy: context.accountId,
        },
      });
      for (const move of input.contents) {
        const row = rows.find(
          ({ receiptLineId }) => receiptLineId === move.receiptLineId,
        );
        if (!row)
          throw new AppError(
            'HANDLING_UNIT_CONTENT_INVALID',
            'Split content was not found',
            404,
          );
        const original = decimal(move.quantityOriginal, 'quantityOriginal');
        const base = decimal(move.quantityBase, 'quantityBase');
        if (
          original.greaterThan(row.quantityOriginal) ||
          base.greaterThan(row.quantityBase)
        )
          throw new AppError(
            'HANDLING_UNIT_SPLIT_OVERAGE',
            'Split exceeds source content',
            409,
          );
        if (
          !original.mul(row.quantityBase).equals(base.mul(row.quantityOriginal))
        )
          throw new AppError(
            'HANDLING_UNIT_CONVERSION_INVALID',
            'Split quantity conversion is invalid',
            409,
          );
        const remainingOriginal = row.quantityOriginal.sub(original);
        const remainingBase = row.quantityBase.sub(base);
        await tx.handlingUnitContent.update({
          data: {
            quantityBase: remainingBase.isZero()
              ? row.quantityBase
              : remainingBase,
            quantityOriginal: remainingOriginal.isZero()
              ? row.quantityOriginal
              : remainingOriginal,
            status: remainingBase.isZero() ? 'INACTIVE' : 'ACTIVE',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: row.id },
        });
        await tx.handlingUnitContent.create({
          data: {
            baseUom: row.baseUom,
            createdBy: context.accountId,
            handlingUnitId: target.id,
            originalUom: row.originalUom,
            productId: row.productId,
            quantityBase: base,
            quantityOriginal: original,
            receiptLineId: row.receiptLineId,
            tenantId: context.tenantId,
            updatedBy: context.accountId,
          },
        });
      }
      const hasRemaining = await tx.handlingUnitContent.count({
        where: {
          handlingUnitId: source.id,
          status: 'ACTIVE',
          tenantId: context.tenantId,
        },
      });
      const changed = await tx.handlingUnit.update({
        data: {
          status: hasRemaining ? 'ACTIVE' : 'SPLIT',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id: source.id },
      });
      await tx.handlingUnitEvent.create({
        data: {
          createdBy: context.accountId,
          handlingUnitId: source.id,
          payload: { contentCount: input.contents.length },
          sourceHandlingUnitId: source.id,
          targetHandlingUnitId: target.id,
          tenantId: context.tenantId,
          type: 'SPLIT',
          updatedBy: context.accountId,
        },
      });
      const label = await this.labelJob(
        tx,
        target,
        null,
        'SPLIT_LABEL',
        1,
        context,
        metadata,
      );
      await this.record(
        tx,
        source.id,
        'HandlingUnit',
        changed.version,
        'wms.handling-unit-split.v1',
        context,
        metadata,
        { inboundId: source.inboundOrderId, sourceId: source.id, targetId },
      );
      return {
        labelJobId: label.id,
        sourceVersion: changed.version,
        targetId,
        targetLpn,
      };
    });
  }

  async mergeHandlingUnit(
    targetId: string,
    input: MergeHandlingUnitInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(targetId, 'targetId');
    this.uuid(input.sourceId, 'sourceId');
    return this.prisma.$transaction(async (tx) => {
      const [target, source] = await Promise.all([
        this.hu(tx, targetId, context),
        this.hu(tx, input.sourceId, context),
      ]);
      if (
        target.id === source.id ||
        target.status !== 'ACTIVE' ||
        source.status !== 'ACTIVE' ||
        target.inboundOrderId !== source.inboundOrderId ||
        target.version !== input.targetExpectedVersion ||
        source.version !== input.sourceExpectedVersion
      )
        throw this.huConflict();
      const sourceContents = await tx.handlingUnitContent.findMany({
        where: {
          handlingUnitId: source.id,
          status: 'ACTIVE',
          tenantId: context.tenantId,
        },
      });
      await this.assertMixing(
        tx,
        target,
        sourceContents.map(({ productId }) => productId),
        context,
      );
      for (const sourceContent of sourceContents) {
        const existing = await tx.handlingUnitContent.findUnique({
          where: {
            tenantId_handlingUnitId_receiptLineId: {
              handlingUnitId: target.id,
              receiptLineId: sourceContent.receiptLineId,
              tenantId: context.tenantId,
            },
          },
        });
        if (existing)
          await tx.handlingUnitContent.update({
            data: {
              quantityBase:
                existing.status === 'ACTIVE'
                  ? { increment: sourceContent.quantityBase }
                  : sourceContent.quantityBase,
              quantityOriginal:
                existing.status === 'ACTIVE'
                  ? { increment: sourceContent.quantityOriginal }
                  : sourceContent.quantityOriginal,
              status: 'ACTIVE',
              updatedBy: context.accountId,
              version: { increment: 1 },
            },
            where: { id: existing.id },
          });
        else
          await tx.handlingUnitContent.create({
            data: {
              baseUom: sourceContent.baseUom,
              createdBy: context.accountId,
              handlingUnitId: target.id,
              originalUom: sourceContent.originalUom,
              productId: sourceContent.productId,
              quantityBase: sourceContent.quantityBase,
              quantityOriginal: sourceContent.quantityOriginal,
              receiptLineId: sourceContent.receiptLineId,
              tenantId: context.tenantId,
              updatedBy: context.accountId,
            },
          });
        await tx.handlingUnitContent.update({
          data: {
            status: 'INACTIVE',
            updatedBy: context.accountId,
            version: { increment: 1 },
          },
          where: { id: sourceContent.id },
        });
      }
      const sourceChanged = await tx.handlingUnit.updateMany({
        data: {
          status: 'MERGED',
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: {
          id: source.id,
          status: 'ACTIVE',
          version: input.sourceExpectedVersion,
        },
      });
      const targetChanged = await tx.handlingUnit.updateMany({
        data: { updatedBy: context.accountId, version: { increment: 1 } },
        where: {
          id: target.id,
          status: 'ACTIVE',
          version: input.targetExpectedVersion,
        },
      });
      if (sourceChanged.count !== 1 || targetChanged.count !== 1)
        throw this.huConflict();
      await tx.handlingUnitEvent.create({
        data: {
          createdBy: context.accountId,
          handlingUnitId: source.id,
          payload: { contentCount: sourceContents.length },
          sourceHandlingUnitId: source.id,
          targetHandlingUnitId: target.id,
          tenantId: context.tenantId,
          type: 'MERGED',
          updatedBy: context.accountId,
        },
      });
      await this.record(
        tx,
        target.id,
        'HandlingUnit',
        target.version + 1,
        'wms.handling-unit-merged.v1',
        context,
        metadata,
        {
          inboundId: target.inboundOrderId,
          sourceId: source.id,
          targetId: target.id,
        },
      );
      return {
        sourceStatus: 'MERGED',
        targetId,
        targetVersion: target.version + 1,
      };
    });
  }

  async reprintLabel(
    id: string,
    input: { copies?: number; reason: string },
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'handlingUnitId');
    if (!input.reason?.trim())
      throw new AppError(
        'LABEL_REPRINT_REASON_REQUIRED',
        'Reprint reason is required',
        400,
      );
    const copies = input.copies ?? 1;
    if (!Number.isInteger(copies) || copies < 1 || copies > 100)
      throw new AppError(
        'LABEL_COPIES_INVALID',
        'Copies must be between 1 and 100',
        400,
      );
    return this.prisma.$transaction(async (tx) => {
      const unit = await this.hu(tx, id, context);
      const original = await tx.labelJob.findFirst({
        orderBy: { createdAt: 'asc' },
        where: { handlingUnitId: id, tenantId: context.tenantId },
      });
      if (!original)
        throw new AppError(
          'LABEL_JOB_NOT_FOUND',
          'Original label job was not found',
          404,
        );
      const job = await this.labelJob(
        tx,
        unit,
        original.id,
        input.reason.trim(),
        copies,
        context,
        metadata,
      );
      await this.record(
        tx,
        job.id,
        'LabelJob',
        job.version,
        'wms.label-reprint-requested.v1',
        context,
        metadata,
        { handlingUnitId: id, jobId: job.id, labelNumber: job.labelNumber },
      );
      return {
        jobId: job.id,
        labelNumber: job.labelNumber,
        status: job.status,
      };
    });
  }

  async openVariance(
    input: VarianceInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(input.inboundOrderId, 'inboundOrderId');
    if (input.receiptLineId) this.uuid(input.receiptLineId, 'receiptLineId');
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.inboundOrder.findFirst({
        where: {
          id: input.inboundOrderId,
          status: 'RECEIVING',
          tenantId: context.tenantId,
        },
      });
      if (!order)
        throw new AppError(
          'RECEIVING_VARIANCE_INBOUND_INVALID',
          'Inbound is not receiving',
          409,
        );
      if (
        input.receiptLineId &&
        !(await tx.receiptLine.count({
          where: {
            id: input.receiptLineId,
            inboundOrderId: input.inboundOrderId,
            tenantId: context.tenantId,
          },
        }))
      )
        throw new AppError(
          'RECEIVING_VARIANCE_RECEIPT_INVALID',
          'Receipt line does not belong to inbound',
          400,
        );
      const id = await this.createVariance(tx, input, context, metadata);
      await this.record(
        tx,
        id,
        'ReceivingVariance',
        1,
        'receiving.variance-opened.v1',
        context,
        metadata,
        { inboundId: order.id, type: input.type, varianceId: id },
      );
      return { status: 'PENDING', varianceId: id, version: 1 };
    });
  }

  async disposeVariance(
    id: string,
    input: DispositionInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    this.uuid(id, 'varianceId');
    if (!input.reason?.trim())
      throw new AppError(
        'RECEIVING_DISPOSITION_REASON_REQUIRED',
        'Disposition reason is required',
        400,
      );
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.receivingVariance.findFirst({
        where: { id, tenantId: context.tenantId },
      });
      if (!row)
        throw new AppError(
          'RECEIVING_VARIANCE_NOT_FOUND',
          'Variance was not found',
          404,
        );
      if (row.version !== input.expectedVersion || row.status !== 'PENDING')
        throw new AppError(
          'RECEIVING_DISPOSITION_INVALID',
          'Variance is not pending or changed',
          409,
        );
      const photos = row.photoRefs as Prisma.JsonArray;
      if (
        input.targetStatus === 'REJECTED' &&
        ['DAMAGE', 'TEMPERATURE'].includes(row.type) &&
        !photos.length
      )
        throw new AppError(
          'RECEIVING_REJECTION_PHOTO_REQUIRED',
          'Damage or temperature rejection requires photo evidence',
          400,
        );
      const updated = await tx.receivingVariance.updateMany({
        data: {
          dispositionReason: input.reason.trim(),
          resolvedAt: new Date(),
          status: input.targetStatus,
          updatedBy: context.accountId,
          version: { increment: 1 },
        },
        where: { id, status: 'PENDING', version: input.expectedVersion },
      });
      if (updated.count !== 1)
        throw new AppError(
          'RECEIVING_DISPOSITION_INVALID',
          'Variance changed',
          409,
        );
      await this.record(
        tx,
        id,
        'ReceivingVariance',
        row.version + 1,
        'receiving.variance-disposed.v1',
        context,
        metadata,
        {
          inboundId: row.inboundOrderId,
          status: input.targetStatus,
          varianceId: id,
        },
      );
      return { status: input.targetStatus, version: row.version + 1 };
    });
  }

  private async createVariance(
    tx: Prisma.TransactionClient,
    input: VarianceInput,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    if (!input.reason?.trim())
      throw new AppError(
        'RECEIVING_VARIANCE_REASON_REQUIRED',
        'Variance reason is required',
        400,
      );
    const photoRefs = input.photoRefs ?? [];
    for (const photo of photoRefs)
      this.uuid(photo.attachmentId, 'attachmentId');
    const quantityParts = [
      input.quantityDeltaBase,
      input.quantityDeltaOriginal,
      input.baseUom,
      input.originalUom,
    ];
    if (
      quantityParts.some((value) => value !== undefined) &&
      quantityParts.some((value) => value === undefined)
    )
      throw new AppError(
        'RECEIVING_VARIANCE_QUANTITY_INVALID',
        'Quantity variance requires original/base delta and UOM',
        400,
      );
    const id = randomUUID();
    await tx.receivingVariance.create({
      data: {
        createdBy: context.accountId,
        id,
        inboundOrderId: input.inboundOrderId,
        photoRefs: json(photoRefs),
        purchaseNotificationRef: randomUUID(),
        reason: input.reason.trim(),
        receiptLineId: input.receiptLineId ?? null,
        quantityDeltaBase: input.quantityDeltaBase
          ? signedDecimal(input.quantityDeltaBase, 'quantityDeltaBase')
          : null,
        quantityDeltaOriginal: input.quantityDeltaOriginal
          ? signedDecimal(input.quantityDeltaOriginal, 'quantityDeltaOriginal')
          : null,
        baseUom: input.baseUom?.trim().toUpperCase() ?? null,
        originalUom: input.originalUom?.trim().toUpperCase() ?? null,
        supplierNotificationRef: randomUUID(),
        temperature: input.temperature
          ? signedDecimal(input.temperature, 'temperature')
          : null,
        temperatureUom: input.temperatureUom?.trim().toUpperCase() ?? null,
        tenantId: context.tenantId,
        type: input.type,
        updatedBy: context.accountId,
        varianceNo: await businessNumber(
          this.prisma,
          'WMS_RECEIVING_VARIANCE',
          context,
          metadata,
          `receiving-variance:${id}`,
        ),
      },
    });
    return id;
  }

  private async validateHuContents(
    tx: Prisma.TransactionClient,
    inboundId: string,
    input: CreateHandlingUnitInput['contents'],
    context: TenantContext,
  ) {
    if (
      new Set(input.map(({ receiptLineId }) => receiptLineId)).size !==
      input.length
    )
      throw new AppError(
        'HANDLING_UNIT_CONTENT_DUPLICATE',
        'Receipt content is duplicated',
        400,
      );
    const receipts = await tx.receiptLine.findMany({
      where: {
        id: { in: input.map(({ receiptLineId }) => receiptLineId) },
        inboundOrderId: inboundId,
        status: 'CONFIRMED',
        tenantId: context.tenantId,
      },
    });
    if (receipts.length !== input.length)
      throw new AppError(
        'HANDLING_UNIT_RECEIPT_INVALID',
        'Receipt line was not found',
        404,
      );
    return Promise.all(
      input.map(async (item) => {
        const receipt = receipts.find(({ id }) => id === item.receiptLineId)!;
        const quantityOriginal = decimal(
          item.quantityOriginal,
          'quantityOriginal',
        );
        const quantityBase = decimal(item.quantityBase, 'quantityBase');
        if (
          !quantityOriginal
            .mul(receipt.receivedQuantityBase)
            .equals(quantityBase.mul(receipt.receivedQuantityOriginal))
        )
          throw new AppError(
            'HANDLING_UNIT_CONVERSION_INVALID',
            'Content conversion is invalid',
            409,
          );
        const assigned = await tx.handlingUnitContent.aggregate({
          _sum: { quantityBase: true, quantityOriginal: true },
          where: {
            receiptLineId: receipt.id,
            status: 'ACTIVE',
            tenantId: context.tenantId,
          },
        });
        if (
          quantityBase
            .add(assigned._sum.quantityBase ?? 0)
            .greaterThan(
              receipt.acceptedQuantityBase.add(receipt.pendingQuantityBase),
            ) ||
          quantityOriginal
            .add(assigned._sum.quantityOriginal ?? 0)
            .greaterThan(
              receipt.acceptedQuantityOriginal.add(
                receipt.pendingQuantityOriginal,
              ),
            )
        )
          throw new AppError(
            'HANDLING_UNIT_CONTENT_OVERAGE',
            'Content exceeds received quantity',
            409,
          );
        return {
          baseUom: receipt.receivedBaseUom,
          originalUom: receipt.receivedOriginalUom,
          productId: receipt.productId,
          quantityBase,
          quantityOriginal,
          receiptLineId: receipt.id,
        };
      }),
    );
  }

  private async assertMixing(
    tx: Prisma.TransactionClient,
    parent: { id: string; mixedAllowed: boolean } | null,
    addingProducts: readonly string[],
    context: TenantContext,
  ) {
    if (!parent || parent.mixedAllowed) return;
    const existing = await this.huProducts(tx, parent.id, context);
    if (new Set([...existing, ...addingProducts]).size > 1)
      throw new AppError(
        'HANDLING_UNIT_MIXING_DENIED',
        'Parent handling unit does not allow mixed products',
        409,
      );
  }

  private async huProducts(
    tx: Prisma.TransactionClient,
    id: string,
    context: TenantContext,
  ) {
    const own = await tx.handlingUnitContent.findMany({
      select: { productId: true },
      where: {
        handlingUnitId: id,
        status: 'ACTIVE',
        tenantId: context.tenantId,
      },
    });
    const children = await tx.handlingUnit.findMany({
      select: { id: true },
      where: {
        parentHandlingUnitId: id,
        status: 'ACTIVE',
        tenantId: context.tenantId,
      },
    });
    const childContents = children.length
      ? await tx.handlingUnitContent.findMany({
          select: { productId: true },
          where: {
            handlingUnitId: { in: children.map(({ id: childId }) => childId) },
            status: 'ACTIVE',
            tenantId: context.tenantId,
          },
        })
      : [];
    return [
      ...new Set([...own, ...childContents].map(({ productId }) => productId)),
    ];
  }

  private async hu(
    tx: Prisma.TransactionClient,
    id: string,
    context: TenantContext,
  ) {
    const row = await tx.handlingUnit.findFirst({
      where: { id, tenantId: context.tenantId },
    });
    if (!row)
      throw new AppError(
        'HANDLING_UNIT_NOT_FOUND',
        'Handling unit was not found',
        404,
      );
    return row;
  }

  private async labelJob(
    tx: Prisma.TransactionClient,
    unit: { id: string; labelNumber: string },
    originalId: string | null,
    reason: string,
    copies: number,
    context: TenantContext,
    metadata: CommandMetadata,
  ) {
    const id = randomUUID();
    return tx.labelJob.create({
      data: {
        copies,
        createdBy: context.accountId,
        handlingUnitId: unit.id,
        id,
        jobNo: await businessNumber(
          this.prisma,
          'WMS_LABEL_JOB',
          context,
          metadata,
          `label-job:${id}`,
        ),
        labelNumber: unit.labelNumber,
        reason,
        reprintOfJobId: originalId,
        tenantId: context.tenantId,
        updatedBy: context.accountId,
      },
    });
  }

  private uuid(value: string, field: string) {
    if (!isUuid(value))
      throw new AppError('WMS_INPUT_INVALID', `${field} is invalid`, 400);
  }
  private huConflict() {
    return new AppError(
      'HANDLING_UNIT_VERSION_OR_STATE_INVALID',
      'Handling unit changed or is not active',
      409,
      { retryable: true },
    );
  }
  private async record(
    tx: Prisma.TransactionClient,
    id: string,
    type: string,
    version: number,
    event: string,
    context: TenantContext,
    metadata: CommandMetadata,
    payload: Prisma.InputJsonObject,
  ) {
    await Promise.all([
      tx.platformAuditLog.create({
        data: {
          action: event,
          after: payload,
          category: 'BUSINESS_CHANGE',
          correlationId: metadata.correlationId,
          createdBy: context.accountId,
          deviceId: context.deviceId,
          ipAddress: metadata.ipAddress ?? null,
          resourceId: id,
          resourceType: type,
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      }),
      tx.platformOutbox.create({
        data: {
          aggregateId: id,
          aggregateType: type,
          aggregateVersion: version,
          correlationId: metadata.correlationId,
          createdBy: context.accountId,
          eventName: event,
          partitionKey: id,
          payload: { ...payload, tenantId: context.tenantId },
          tenantId: context.tenantId,
          updatedBy: context.accountId,
        },
      }),
    ]);
  }
}
