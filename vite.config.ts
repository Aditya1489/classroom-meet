import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import type { ServerResponse } from "http";
import type { Plugin } from "vite";

/**
 * Search-engine files built from VITE_PUBLIC_SITE_URL (the live address, e.g. https://meet.example.com):
 * canonical link, absolute og:url / og:image, robots.txt and sitemap.xml. Without it, only robots.txt is made.
 * Private pages (classes, embeds, dashboards) are kept out of search by noindex headers in vercel.json.
 */
function seoFiles(siteUrl: string): Plugin {
  const base = siteUrl.replace(/\/+$/, "");
  return {
    name: "mathsy-seo-files",
    transformIndexHtml(html) {
      if (!base) return html;
      return html
        .replace(/content="\/og-image\.png"/g, `content="${base}/og-image.png"`)
        .replace("</title>", `</title>\n    <link rel="canonical" href="${base}/" />\n    <meta property="og:url" content="${base}/" />`);
    },
    generateBundle() {
      // Private pages are NOT blocked here: a blocked page can't be crawled, so Google would never see its
      // "noindex" header (vercel.json) and could still list the bare link. They stay crawlable and noindex.
      const robots = ["User-agent: *", "Allow: /"];
      if (base) robots.push("", `Sitemap: ${base}/sitemap.xml`);
      this.emitFile({ type: "asset", fileName: "robots.txt", source: robots.join("\n") + "\n" });
      if (base) {
        const today = new Date().toISOString().slice(0, 10);
        this.emitFile({
          type: "asset",
          fileName: "sitemap.xml",
          source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${base}/</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>\n</urlset>\n`,
        });
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  // Read .env / .env.local so dev ports and proxy targets are configuration, not code.
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), "") };

  const devPort = Number(env.VITE_DEV_PORT || 5174);
  const backendPort = env.PORT || "5001"; // same default as server/index.ts
  const apiTarget = env.DEV_API_PROXY_TARGET || `http://127.0.0.1:${backendPort}`;
  const sfuTarget = env.VITE_MEDIASOUP_SERVER_URL || env.MEDIASOUP_SERVER_URL || "";
  // Origin presented to the SFU when proxying /socket.io. The SFU allow-lists specific dev origins, so a
  // second dev server on another port can set DEV_SFU_ORIGIN to an allow-listed origin.
  const devOrigin = env.DEV_SFU_ORIGIN || `http://localhost:${devPort}`;

  // While the backend restarts, answer API calls with a clear 503 instead of stack traces.
  let lastProxyWarning = 0;
  const backendUnavailable = (_err: Error, _req: unknown, res: ServerResponse | unknown) => {
    const now = Date.now();
    if (now - lastProxyWarning > 5000) {
      lastProxyWarning = now;
      console.warn(`[vite] backend at ${apiTarget} is not reachable yet (starting or restarting)`);
    }
    const r = res as ServerResponse;
    if (r && typeof r.writeHead === "function" && !r.headersSent) {
      r.writeHead(503, { "Content-Type": "application/json", "Retry-After": "2" });
      r.end(JSON.stringify({ error: "Backend is starting, please retry.", code: "BACKEND_UNAVAILABLE" }));
    }
  };

  return {
    plugins: [react(), seoFiles(env.VITE_PUBLIC_SITE_URL || "")],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      port: devPort,
      host: true,
      allowedHosts: true,
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on("error", backendUnavailable);
          },
        },
        ...(sfuTarget
          ? {
              "/socket.io": {
                target: sfuTarget,
                ws: true,
                changeOrigin: true,
                secure: false,
                headers: { Origin: devOrigin },
                configure: (proxy) => {
                  proxy.on("proxyReqWs", (proxyReq) => {
                    proxyReq.setHeader("Origin", devOrigin);
                  });
                  proxy.on("proxyReq", (proxyReq) => {
                    proxyReq.setHeader("Origin", devOrigin);
                  });
                },
              },
            }
          : {}),
      },
    },
  };
});
