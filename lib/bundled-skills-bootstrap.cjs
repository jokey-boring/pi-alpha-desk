"use strict";

/**
 * Node 服务端 bundled-skills 同步（CJS，供 instrumentation 以 webpackIgnore 加载）。
 */
const { existsSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");

async function bootstrapBundledSkills() {
  const {
    installBundledSkills,
    resolveBundledSkillsTargetRoot,
  } = require(path.join(process.cwd(), "lib", "bundled-skills.js"));

  const candidates = [
    path.join(process.cwd(), "bundled-skills"),
    path.join(process.cwd(), "..", "bundled-skills"),
  ];
  const sourceRoot = candidates.find((candidate) => existsSync(candidate));
  if (!sourceRoot) return;

  await installBundledSkills({
    sourceRoot,
    targetRoot: resolveBundledSkillsTargetRoot({
      homeDirectory: os.homedir(),
      configuredAgentDir: process.env.PI_CODING_AGENT_DIR,
    }),
  });
}

module.exports = { bootstrapBundledSkills };
