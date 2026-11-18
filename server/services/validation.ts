const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * True when the value is a canonical UUID string.
 * Route params that map to Postgres `uuid` columns must pass this check before being
 * used in a query, otherwise Postgres raises `invalid input syntax for type uuid` (HTTP 500).
 */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/**
 * Parses a non-negative integer from a number or a numeric string ("1" -> 1).
 * Returns null for anything else (floats, NaN, negative numbers, non-numeric strings, objects).
 */
export function parseNonNegativeInt(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}
