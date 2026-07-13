export const DATA_SCOPE_DIMENSIONS = [
  'organizationId',
  'warehouseId',
  'ownerId',
  'partnerId',
  'createdBy',
  'region',
] as const;

export type DataScopeOperator = 'EQ' | 'IN';

export interface DataScopeCondition {
  readonly field: string;
  readonly operator: DataScopeOperator;
  readonly value: string | readonly string[];
}

export interface DataScopeExpression {
  readonly conditions: readonly DataScopeCondition[];
  readonly match: 'ALL' | 'ANY';
}

export interface DataScopeValidation {
  readonly expression?: DataScopeExpression;
  readonly errors: readonly string[];
  readonly valid: boolean;
}

function isAllowedField(field: string): boolean {
  return (
    DATA_SCOPE_DIMENSIONS.includes(
      field as (typeof DATA_SCOPE_DIMENSIONS)[number],
    ) || /^custom\.[A-Za-z][A-Za-z0-9_.-]{0,99}$/.test(field)
  );
}

export function validateDataScopeExpression(
  candidate: unknown,
): DataScopeValidation {
  const errors: string[] = [];
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return { errors: ['Expression must be an object'], valid: false };
  }
  const object = candidate as Record<string, unknown>;
  if (object.match !== 'ALL' && object.match !== 'ANY') {
    errors.push('match must be ALL or ANY');
  }
  if (!Array.isArray(object.conditions) || object.conditions.length === 0) {
    errors.push('conditions must be a non-empty array');
  }
  const conditions: DataScopeCondition[] = [];
  for (const [index, raw] of Array.isArray(object.conditions)
    ? object.conditions.entries()
    : []) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push(`conditions[${index}] must be an object`);
      continue;
    }
    const condition = raw as Record<string, unknown>;
    if (
      typeof condition.field !== 'string' ||
      !isAllowedField(condition.field)
    ) {
      errors.push(`conditions[${index}].field is not allowed`);
      continue;
    }
    if (condition.operator !== 'EQ' && condition.operator !== 'IN') {
      errors.push(`conditions[${index}].operator is not allowed`);
      continue;
    }
    if (
      condition.operator === 'EQ' &&
      (typeof condition.value !== 'string' || !condition.value)
    ) {
      errors.push(`conditions[${index}].value must be a non-empty string`);
      continue;
    }
    if (
      condition.operator === 'IN' &&
      (!Array.isArray(condition.value) ||
        condition.value.length === 0 ||
        condition.value.some((value) => typeof value !== 'string' || !value))
    ) {
      errors.push(
        `conditions[${index}].value must be a non-empty string array`,
      );
      continue;
    }
    conditions.push({
      field: condition.field,
      operator: condition.operator,
      value: condition.value as string | readonly string[],
    });
  }
  if (errors.length > 0) return { errors, valid: false };
  return {
    errors: [],
    expression: { conditions, match: object.match as 'ALL' | 'ANY' },
    valid: true,
  };
}

function readAttribute(
  attributes: Readonly<Record<string, unknown>>,
  field: string,
): unknown {
  if (!field.startsWith('custom.')) return attributes[field];
  return field
    .slice('custom.'.length)
    .split('.')
    .reduce<unknown>(
      (value, segment) =>
        value && typeof value === 'object' && !Array.isArray(value)
          ? (value as Record<string, unknown>)[segment]
          : undefined,
      attributes.custom,
    );
}

export function matchesDataScope(
  expression: DataScopeExpression,
  attributes: Readonly<Record<string, unknown>>,
): boolean {
  const results = expression.conditions.map((condition) => {
    const actual = readAttribute(attributes, condition.field);
    return condition.operator === 'EQ'
      ? actual === condition.value
      : (condition.value as readonly string[]).includes(String(actual));
  });
  return expression.match === 'ALL'
    ? results.every(Boolean)
    : results.some(Boolean);
}

export function dataScopeCacheKey(input: {
  readonly accountId: string;
  readonly permissionVersion: number;
  readonly resource: string;
  readonly tenantId: string;
}): string {
  return `${input.tenantId}:${input.accountId}:${input.permissionVersion}:${input.resource}`;
}

export function injectTenantAndDataScope(
  tenantId: string,
  baseWhere: Readonly<Record<string, unknown>>,
  scopeWhere: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return { AND: [{ tenantId }, baseWhere, scopeWhere] };
}
