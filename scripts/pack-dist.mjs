#!/usr/bin/env node
/**
 * 组装可独立运行的 dist/ 目录（不依赖仓库根 node_modules）。
 *
 * 策略：
 *   1. 复制完整生产 .next（排除 cache / standalone / dev）
 *   2. 复制 public、bundled-plugins、bundled-skills
 *   3. 默认复制生产依赖到 dist/node_modules；可用 --omit-node-modules 省略（启动时 npm install）
 *   4. 写入 server.js（Next.js custom server，默认 127.0.0.1:30141）
 *   5. 内置当前平台 Node 22，并写入 start.cmd / start.sh / npm-registry.txt
 *
 * 用法：在 `next build` 之后执行 `node scripts/pack-dist.mjs`
 *       node scripts/pack-dist.mjs --omit-node-modules
 */
"use strict";

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
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
const NEXT = join(ROOT, ".next");

function log(message) {
  console.log(`[pack-dist] ${message}`);
}

function fail(message) {
  console.error(`[pack-dist] ${message}`);
  process.exit(1);
}

/** Windows 用 robocopy；其他平台用 cpSync。excludeDirs 仅 Windows 生效。 */
function copyDir(from, to, excludeDirs = []) {
  mkdirSync(dirname(to), { recursive: true });
  if (process.platform === "win32") {
    const args = [from, to, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NC", "/NS", "/NP", "/MT:8"];
    if (excludeDirs.length > 0) {
      args.push("/XD", ...excludeDirs);
    }
    const result = spawnSync("robocopy", args, { stdio: ["ignore", "ignore", "inherit"] });
    const code = result.status ?? 1;
    // robocopy: 0–7 视为成功
    if (code >= 8) fail(`robocopy 失败 (${code}): ${from} -> ${to}`);
    return;
  }
  cpSync(from, to, {
    recursive: true,
    filter: (source) => {
      const base = source.split(/[/\\]/).pop();
      return !excludeDirs.includes(base);
    },
  });
}

/**
 * 复制生产依赖：跳过 package.json 的 devDependencies 顶层包。
 * 传递依赖若已 hoist 到根 node_modules，会被一并带上。
 */
function copyProductionNodeModules(packageJson) {
  const rootNodeModules = join(ROOT, "node_modules");
  const distNodeModules = join(DIST, "node_modules");
  mkdirSync(distNodeModules, { recursive: true });

  const skip = new Set([
    ...Object.keys(packageJson.devDependencies ?? {}),
    ".bin",
    ".cache",
    ".package-lock.json",
  ]);

  for (const entry of readdirSync(rootNodeModules, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (skip.has(entry.name)) continue;

    if (entry.name.startsWith("@")) {
      const scopeFrom = join(rootNodeModules, entry.name);
      const scopeTo = join(distNodeModules, entry.name);
      mkdirSync(scopeTo, { recursive: true });
      for (const scoped of readdirSync(scopeFrom, { withFileTypes: true })) {
        if (!scoped.isDirectory() && !scoped.isSymbolicLink()) continue;
        const fullName = `${entry.name}/${scoped.name}`;
        if (skip.has(fullName)) continue;
        copyDir(join(scopeFrom, scoped.name), join(scopeTo, scoped.name));
      }
      continue;
    }

    copyDir(join(rootNodeModules, entry.name), join(distNodeModules, entry.name));
  }

  for (const name of Object.keys(packageJson.dependencies ?? {})) {
    const from = join(rootNodeModules, ...name.split("/"));
    const to = join(distNodeModules, ...name.split("/"));
    if (!existsSync(from)) {
      log(`警告：缺少依赖 ${name}`);
      continue;
    }
    if (!existsSync(to)) {
      log(`补齐依赖 ${name}`);
      copyDir(from, to);
    }
  }
}

function writeServerJs() {
  writeFileSync(
    join(DIST, "server.js"),
    `#!/usr/bin/env node
"use strict";

/**
 * dist 独立入口。
 * 用法：
 *   node server.js
 *   node server.js --port 3000 --host 127.0.0.1
 * 短参数：-p / -H；也可用环境变量 PORT / HOSTNAME / PI_WEB_HOSTNAME
 */
const { createServer } = require("http");
const { parse } = require("url");
const path = require("path");
const fs = require("fs");
const os = require("os");

const MIN_NODE = [22, 19, 0];

function nodeVersionParts(version = process.versions.node) {
  return String(version).split(".").map((part) => Number(part) || 0);
}

function isNodeTooOld(current = nodeVersionParts(), minimum = MIN_NODE) {
  for (let i = 0; i < minimum.length; i += 1) {
    const a = current[i] || 0;
    const b = minimum[i] || 0;
    if (a > b) return false;
    if (a < b) return true;
  }
  return false;
}

if (isNodeTooOld()) {
  console.error(
    \`[pi-web] Node.js >= \${MIN_NODE.join(".")} required, current is \${process.versions.node}.\\n\` +
      "Please upgrade Node and retry: node server.js --port 3000 --host 127.0.0.1",
  );
  process.exit(1);
}

const next = require("next");
const util = require("util");

process.chdir(__dirname);

/** 生产环境把 console / 未捕获异常写入 server-log.txt，便于后台启动排障 */
function setupFileLogging() {
  const logPath = path.join(__dirname, "server-log.txt");
  const stream = fs.createWriteStream(logPath, { flags: "a" });
  const formatArgs = (args) =>
    args
      .map((arg) => {
        if (typeof arg === "string") return arg;
        if (arg instanceof Error) return arg.stack || arg.message;
        try {
          return util.inspect(arg, { depth: 4, breakLength: 120 });
        } catch {
          return String(arg);
        }
      })
      .join(" ");
  const write = (level, args) => {
    try {
      stream.write(\`[\${new Date().toISOString()}] [\${level}] \${formatArgs(args)}\\n\`);
    } catch {
      // 日志写失败不阻断服务
    }
  };
  const wrap =
    (level, original) =>
    (...args) => {
      original.apply(console, args);
      write(level, args);
    };
  console.log = wrap("INFO", console.log.bind(console));
  console.info = wrap("INFO", console.info.bind(console));
  console.warn = wrap("WARN", console.warn.bind(console));
  console.error = wrap("ERROR", console.error.bind(console));
  process.on("uncaughtException", (error) => {
    console.error("[pi-web] uncaughtException:", error);
  });
  process.on("unhandledRejection", (reason) => {
    console.error("[pi-web] unhandledRejection:", reason);
  });
  console.log(\`[pi-web] file logging -> \${logPath}\`);
  return logPath;
}

setupFileLogging();

/** 手写解析，避免依赖 util.parseArgs（旧 Node 无此 API） */
function readArgValue(argv, index, flag) {
  const current = argv[index];
  if (current === flag) {
    const nextValue = argv[index + 1];
    if (!nextValue || nextValue.startsWith("-")) {
      throw new Error(\`Missing value for \${flag}\`);
    }
    return { value: nextValue, consumed: 2 };
  }
  if (current.startsWith(\`\${flag}=\`)) {
    return { value: current.slice(flag.length + 1), consumed: 1 };
  }
  return null;
}

function resolveListenOptions(argv = process.argv.slice(2), env = process.env) {
  let host;
  let port;
  for (let i = 0; i < argv.length; ) {
    const arg = argv[i];
    const asPort = readArgValue(argv, i, "--port") || readArgValue(argv, i, "-p");
    if (asPort) {
      port = asPort.value;
      i += asPort.consumed;
      continue;
    }
    const asHost =
      readArgValue(argv, i, "--host") ||
      readArgValue(argv, i, "--hostname") ||
      readArgValue(argv, i, "-H");
    if (asHost) {
      host = asHost.value;
      i += asHost.consumed;
      continue;
    }
    i += 1;
  }

  host = host || env.HOSTNAME || env.PI_WEB_HOSTNAME || "127.0.0.1";
  port = Number(port || env.PORT || 30141);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new Error(\`Invalid port: \${port}\`);
  }
  return { host, port };
}

const { host: hostname, port } = resolveListenOptions();
process.env.PORT = String(port);
process.env.HOSTNAME = hostname;
process.env.PI_WEB_HOSTNAME = hostname;

async function installBundledSkillsIfPresent() {
  const sourceRoot = path.join(__dirname, "bundled-skills");
  if (!fs.existsSync(sourceRoot)) return;
  try {
    const {
      installBundledSkills,
      resolveBundledSkillsTargetRoot,
    } = require("./lib/bundled-skills.js");
    await installBundledSkills({
      sourceRoot,
      targetRoot: resolveBundledSkillsTargetRoot({
        homeDirectory: os.homedir(),
        configuredAgentDir: process.env.PI_CODING_AGENT_DIR,
      }),
    });
  } catch (error) {
    console.warn("[pi-web] bundled skills install failed:", error instanceof Error ? error.message : error);
  }
}

async function main() {
  const app = next({
    dev: false,
    hostname,
    port,
    dir: __dirname,
  });
  const handle = app.getRequestHandler();
  await app.prepare();

  createServer(async (req, res) => {
    const startedAt = Date.now();
    const method = req.method || "GET";
    const url = req.url || "/";
    res.on("finish", () => {
      console.log(
        \`[http] \${method} \${url} -> \${res.statusCode} (\${Date.now() - startedAt}ms)\`,
      );
    });
    try {
      await handle(req, res, parse(url, true));
    } catch (error) {
      console.error("Error occurred handling", url, error);
      res.statusCode = 500;
      res.end("internal server error");
    }
  }).listen(port, hostname, () => {
    console.log(\`> Ready on http://\${hostname}:\${port}\`);
    console.log(\`> Logs: \${path.join(__dirname, "server-log.txt")}\`);
    void installBundledSkillsIfPresent();
  });
}

main().catch((error) => {
  console.error("[pi-web] failed to start:", error);
  process.exit(1);
});
`,
    "utf8",
  );
}

/** 写入 dist/start.cmd 与 start.sh：优先内置 Node，否则回退系统 node */
function writeStartCmd() {
  writeStartScripts(DIST, { layout: "dist", port: "9000", host: "localhost" });
  log(`写入 start.cmd / start.sh（优先内置 Node ${BUNDLED_NODE_VERSION}）`);
}

async function main() {
  const omitNodeModules = process.argv.includes("--omit-node-modules");
  const packageJson = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const buildIdPath = join(NEXT, "BUILD_ID");
  if (!existsSync(buildIdPath) || !readFileSync(buildIdPath, "utf8").trim()) {
    fail("未找到有效的 .next/BUILD_ID，请先执行 next build");
  }

  log("清理 dist/");
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });

  log("复制 .next/（排除 cache / standalone / dev）");
  copyDir(NEXT, join(DIST, ".next"), ["cache", "standalone", "dev"]);

  if (existsSync(join(ROOT, "public"))) {
    log("复制 public/");
    copyDir(join(ROOT, "public"), join(DIST, "public"));
  }

  if (existsSync(join(ROOT, "bundled-plugins"))) {
    log("复制 bundled-plugins/");
    copyDir(join(ROOT, "bundled-plugins"), join(DIST, "bundled-plugins"));
  }

  if (existsSync(join(ROOT, "bundled-skills"))) {
    log("复制 bundled-skills/");
    copyDir(join(ROOT, "bundled-skills"), join(DIST, "bundled-skills"));
  }

  mkdirSync(join(DIST, "lib"), { recursive: true });
  // 不用 fs.cpSync：Windows + 非 ASCII 路径下会 unlink 失败/进程异常
  copyFileSync(join(ROOT, "lib", "bundled-skills.js"), join(DIST, "lib", "bundled-skills.js"));

  const lockPath = join(ROOT, "package-lock.json");
  if (existsSync(lockPath)) {
    copyFileSync(lockPath, join(DIST, "package-lock.json"));
    log("复制 package-lock.json");
  }

  if (omitNodeModules) {
    log("跳过 node_modules（--omit-node-modules；首次启动将 npm install）");
  } else {
    log("复制生产依赖到 dist/node_modules …");
    copyProductionNodeModules(packageJson);
  }

  writeServerJs();

  log(`安装内置 Node ${BUNDLED_NODE_VERSION} …`);
  await ensureBundledNode(DIST, { log });
  writeStartCmd();

  writeFileSync(
    join(DIST, "package.json"),
    `${JSON.stringify(
      {
        name: packageJson.name,
        version: packageJson.version,
        private: true,
        description: "Standalone production build of pi-alpha-desk",
        engines: packageJson.engines,
        scripts: { start: "node server.js" },
        dependencies: packageJson.dependencies,
        ...(packageJson.overrides ? { overrides: packageJson.overrides } : {}),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  log(`完成：${DIST}`);
  log("启动：双击 start.cmd（Windows）或 ./start.sh（macOS/Linux）");
  if (omitNodeModules) {
    log("npm 源：编辑 dist/npm-registry.txt，或设 PI_NPM_REGISTRY / 写 .npmrc");
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
