import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { join } from "path";

const { version } = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf8")) as { version: string };
let piVersion = "unknown";
try {
  const piPkgPath = join(__dirname, "node_modules/@earendil-works/pi-coding-agent/package.json");
  piVersion = (JSON.parse(readFileSync(piPkgPath, "utf8")) as { version: string }).version;
} catch { /* package not found, use default */ }

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-tui",
    "@juicesharp/rpiv-ask-user-question",
    "@narumitw/pi-goal",
    "@e965/xlsx",
    "pi-mcp-adapter",
    "pi-subagents",
    "pi-web-access",
    "word-extractor",
    "unpdf",
    "undici",
    "@napi-rs/canvas",
    "jszip",
    "pdfjs-dist",
  ],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // 允许任意页面用 iframe 嵌入，不限制域名。不用 X-Frame-Options：
          // 该头没有“允许所有来源”的标准值，会盖过 CSP 的 frame-ancestors *。
          { key: "Content-Security-Policy", value: "frame-ancestors *; base-uri 'self'; object-src 'none'" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      {
        source: "/",
        headers: [
          { key: "Cache-Control", value: "private, no-cache, max-age=0, must-revalidate" },
        ],
      },
    ];
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_PI_VERSION: piVersion,
  },
  productionBrowserSourceMaps: false,
  enablePrerenderSourceMaps: false,
  experimental: {
    // 自定义 webpack() 会关闭默认 worker；显式打开，避免编译挤在主进程里把 4GB 堆打满。
    webpackBuildWorker: true,
    webpackMemoryOptimizations: true,
    serverSourceMaps: false,
    cpus: 1,
  },
  webpack(config, { isServer, dev }) {
    if (isServer) {
      // Instrumentation imports Undici before route compilation. Keep it as a
      // Node runtime dependency so Webpack does not traverse Undici's
      // `node:console` mock helpers and fail otherwise-valid API routes.
      config.externals.push("undici");
    }
    if (dev === false) {
      // 生产构建串行编译并关掉 webpack 缓存，降低 16GB 机器上的峰值内存。
      config.parallelism = 1;
      config.cache = false;
    }
    return config;
  },
};

export default nextConfig;
