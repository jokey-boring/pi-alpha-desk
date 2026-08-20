#!/usr/bin/env node
/**
 * 为 dist/ 准备内置 Node 22，并生成跨平台启动脚本。
 * 优先使用 dist/node 内的运行时；无 node_modules 时自动 npm install。
 * npm 源可通过 PI_NPM_REGISTRY / NPM_REGISTRY / npm-registry.txt / .npmrc 配置。
 */
"use strict";

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

export const BUNDLED_NODE_VERSION = "22.19.0";
export const DEFAULT_PORT = "9000";
export const DEFAULT_HOST = "localhost";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CACHE = join(ROOT, ".cache", "dist-exe");

function platformArchive() {
  const version = BUNDLED_NODE_VERSION;
  if (process.platform === "win32") {
    const folder = `node-v${version}-win-x64`;
    return {
      folder,
      fileName: `${folder}.zip`,
      url: `https://nodejs.org/dist/v${version}/${folder}.zip`,
      nodeRelative: "node.exe",
    };
  }
  if (process.platform === "darwin") {
    const arch = process.arch === "arm64" ? "darwin-arm64" : "darwin-x64";
    const folder = `node-v${version}-${arch}`;
    return {
      folder,
      fileName: `${folder}.tar.gz`,
      url: `https://nodejs.org/dist/v${version}/${folder}.tar.gz`,
      nodeRelative: join("bin", "node"),
    };
  }
  const arch = process.arch === "arm64" ? "linux-arm64" : "linux-x64";
  const folder = `node-v${version}-${arch}`;
  return {
    folder,
    fileName: `${folder}.tar.xz`,
    url: `https://nodejs.org/dist/v${version}/${folder}.tar.xz`,
    nodeRelative: join("bin", "node"),
  };
}

async function download(url, dest) {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`下载失败 HTTP ${response.status}：${url}`);
  }
  await pipeline(response.body, createWriteStream(dest));
}

function extractArchive(archivePath, outDir) {
  mkdirSync(outDir, { recursive: true });
  if (process.platform === "win32") {
    const sevenZip = process.env.SEVEN_ZIP_HOME
      ? join(process.env.SEVEN_ZIP_HOME, "7z.exe")
      : "C:\\Program Files\\7-Zip\\7z.exe";
    if (!existsSync(sevenZip)) {
      throw new Error(`解压需要 7-Zip：未找到 ${sevenZip}`);
    }
    const result = spawnSync(sevenZip, ["x", archivePath, `-o${outDir}`, "-y"], {
      encoding: "utf8",
      stdio: "inherit",
    });
    if (result.status !== 0) throw new Error(`7z 解压失败：${archivePath}`);
    return;
  }
  const result = spawnSync(
    "tar",
    archivePath.endsWith(".tar.xz")
      ? ["-xJf", archivePath, "-C", outDir]
      : ["-xzf", archivePath, "-C", outDir],
    { encoding: "utf8", stdio: "inherit" },
  );
  if (result.status !== 0) throw new Error(`tar 解压失败：${archivePath}`);
}

/**
 * 将当前平台的 Node 22 安装到 destRoot/node/
 * @returns {Promise<string>} node 可执行文件绝对路径
 */
export async function ensureBundledNode(destRoot, { log = console.log } = {}) {
  const meta = platformArchive();
  const nodeDir = join(destRoot, "node");
  const nodeExe = join(nodeDir, meta.nodeRelative);
  if (existsSync(nodeExe)) {
    log(`[bundled-node] 复用已有 ${nodeExe}`);
    return nodeExe;
  }

  mkdirSync(CACHE, { recursive: true });
  const archivePath = join(CACHE, meta.fileName);
  if (!existsSync(archivePath)) {
    log(`[bundled-node] 下载 Node ${BUNDLED_NODE_VERSION} …`);
    await download(meta.url, archivePath);
  } else {
    log(`[bundled-node] 复用缓存 ${archivePath}`);
  }

  const extractRoot = join(CACHE, "extract");
  rmSync(extractRoot, { recursive: true, force: true });
  mkdirSync(extractRoot, { recursive: true });
  log(`[bundled-node] 解压到临时目录 …`);
  extractArchive(archivePath, extractRoot);

  const extracted = join(extractRoot, meta.folder);
  if (!existsSync(join(extracted, meta.nodeRelative))) {
    throw new Error(`解压后未找到 node：${join(extracted, meta.nodeRelative)}`);
  }

  rmSync(nodeDir, { recursive: true, force: true });
  renameSync(extracted, nodeDir);
  rmSync(extractRoot, { recursive: true, force: true });

  if (process.platform !== "win32") {
    chmodSync(join(nodeDir, meta.nodeRelative), 0o755);
  }

  if (!existsSync(nodeExe)) {
    throw new Error(`安装内置 Node 失败：${nodeExe}`);
  }
  log(`[bundled-node] 已安装 ${nodeExe}`);
  return nodeExe;
}

/**
 * @param {"dist"|"sfx"} layout
 */
export function buildStartCmd({ port = DEFAULT_PORT, host = DEFAULT_HOST, layout = "dist" } = {}) {
  const prefix = layout === "sfx" ? "app\\" : "";
  const serverRel = `${prefix}server.js`;
  const bundledNode = `${prefix}node\\node.exe`;
  const bundledNpm = `${prefix}node\\npm.cmd`;
  const packageJsonRel = `${prefix}package.json`;
  const nodeModulesRel = `${prefix}node_modules`;
  const registryFileRel = `${prefix}npm-registry.txt`;
  const cdTarget = layout === "sfx" ? "%~dp0app" : "%~dp0";
  // 默认静默：日志写入 .start.log，不 pause；设 PI_VERBOSE=1 可显示窗口输出
  return `@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
set "LOG=%~dp0.start.log"
if /I "%PI_VERBOSE%"=="1" (
  call :run
  exit /b !ERRORLEVEL!
)
call :run >"!LOG!" 2>&1
exit /b !ERRORLEVEL!

:run
echo [%DATE% %TIME%] starting...
echo dir=%CD%
if not exist "${serverRel}" (
  echo ERROR: ${serverRel} not found
  exit /b 1
)

set "NODE_BIN="
if exist "%~dp0${bundledNode}" set "NODE_BIN=%~dp0${bundledNode}"
if not defined NODE_BIN (
  where node >nul 2>&1
  if errorlevel 1 (
    echo ERROR: bundled node missing and system node not in PATH
    exit /b 1
  )
  set "NODE_BIN=node"
  echo using system node
) else (
  echo using bundled Node ${BUNDLED_NODE_VERSION}
)
"%NODE_BIN%" -v

set "NPM_BIN="
if exist "%~dp0${bundledNpm}" set "NPM_BIN=%~dp0${bundledNpm}"
if not defined NPM_BIN (
  where npm >nul 2>&1
  if not errorlevel 1 set "NPM_BIN=npm"
)

if not exist "%~dp0${nodeModulesRel}\\" (
  if not exist "%~dp0${packageJsonRel}" (
    echo ERROR: package.json not found, cannot npm install
    exit /b 1
  )
  if not defined NPM_BIN (
    echo ERROR: npm not found
    exit /b 1
  )
  echo node_modules missing, running npm install --omit=dev ...
  set "NPM_REG="
  if defined PI_NPM_REGISTRY set "NPM_REG=!PI_NPM_REGISTRY!"
  if not defined NPM_REG if defined NPM_REGISTRY set "NPM_REG=!NPM_REGISTRY!"
  if not defined NPM_REG if exist "%~dp0${registryFileRel}" (
    set /p NPM_REG=<"%~dp0${registryFileRel}"
  )
  set "NPM_REG_ARGS="
  if defined NPM_REG if not "!NPM_REG!"=="" (
    echo npm registry: !NPM_REG!
    set "NPM_REG_ARGS=--registry=!NPM_REG!"
  ) else (
    echo npm registry: default / .npmrc
  )
  pushd "${cdTarget}"
  call "%NPM_BIN%" install --omit=dev --legacy-peer-deps !NPM_REG_ARGS!
  set "INSTALL_EC=!ERRORLEVEL!"
  popd
  if not "!INSTALL_EC!"=="0" (
    echo ERROR: npm install failed with code !INSTALL_EC!
    exit /b !INSTALL_EC!
  )
)

cd /d "${cdTarget}"
if exist ".server.pid" (
  set /p OLD_PID=<".server.pid"
  if defined OLD_PID (
    tasklist /FI "PID eq !OLD_PID!" 2>nul | findstr /I "!OLD_PID!" >nul
    if not errorlevel 1 (
      echo already running pid=!OLD_PID! url=http://${host}:${port}
      exit /b 0
    )
  )
)

echo starting http://${host}:${port} background
set "PI_NODE_BIN=!NODE_BIN!"
set "PI_APP_DIR=%CD%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=Start-Process -FilePath $env:PI_NODE_BIN -ArgumentList @('server.js','--port','${port}','--host','${host}') -WorkingDirectory $env:PI_APP_DIR -WindowStyle Hidden -PassThru; Set-Content -LiteralPath (Join-Path $env:PI_APP_DIR '.server.pid') -Value $p.Id -Encoding ascii; Write-Output ('pid=' + $p.Id)"
if errorlevel 1 (
  echo ERROR: failed to start background process
  exit /b 1
)
set /p SERVER_PID=<".server.pid"
echo started pid=!SERVER_PID! url=http://${host}:${port}
exit /b 0
`;
}

/** 无窗口启动 start.cmd（双击也不闪控制台） */
export function buildStartVbs({ layout = "dist" } = {}) {
  const cmdRel = layout === "sfx" ? "start.cmd" : "start.cmd";
  return `Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
cmd = dir & "\\${cmdRel}"
' 0 = 隐藏窗口；False = 不等待
sh.Run "cmd.exe /c """ & cmd & """", 0, False
`;
}

export function buildStopCmd({ port = DEFAULT_PORT, layout = "dist" } = {}) {
  const cdTarget = layout === "sfx" ? "%~dp0app" : "%~dp0";
  return `@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "${cdTarget}"
set "KILLED=0"
if exist ".server.pid" (
  set /p SERVER_PID=<".server.pid"
  if defined SERVER_PID (
    echo [pi-alpha-desk] stopping pid=!SERVER_PID! ...
    taskkill /PID !SERVER_PID! /T /F >nul 2>&1
    if not errorlevel 1 set "KILLED=1"
  )
  del /f /q ".server.pid" >nul 2>&1
)
rem 兜底：按端口结束仍占用 ${port} 的进程
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":${port} .*LISTENING"') do (
  echo [pi-alpha-desk] killing listener pid=%%P on port ${port}
  taskkill /PID %%P /T /F >nul 2>&1
  set "KILLED=1"
)
if "!KILLED!"=="1" (
  echo [pi-alpha-desk] stopped
) else (
  echo [pi-alpha-desk] no running server found
)
pause
exit /b 0
`;
}

/**
 * @param {"dist"|"sfx"} layout
 */
export function buildStartSh({ port = DEFAULT_PORT, host = DEFAULT_HOST, layout = "dist" } = {}) {
  const bundledUnix = layout === "sfx" ? "app/node/bin/node" : "node/bin/node";
  const bundledWinStyle = layout === "sfx" ? "app/node/node" : "node/node";
  const bundledNpm = layout === "sfx" ? "app/node/bin/npm" : "node/bin/npm";
  const appExpr = layout === "sfx" ? '"$ROOT/app"' : '"$ROOT"';
  return `#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
APP_DIR=${appExpr}

if [[ ! -f "$APP_DIR/server.js" ]]; then
  echo "[pi-alpha-desk] $APP_DIR/server.js not found" >&2
  exit 1
fi

NODE_BIN=""
if [[ -x "$ROOT/${bundledUnix}" ]]; then
  NODE_BIN="$ROOT/${bundledUnix}"
elif [[ -x "$ROOT/${bundledWinStyle}" ]]; then
  NODE_BIN="$ROOT/${bundledWinStyle}"
elif command -v node >/dev/null 2>&1; then
  NODE_BIN="$(command -v node)"
  echo "[pi-alpha-desk] using system node:"
else
  echo "[pi-alpha-desk] bundled node missing and system node not in PATH." >&2
  echo "Expected: $ROOT/${bundledUnix}" >&2
  echo "Or install Node.js >= ${BUNDLED_NODE_VERSION}" >&2
  exit 1
fi

if [[ "$NODE_BIN" == "$ROOT/${bundledUnix}" || "$NODE_BIN" == "$ROOT/${bundledWinStyle}" ]]; then
  echo "[pi-alpha-desk] using bundled Node ${BUNDLED_NODE_VERSION}:"
fi
"$NODE_BIN" -v

NPM_BIN=""
if [[ -x "$ROOT/${bundledNpm}" ]]; then
  NPM_BIN="$ROOT/${bundledNpm}"
elif command -v npm >/dev/null 2>&1; then
  NPM_BIN="$(command -v npm)"
fi

if [[ ! -d "$APP_DIR/node_modules" ]]; then
  if [[ ! -f "$APP_DIR/package.json" ]]; then
    echo "[pi-alpha-desk] package.json not found, cannot npm install" >&2
    exit 1
  fi
  if [[ -z "$NPM_BIN" ]]; then
    echo "[pi-alpha-desk] npm not found. Bundled Node should include bin/npm." >&2
    exit 1
  fi
  echo "[pi-alpha-desk] node_modules missing, running npm install --omit=dev ..."
  # 优先级: PI_NPM_REGISTRY > NPM_REGISTRY > npm-registry.txt > .npmrc/默认源
  NPM_REG="\${PI_NPM_REGISTRY:-}"
  if [[ -z "$NPM_REG" && -n "\${NPM_REGISTRY:-}" ]]; then
    NPM_REG="$NPM_REGISTRY"
  fi
  if [[ -z "$NPM_REG" && -f "$APP_DIR/npm-registry.txt" ]]; then
    NPM_REG="$(grep -v '^[[:space:]]*#' "$APP_DIR/npm-registry.txt" | head -n 1 | tr -d '\\r' | xargs || true)"
  fi
  if [[ -n "$NPM_REG" ]]; then
    echo "[pi-alpha-desk] npm registry: $NPM_REG"
    ( cd "$APP_DIR" && "$NPM_BIN" install --omit=dev --legacy-peer-deps --registry "$NPM_REG" )
  else
    echo "[pi-alpha-desk] npm registry: default / .npmrc"
    echo "[pi-alpha-desk] tip: set PI_NPM_REGISTRY or edit npm-registry.txt / .npmrc"
    ( cd "$APP_DIR" && "$NPM_BIN" install --omit=dev --legacy-peer-deps )
  fi
fi

cd "$APP_DIR"
if [[ -f .server.pid ]]; then
  OLD_PID="$(tr -d '[:space:]' < .server.pid || true)"
  if [[ -n "$OLD_PID" ]] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "[pi-alpha-desk] already running, pid=$OLD_PID"
    echo "[pi-alpha-desk] open http://${host}:${port}"
    echo "[pi-alpha-desk] stop with ./stop.sh"
    exit 0
  fi
fi

echo "[pi-alpha-desk] starting http://${host}:${port} (background)"
nohup "$NODE_BIN" server.js --port ${port} --host ${host} >.server.log 2>&1 &
echo $! > .server.pid
echo "[pi-alpha-desk] started pid=$(tr -d '[:space:]' < .server.pid)"
echo "[pi-alpha-desk] url: http://${host}:${port}"
echo "[pi-alpha-desk] log: $APP_DIR/.server.log"
echo "[pi-alpha-desk] stop: ./stop.sh"
`;
}

export function buildStopSh({ port = DEFAULT_PORT, layout = "dist" } = {}) {
  const appExpr = layout === "sfx" ? '"$ROOT/app"' : '"$ROOT"';
  return `#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
APP_DIR=${appExpr}
cd "$APP_DIR"
KILLED=0
if [[ -f .server.pid ]]; then
  PID="$(tr -d '[:space:]' < .server.pid || true)"
  if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
    echo "[pi-alpha-desk] stopping pid=$PID ..."
    kill "$PID" 2>/dev/null || true
    sleep 1
    kill -9 "$PID" 2>/dev/null || true
    KILLED=1
  fi
  rm -f .server.pid
fi
if command -v lsof >/dev/null 2>&1; then
  for PID in $(lsof -tiTCP:${port} -sTCP:LISTEN 2>/dev/null || true); do
    echo "[pi-alpha-desk] killing listener pid=$PID on port ${port}"
    kill "$PID" 2>/dev/null || true
    KILLED=1
  done
fi
if [[ "$KILLED" -eq 1 ]]; then
  echo "[pi-alpha-desk] stopped"
else
  echo "[pi-alpha-desk] no running server found"
fi
`;
}

/** 写入 npm 源配置示例与默认可编辑文件 */
export function writeNpmRegistryExample(targetDir) {
  writeFileSync(
    join(targetDir, "npm-registry.example.txt"),
    `# 用法（任选其一）：
# 1) 编辑同目录 npm-registry.txt，只保留一行 registry URL
# 2) 设置环境变量 PI_NPM_REGISTRY 或 NPM_REGISTRY
# 3) 在同目录写 .npmrc，例如：registry=https://registry.npmmirror.com
#
# 优先级：PI_NPM_REGISTRY > NPM_REGISTRY > npm-registry.txt > .npmrc > npm 默认源
`,
    "utf8",
  );
  const registryPath = join(targetDir, "npm-registry.txt");
  if (!existsSync(registryPath)) {
    writeFileSync(registryPath, "https://registry.npmmirror.com\n", "utf8");
  }
  const npmrcExample = join(targetDir, ".npmrc.example");
  if (!existsSync(npmrcExample)) {
    writeFileSync(
      npmrcExample,
      "registry=https://registry.npmmirror.com\nlegacy-peer-deps=true\n",
      "utf8",
    );
  }
  // 便于手动 npm install 也跳过 peer 冲突（与 start 脚本一致）
  const npmrcPath = join(targetDir, ".npmrc");
  if (!existsSync(npmrcPath)) {
    writeFileSync(
      npmrcPath,
      `# 可由 npm-registry.txt / PI_NPM_REGISTRY 覆盖 registry
legacy-peer-deps=true
`,
      "utf8",
    );
  }
}

export function writeStartScripts(targetDir, options = {}) {
  const layout = options.layout || "dist";
  const port = options.port || DEFAULT_PORT;
  const host = options.host || DEFAULT_HOST;
  // Windows cmd 双击必须用 CRLF，否则会一闪而过/命令被截断
  const cmdBody = buildStartCmd({ port, host, layout }).replace(/\r?\n/g, "\r\n");
  const stopCmdBody = buildStopCmd({ port, layout }).replace(/\r?\n/g, "\r\n");
  const vbsBody = buildStartVbs({ layout }).replace(/\r?\n/g, "\r\n");
  writeFileSync(join(targetDir, "start.cmd"), cmdBody, "utf8");
  writeFileSync(join(targetDir, "stop.cmd"), stopCmdBody, "utf8");
  writeFileSync(join(targetDir, "start.vbs"), vbsBody, "utf8");
  const shPath = join(targetDir, "start.sh");
  const stopShPath = join(targetDir, "stop.sh");
  writeFileSync(shPath, buildStartSh({ port, host, layout }), "utf8");
  writeFileSync(stopShPath, buildStopSh({ port, layout }), "utf8");
  if (layout === "dist") {
    writeNpmRegistryExample(targetDir);
  }
  if (process.platform !== "win32") {
    try {
      chmodSync(shPath, 0o755);
      chmodSync(stopShPath, 0o755);
    } catch {
      // 部分文件系统不支持 chmod
    }
  }
}
