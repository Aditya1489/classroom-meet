#!/usr/bin/env node
/**
 * Waits until the backend health check responds, so the frontend dev server (and any open
 * meeting tabs it serves) never talks to a backend that is still starting up.
 * The URL comes from the same environment the server uses: BACKEND_HEALTH_URL, or PORT.
 */
import dotenv from "dotenv";

dotenv.config({ path: [".env.local", ".env"], quiet: true });

const port = process.env.PORT || "5001"; // same default as server/index.ts
const url = process.env.BACKEND_HEALTH_URL || `http://127.0.0.1:${port}/api/health`;
const timeoutMs = Number(process.env.BACKEND_WAIT_TIMEOUT_MS || 60000);
const started = Date.now();

process.stdout.write(`[wait-for-backend] waiting for ${url} `);

while (true) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      console.log(`- ready after ${((Date.now() - started) / 1000).toFixed(1)}s`);
      process.exit(0);
    }
  } catch {
    // backend not listening yet
  }
  if (Date.now() - started > timeoutMs) {
    console.error(`\n[wait-for-backend] backend not healthy after ${timeoutMs / 1000}s; starting frontend anyway`);
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 500));
}
