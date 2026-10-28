import esbuild from "esbuild";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.resolve(__dirname, "dist");

console.log("🛠️ Building @mathsy/meet-sdk...");

// 1. Ensure dist directory exists and is clean
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true, force: true });
}
fs.mkdirSync(distDir, { recursive: true });

const entryPoints = [
  { in: path.resolve(__dirname, "src/index.ts"), out: "index" },
  { in: path.resolve(__dirname, "src/server.ts"), out: "server" },
  { in: path.resolve(__dirname, "src/browser.ts"), out: "browser" },
  { in: path.resolve(__dirname, "src/react.tsx"), out: "react" },
];

const sharedConfig = {
  entryPoints,
  bundle: true,
  sourcemap: false,
  target: "es2022",
  external: ["react", "react-dom", "node:*"],
};

// 2. Build ESM (.mjs)
console.log("📦 Bundling ESM (.mjs)...");
await esbuild.build({
  ...sharedConfig,
  format: "esm",
  outdir: distDir,
  outExtension: { ".js": ".mjs" },
});

// 3. Build CommonJS (.cjs)
console.log("📦 Bundling CommonJS (.cjs)...");
await esbuild.build({
  ...sharedConfig,
  format: "cjs",
  outdir: distDir,
  outExtension: { ".js": ".cjs" },
});

// 4. Generate TypeScript declarations (.d.ts)
console.log("📝 Emitting TypeScript declarations (.d.ts)...");
try {
  execSync("npx tsc -p tsconfig.json", {
    cwd: __dirname,
    stdio: "inherit",
  });
} catch (e) {
  console.error("Failed to emit TypeScript declarations:", e);
  process.exit(1);
}

console.log("✅ SDK build complete in sdk/dist/!");
