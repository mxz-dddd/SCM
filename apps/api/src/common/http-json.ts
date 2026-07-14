export function toHttpJson<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, child) =>
      typeof child === 'bigint' ? child.toString() : child,
    ),
  ) as T;
}
