#!/usr/bin/env node
/**
 * 生产构建入口：
 *   1. next build --webpack（带本机扛得住的堆上限）
 *   2. pack-dist 组装独立 dist/（.next + 生产依赖 + server.js）
 *
 * 直接把 --max-old-space-size 拉到 8192 会在 16GB 机器上空闲内存不足时
 * 被系统立刻杀掉（Git Bash 表现为 exit 127）。默认 5632MB，并配合
 * next.config.ts 里的 webpack 内存优化。
 *
 * 若 .next 已是有效生产构建，可设 SKIP_NEXT_BUILD=1 只组装 dist。
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const nextBin = join(ROOT, "node_modules", "next", "dist", "bin", "next");
const packDist = join(ROOT, "scripts", "pack-dist.mjs");
const heapMb = process.env.NODE_MAX_OLD_SPACE_SIZE || "5632";
const skipNextBuild = process.env.SKIP_NEXT_BUILD === "1";

function run(file, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file, ...args], {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...process.env, ...extraEnv },
      windowsHide: true,
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`进程被信号终止: ${signal}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`进程退出码 ${code ?? 1}`));
        return;
      }
      resolve();
    });
  });
}

if (!skipNextBuild && !existsSync(nextBin)) {
  console.error("未找到 Next.js CLI，请先执行 npm install。");
  process.exit(1);
}

const extraNodeOptions = process.env.NODE_OPTIONS?.trim() ?? "";
const nodeOptions = [`--max-old-space-size=${heapMb}`, extraNodeOptions]
  .filter(Boolean)
  .join(" ");

try {
  if (skipNextBuild) {
    console.log("[build] SKIP_NEXT_BUILD=1，跳过 next build，只组装 dist/");
  } else {
    await run(nextBin, ["build", "--webpack"], { NODE_OPTIONS: nodeOptions });
  }
  await run(packDist, []);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
