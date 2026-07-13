import { describe, expect, it } from 'vitest';
import {
  createControlledExtensionFields,
  createDualUnitQuantity,
  createMoney,
} from './value-objects';

describe('persistence value objects', () => {
  it('creates Money without converting decimal text to a float', () => {
    expect(createMoney('12.340000', 'CNY')).toEqual({
      amount: '12.340000',
      currency: 'CNY',
    });
  });

  it('rejects malformed Money values and currencies', () => {
    expect(() => createMoney('12e3', 'CNY')).toThrow('canonical base-10');
    expect(() => createMoney('12.30', 'cny')).toThrow('three-letter uppercase');
  });

  it('retains original/base quantities and the package version', () => {
    expect(
      createDualUnitQuantity({
        baseQuantity: '120',
        baseUom: 'EA',
        originalQuantity: '12',
        originalUom: 'BOX',
        packageSpecVersionId: 'pkg-version-1',
      }),
    ).toEqual({
      base: { quantity: '120', uom: 'EA' },
      original: { quantity: '12', uom: 'BOX' },
      packageSpecVersionId: 'pkg-version-1',
    });
  });

  it('rejects negative quantities', () => {
    expect(() =>
      createDualUnitQuantity({
        baseQuantity: '-1',
        baseUom: 'EA',
        originalQuantity: '1',
        originalUom: 'EA',
        packageSpecVersionId: 'pkg-version-1',
      }),
    ).toThrow('canonical base-10');
  });

  it('requires controlled extension schema metadata and a plain object', () => {
    expect(
      createControlledExtensionFields({
        schemaId: 'oms.order-extra',
        schemaVersion: 2,
        values: { source: 'portal' },
      }),
    ).toEqual({
      schemaId: 'oms.order-extra',
      schemaVersion: 2,
      values: { source: 'portal' },
    });

    expect(() =>
      createControlledExtensionFields({
        schemaId: 'oms.order-extra',
        schemaVersion: 0,
        values: {},
      }),
    ).toThrow('positive integer');
  });
});
