/**
 * Utilities for generating and formatting 9-digit alphanumeric tablet pairing codes.
 * Format: XXX-XXX-XXX (e.g. A9K-3M7-X2P)
 */

const CODE_CHARS = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function generateTabletCode(): string {
  let raw = "";
  for (let i = 0; i < 9; i++) {
    const randomIndex = Math.floor(Math.random() * CODE_CHARS.length);
    raw += CODE_CHARS[randomIndex];
  }
  return raw;
}

export function formatTabletCode(input: string): string {
  const clean = normalizeTabletCode(input).slice(0, 9);
  if (clean.length <= 3) return clean;
  if (clean.length <= 6) return `${clean.slice(0, 3)}-${clean.slice(3)}`;
  return `${clean.slice(0, 3)}-${clean.slice(3, 6)}-${clean.slice(6)}`;
}

export function normalizeTabletCode(input: string): string {
  return (input || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}
