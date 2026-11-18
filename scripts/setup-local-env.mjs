#!/usr/bin/env node
/**
 * Prepares .env.local for local development without any hard-coded secrets:
 *  - generates strong random values for required secrets that are missing
 *  - removes duplicate keys (keeps the first occurrence)
 * Existing values are never overwritten, and no secret is ever printed.
 *
 * Usage: node scripts/setup-local-env.mjs
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.cwd(), ".env.local");

// Secrets the backend needs; each is generated in the format envValidator expects.
const GENERATED = {
  JWT_SECRET: () => randomBytes(48).toString("base64url"),
  WEBHOOK_ENCRYPTION_KEY: () => randomBytes(32).toString("hex"), // 32-byte hex key
};

const original = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
const seen = new Set();
const kept = [];
let removedDuplicates = 0;

for (const line of original.split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
  if (match) {
    if (seen.has(match[1])) {
      removedDuplicates++;
      continue;
    }
    seen.add(match[1]);
  }
  kept.push(line);
}

while (kept.length && kept[kept.length - 1].trim() === "") kept.pop();

const added = [];
for (const [key, generate] of Object.entries(GENERATED)) {
  if (!seen.has(key) && !process.env[key]) {
    kept.push(`${key}=${generate()}`);
    added.push(key);
  }
}

if (added.length || removedDuplicates) {
  writeFileSync(envPath, kept.join("\n") + "\n", { mode: 0o600 });
}

console.log(
  `[setup-local-env] ${added.length ? `generated: ${added.join(", ")}` : "no secrets missing"}` +
    (removedDuplicates ? `; removed ${removedDuplicates} duplicate line(s)` : "")
);
