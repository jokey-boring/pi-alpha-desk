#!/usr/bin/env node
/**
 * 将 dist/（含内置 Node 22）打成 Windows 自解压 exe（7-Zip SFX）。
 *
 * 双击 exe 后：
 *   1. 解压到 exe 同目录下的 pi-alpha-desk-server-<version>\
 *   2. 优先用内置 Node 22 执行 server.js --port <port> --host <host>
 *
 * 用法：
 *   npm run pack:dist-exe
 *   node scripts/pack-dist-exe.mjs --port 9000 --host localhost --fast
 *
 * 前置：已执行 npm run build（dist 含 server.js）；本机已装 7-Zip。
 * 若 dist/node 不存在，会自动下载当前平台 Node 22 并写入。
 */
"use strict";

import { spawnSync } from "node:child_process";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUNDLED_NODE_VERSION,
  ensureBundledNode,
  writeStartScripts,
} from "./bundled-node.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DIST = join(ROOT, "dist");
const CACHE = join(ROOT, ".cache", "dist-exe");
const DEFAULT_PORT = "9000";
const DEFAULT_HOST = "localhost";

function log(message) {
  console.log(`[pack-dist-exe] ${message}`);
}

function fail(message) {
  console.error(`[pack-dist-exe] ${message}`);
  process.exit(1);
}

function readPackageVersion() {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  return String(pkg.version || "0.0.0");
}

function parseArgs(argv) {
  let port = DEFAULT_PORT;
  let host = DEFAULT_HOST;
  let fast = false;
  let sevenZipDir = process.env.SEVEN_ZIP_HOME || "C:\\Program Files\\7-Zip";

  for (let i = 0; i < argv.length; ) {
    const arg = argv[i];
    const takeValue = (flag) => {
      if (arg === flag) {
        const value = argv[i + 1];
        if (!value || value.startsWith("-")) fail(`缺少参数值：${flag}`);
        i += 2;
        return value;
      }
      if (arg.startsWith(`${flag}=`)) {
        i += 1;
        return arg.slice(flag.length + 1);
      }
      return null;
    };

    const asPort = takeValue("--port") || takeValue("-p");
    if (asPort !== null) {
      port = asPort;
      continue;
    }
    const asHost = takeValue("--host") || takeValue("--hostname") || takeValue("-H");
    if (asHost !== null) {
      host = asHost;
      continue;
    }
    const asSeven = takeValue("--7zip-dir");
    if (asSeven !== null) {
      sevenZipDir = asSeven;
      continue;
    }
    if (arg === "--fast") {
      fast = true;
      i += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/pack-dist-exe.mjs [options]

Options:
  --port, -p <n>     启动端口（默认 ${DEFAULT_PORT}）
  --host, -H <name>  监听主机（默认 ${DEFAULT_HOST}）
  --7zip-dir <path>  7-Zip 安装目录
  --fast             更快压缩（-mx=1），体积更大

内置 Node ${BUNDLED_NODE_VERSION}（当前打包平台）；启动脚本也会回退到系统 node。
`);
      process.exit(0);
    }
    fail(`未知参数：${arg}`);
  }

  const portNumber = Number(port);
  if (!Number.isFinite(portNumber) || portNumber <= 0 || portNumber > 65535) {
    fail(`无效端口：${port}`);
  }

  return { port: String(portNumber), host, fast, sevenZipDir };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: "inherit",
    ...options,
  });
  if (result.status !== 0) {
    fail(`命令失败（exit ${result.status}）：${command} ${args.join(" ")}`);
  }
}

function resolveSevenZip(sevenZipDir) {
  const exe = join(sevenZipDir, "7z.exe");
  const sfx = join(sevenZipDir, "7z.sfx");
  if (!existsSync(exe)) fail(`未找到 7z.exe：${exe}（可用 --7zip-dir 指定）`);
  if (!existsSync(sfx)) fail(`未找到 7z.sfx：${sfx}`);
  return { exe, sfx };
}

function writeSfxConfig(configPath, { version, folderName }) {
  const content = `;!@Install@!UTF-8!
Title="pi-alpha-desk server ${version}"
BeginPrompt=
InstallPath=".\\${folderName}"
GUIMode="1"
OverwriteMode="2"
RunProgram="start.cmd"
;!@InstallEnd@!
`;
  writeFileSync(configPath, content, "utf8");
}

function removeJunctionOrPath(targetPath) {
  if (!existsSync(targetPath)) return;
  const rmdir = spawnSync("cmd.exe", ["/c", "rmdir", targetPath], { encoding: "utf8" });
  if (rmdir.status === 0) return;
  rmSync(targetPath, { recursive: true, force: true });
}

function createJunction(linkPath, targetPath) {
  removeJunctionOrPath(linkPath);
  const result = spawnSync("cmd.exe", ["/c", "mklink", "/J", linkPath, targetPath], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    fail(
      `创建目录联接失败：${linkPath} -> ${targetPath}\n${result.stdout || ""}${result.stderr || ""}`,
    );
  }
}

async function concatBinaryFiles(parts, dest) {
  const out = createWriteStream(dest);
  try {
    for (const part of parts) {
      await new Promise((resolvePromise, rejectPromise) => {
        const input = createReadStream(part);
        input.on("error", rejectPromise);
        input.on("end", resolvePromise);
        input.pipe(out, { end: false });
      });
    }
  } catch (error) {
    out.destroy();
    throw error;
  }
  await new Promise((resolvePromise, rejectPromise) => {
    out.on("finish", resolvePromise);
    out.on("error", rejectPromise);
    out.end();
  });
}

async function main() {
  if (process.platform !== "win32") {
    fail("自解压 exe 仅支持在 Windows 上打包");
  }

  const options = parseArgs(process.argv.slice(2));
  const version = readPackageVersion();
  const { exe: sevenZip, sfx } = resolveSevenZip(options.sevenZipDir);

  if (!existsSync(join(DIST, "server.js"))) {
    fail("缺少 dist/server.js，请先执行 npm run build");
  }

  log(`确保 dist 内置 Node ${BUNDLED_NODE_VERSION} …`);
  await ensureBundledNode(DIST, { log });
  writeStartScripts(DIST, {
    layout: "dist",
    port: options.port,
    host: options.host,
  });
  log(`已写入 dist/start.cmd 与 dist/start.sh`);

  mkdirSync(CACHE, { recursive: true });
  mkdirSync(join(ROOT, "release"), { recursive: true });

  const stageDir = join(CACHE, "stage");
  removeJunctionOrPath(join(stageDir, "app"));
  rmSync(stageDir, { recursive: true, force: true });
  mkdirSync(stageDir, { recursive: true });

  createJunction(join(stageDir, "app"), DIST);
  writeStartScripts(stageDir, {
    layout: "sfx",
    port: options.port,
    host: options.host,
  });

  const workDir = join(CACHE, "work");
  spawnSync("cmd.exe", ["/c", "rmdir", "/s", "/q", workDir], { encoding: "utf8" });
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });

  const archivePath = join(workDir, `payload-bundled-${Date.now()}.7z`);
  const configPath = join(workDir, "config.txt");
  const mx = options.fast ? "1" : "5";
  const folderName = `pi-alpha-desk-server-${version}`;
  writeSfxConfig(configPath, { version, folderName });

  log(`压缩 payload（含内置 Node ${BUNDLED_NODE_VERSION}；-mx=${mx}）…`);
  run(sevenZip, ["a", "-t7z", `-mx=${mx}`, "-mmt=on", archivePath, "app", "start.cmd", "start.sh"], {
    cwd: stageDir,
  });

  const outName = `pi-alpha-desk-server-${version}-sfx.exe`;
  const outPath = join(ROOT, "release", outName);
  if (existsSync(outPath)) rmSync(outPath, { force: true });

  log(`拼接 SFX → ${outPath}`);
  await concatBinaryFiles([sfx, configPath, archivePath], outPath);
  if (!existsSync(outPath) || statSync(outPath).size < 1024 * 1024) {
    fail(`SFX 产物无效：${outPath}`);
  }

  rmSync(workDir, { recursive: true, force: true });
  removeJunctionOrPath(join(stageDir, "app"));
  rmSync(stageDir, { recursive: true, force: true });

  const sizeMb = (statSync(outPath).size / (1024 * 1024)).toFixed(1);
  log(`完成：${outPath} (${sizeMb} MB)`);
  log(`启动：内置 Node ${BUNDLED_NODE_VERSION} → server.js --port ${options.port} --host ${options.host}`);
  log(`解压到：exe 同目录\\${folderName}\\`);
  log(`本机也可：dist\\start.cmd 或 dist/start.sh`);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
