const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const NONNEGATIVE_DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export type DecimalString = string & {
  readonly __decimalString: unique symbol;
};

export interface Money {
  readonly amount: DecimalString;
  readonly currency: string;
}

export interface DualUnitQuantity {
  readonly base: {
    readonly quantity: DecimalString;
    readonly uom: string;
  };
  readonly original: {
    readonly quantity: DecimalString;
    readonly uom: string;
  };
  readonly packageSpecVersionId: string;
}

export interface ControlledExtensionFields {
  readonly schemaId: string;
  readonly schemaVersion: number;
  readonly values: Readonly<Record<string, unknown>>;
}

export const DATA_MODEL_CONVENTIONS = [
  'Money uses decimal amount and ISO currency',
  'Quantity retains original and base units',
  'Extensions reference an immutable schema version',
] as const;

function decimal(value: string, allowNegative: boolean): DecimalString {
  const pattern = allowNegative ? DECIMAL_PATTERN : NONNEGATIVE_DECIMAL_PATTERN;
  if (!pattern.test(value)) {
    throw new Error('Decimal values must use a canonical base-10 string');
  }
  return value as DecimalString;
}

function nonBlank(value: string, field: string): string {
  if (value.trim().length === 0) {
    throw new Error(`${field} must not be blank`);
  }
  return value;
}

export function createMoney(amount: string, currency: string): Money {
  if (!CURRENCY_PATTERN.test(currency)) {
    throw new Error('Currency must be a three-letter uppercase code');
  }
  return Object.freeze({ amount: decimal(amount, true), currency });
}

export function createDualUnitQuantity(input: {
  baseQuantity: string;
  baseUom: string;
  originalQuantity: string;
  originalUom: string;
  packageSpecVersionId: string;
}): DualUnitQuantity {
  return Object.freeze({
    base: Object.freeze({
      quantity: decimal(input.baseQuantity, false),
      uom: nonBlank(input.baseUom, 'baseUom'),
    }),
    original: Object.freeze({
      quantity: decimal(input.originalQuantity, false),
      uom: nonBlank(input.originalUom, 'originalUom'),
    }),
    packageSpecVersionId: nonBlank(
      input.packageSpecVersionId,
      'packageSpecVersionId',
    ),
  });
}

export function createControlledExtensionFields(input: {
  schemaId: string;
  schemaVersion: number;
  values: Readonly<Record<string, unknown>>;
}): ControlledExtensionFields {
  if (!Number.isInteger(input.schemaVersion) || input.schemaVersion < 1) {
    throw new Error('schemaVersion must be a positive integer');
  }
  if (
    input.values === null ||
    Array.isArray(input.values) ||
    Object.getPrototypeOf(input.values) !== Object.prototype
  ) {
    throw new Error('Extension values must be a plain object');
  }
  return Object.freeze({
    schemaId: nonBlank(input.schemaId, 'schemaId'),
    schemaVersion: input.schemaVersion,
    values: Object.freeze({ ...input.values }),
  });
}
