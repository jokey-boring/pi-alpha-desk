#!/usr/bin/env node
/**
 * 编译 dist 启动器：
 *   - Windows: dist/pi-alpha-desk.exe（按系统选择 start.cmd / start.sh）
 *   - 另写 Unix 入口脚本 dist/pi-alpha-desk（直接执行 start.sh）
 *
 * 用法：node scripts/build-dist-launcher.mjs [outdir]
 * 默认 outdir = <repo>/dist
 */
"use strict";

import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SRC = join(__dirname, "dist-launcher", "Program.cs");
const DEFAULT_OUT = join(ROOT, "dist");

const CSC_CANDIDATES = [
  "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe",
  "C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe",
];

function log(msg) {
  console.log(`[build-dist-launcher] ${msg}`);
}

function fail(msg) {
  console.error(`[build-dist-launcher] ${msg}`);
  process.exit(1);
}

function findCsc() {
  for (const candidate of CSC_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function writeUnixLauncher(outDir) {
  const script = `#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
if [[ ! -f "$ROOT/start.sh" ]]; then
  echo "[pi-alpha-desk] start.sh not found in $ROOT" >&2
  exit 1
fi
exec bash "$ROOT/start.sh"
`;
  const path = join(outDir, "pi-alpha-desk");
  writeFileSync(path, script, "utf8");
  try {
    chmodSync(path, 0o755);
  } catch {
    // Windows 上 chmod 可能无效，无妨
  }
  log(`已写入 Unix 入口：${path}`);
}

function buildWindowsExe(outDir) {
  if (process.platform !== "win32") {
    log("非 Windows，跳过 .exe 编译");
    return null;
  }
  const csc = findCsc();
  if (!csc) fail("未找到 csc.exe（需要 .NET Framework 4.x）");
  if (!existsSync(SRC)) fail(`缺少源码：${SRC}`);

  mkdirSync(outDir, { recursive: true });
  const outExe = join(outDir, "pi-alpha-desk.exe");
  // winexe：双击不额外弹黑色空控制台；start.cmd 自己会开窗口
  const args = [
    "/nologo",
    "/optimize+",
    "/target:winexe",
    "/r:System.Windows.Forms.dll",
    `/out:${outExe}`,
    SRC,
  ];
  log(`编译 ${outExe}`);
  const result = spawnSync(csc, args, { encoding: "utf8" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0 || !existsSync(outExe)) {
    fail(`csc 编译失败（exit ${result.status}）`);
  }
  log(`完成：${outExe}`);
  return outExe;
}

function main() {
  const outDir = resolve(process.argv[2] || DEFAULT_OUT);
  mkdirSync(outDir, { recursive: true });
  buildWindowsExe(outDir);
  writeUnixLauncher(outDir);
  log("说明：.exe 仅 Windows 可用；macOS/Linux 请运行 ./pi-alpha-desk 或 ./start.sh");
}

main();
