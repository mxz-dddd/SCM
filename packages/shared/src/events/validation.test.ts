import { describe, expect, it } from 'vitest';
import {
  isFulfillmentReleasedV2Payload,
  isShipmentRequestedV2Payload,
} from './validation';

const id = (suffix: string) =>
  `10000000-0000-4000-8000-${suffix.padStart(12, '0')}`;

describe('V2 orchestration event payload validation', () => {
  it('accepts self-contained fulfillment payloads and rejects missing base quantities', () => {
    const payload = {
      allocationConstraints: {},
      customer: { id: id('1'), snapshot: { code: 'C1' } },
      cutoffAt: '2026-07-17T00:00:00.000Z',
      destination: { snapshot: { line1: 'Shanghai' } },
      fulfillmentId: id('2'),
      fulfillmentNo: 'FUL-1',
      fulfillmentVersion: 2,
      lines: [
        {
          baseQuantity: '6',
          baseUom: 'EA',
          lineId: id('3'),
          originalQuantity: '1',
          originalUom: 'BOX',
          product: { id: id('4'), snapshot: { sku: 'SKU-1' } },
        },
      ],
      orderId: id('5'),
      orderNo: 'ORD-1',
      orderVersion: 2,
      owner: { id: id('6'), snapshot: {} },
      sourceRef: id('2'),
      sourceVersion: 2,
      warehouse: { id: id('7'), snapshot: {} },
    };
    expect(isFulfillmentReleasedV2Payload(payload)).toBe(true);
    expect(
      isFulfillmentReleasedV2Payload({
        ...payload,
        lines: [{ ...payload.lines[0], baseQuantity: undefined }],
      }),
    ).toBe(false);
  });

  it('requires complete transport windows, measurements and responsibility snapshots', () => {
    const quantity = {
      baseQuantity: '1',
      baseUom: 'KG',
      originalQuantity: '1',
      originalUom: 'KG',
    };
    const payload = {
      chargeResponsibilitySnapshot: { payer: 'CUSTOMER' },
      deliveryWindow: {
        from: '2026-07-17T00:00:00.000Z',
        until: '2026-07-18T00:00:00.000Z',
      },
      destination: { snapshot: { countryCode: 'CN', line1: 'B' } },
      orderId: id('1'),
      orderNo: 'ORD-1',
      orderVersion: 2,
      origin: { snapshot: { countryCode: 'CN', line1: 'A' } },
      packageSnapshot: { type: 'ORDER' },
      pickupWindow: {
        from: '2026-07-16T00:00:00.000Z',
        until: '2026-07-16T12:00:00.000Z',
      },
      priority: 10,
      shipmentRequestId: id('2'),
      shipmentRequestNo: 'SHP-1',
      shipmentRequestVersion: 2,
      sourceRef: id('2'),
      sourceVersion: 2,
      type: 'SALES',
      vehicleRequirementSnapshot: {},
      volume: { ...quantity, baseUom: 'M3', originalUom: 'M3' },
      weight: quantity,
    };
    expect(isShipmentRequestedV2Payload(payload)).toBe(true);
    expect(
      isShipmentRequestedV2Payload({ ...payload, pickupWindow: undefined }),
    ).toBe(false);
  });
});
