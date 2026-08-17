#!/usr/bin/env node
/** 从仓库根启动 dist/server.js，透传 CLI 参数（--port / --host 等） */
"use strict";

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const distServer = join(root, "dist", "server.js");

if (!existsSync(distServer)) {
  console.error("dist/server.js 不存在，请先执行 npm run build");
  process.exit(1);
}

const rawArgs = process.argv.slice(2);
const { values } = parseArgs({
  args: rawArgs,
  options: {
    port: { type: "string", short: "p" },
    host: { type: "string" },
    hostname: { type: "string", short: "H" },
    lan: { type: "boolean" },
  },
  strict: false,
  allowPositionals: true,
});

// --lan 展开为 host，再交给 server.js
const forwardArgs = rawArgs.filter((arg) => arg !== "--lan");
if (values.lan && !values.host && !values.hostname) {
  forwardArgs.push("--host", "0.0.0.0");
}

const child = spawn(process.execPath, [distServer, ...forwardArgs], {
  cwd: join(root, "dist"),
  env: process.env,
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 0));
