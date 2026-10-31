export const U64_MAX = 18446744073709551615n;

export type MatchIdValidationResult =
  | { valid: true; value: bigint }
  | { valid: false; error: string };

/**
 * Validates user manual input for SpacetimeDB u64 Match IDs.
 * Handles invalid, negative, zero, non-decimal, or excessively large values safely.
 */
export function validateMatchIdInput(raw: string): MatchIdValidationResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { valid: false, error: "Match ID cannot be empty" };
  }
  // Must be strictly decimal digits (rejects negative sign, fractions, hex, exponential, symbols)
  if (!/^\d+$/.test(trimmed)) {
    return {
      valid: false,
      error: "Match ID must be a positive decimal number",
    };
  }
  let parsed: bigint;
  try {
    parsed = BigInt(trimmed);
  } catch {
    return { valid: false, error: "Invalid Match ID format" };
  }
  if (parsed <= 0n) {
    return { valid: false, error: "Match ID must be greater than zero" };
  }
  if (parsed > U64_MAX) {
    return {
      valid: false,
      error: "Match ID exceeds maximum 64-bit integer value",
    };
  }
  return { valid: true, value: parsed };
}
