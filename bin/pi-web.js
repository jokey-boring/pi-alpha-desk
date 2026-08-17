#!/usr/bin/env node
"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawn } = require("child_process");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseLaunchOptions } = require("./pi-web-options");

const pkgDir = path.join(__dirname, "..");
const distServer = path.join(pkgDir, "dist", "server.js");
const nextDir = path.join(pkgDir, ".next");

const { port, hostname, openBrowser } = parseLaunchOptions();

if (hostname !== "127.0.0.1" && hostname !== "localhost" && hostname !== "::1") {
  if (process.env.PI_WEB_PASSWORD) {
    console.warn("Pi Web is exposed beyond loopback. HTTP Basic Auth does not encrypt credentials; use HTTPS or a trusted VPN.");
  } else {
    console.warn("Pi Web is exposed beyond loopback without authentication. Use only on a trusted network.");
  }
}

let browserOpened = false;
const url = `http://${hostname}:${port}`;

function attachBrowserOpener(child) {
  if (!child.stdout) return;
  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    process.stdout.write(text);
    if (openBrowser && !browserOpened && /Ready|started server/i.test(text)) {
      browserOpened = true;
      const isWindows = process.platform === "win32";
      const isMac = process.platform === "darwin";
      const openCmd = isWindows ? "start" : isMac ? "open" : "xdg-open";
      const opener = spawn(openCmd, [url], {
        shell: isWindows,
        stdio: "ignore",
        detached: true,
      });
      opener.on("error", (error) => {
        console.warn(`Could not open browser automatically: ${error.message}`);
      });
      opener.unref();
    }
  });
}

// 优先使用独立 dist 包（npm run build 产物）
if (fs.existsSync(distServer)) {
  const child = spawn(process.execPath, [distServer], {
    cwd: path.join(pkgDir, "dist"),
    stdio: ["inherit", "pipe", "inherit"],
    env: {
      ...process.env,
      PORT: port,
      HOSTNAME: hostname,
      PI_WEB_HOSTNAME: hostname,
    },
  });
  attachBrowserOpener(child);
  child.on("exit", (code) => process.exit(code ?? 0));
} else {
  // 回退：直接 next start（需本地已有 .next 与 node_modules）
  if (!fs.existsSync(nextDir)) {
    console.error("Build artifacts not found. Run npm run build first.");
    process.exit(1);
  }

  let nextBin;
  try {
    nextBin = require.resolve("next/dist/bin/next", { paths: [pkgDir] });
  } catch {
    try {
      const nextPkg = require.resolve("next/package.json", { paths: [pkgDir] });
      nextBin = path.join(path.dirname(nextPkg), "dist", "bin", "next");
    } catch {
      nextBin = path.join(pkgDir, "node_modules", "next", "dist", "bin", "next");
    }
  }

  const child = spawn(process.execPath, [nextBin, "start", "-p", port, "-H", hostname], {
    cwd: pkgDir,
    stdio: ["inherit", "pipe", "inherit"],
    env: { ...process.env, PI_WEB_HOSTNAME: hostname },
  });
  attachBrowserOpener(child);
  child.on("exit", (code) => process.exit(code ?? 0));
}
