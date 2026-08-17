export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { configureHttpDispatcher } = await import("@/lib/http-dispatcher");
  configureHttpDispatcher();

  // 开发 / next start 路径也同步内置 skills；dist/server.js 启动时会再跑一次（有指纹快路径）
  try {
    const path = await import("node:path");
    const os = await import("node:os");
    const { existsSync } = await import("node:fs");
    const { createRequire } = await import("node:module");
    const require = createRequire(path.join(process.cwd(), "package.json"));
    const {
      installBundledSkills,
      resolveBundledSkillsTargetRoot,
    } = require("./lib/bundled-skills.js") as {
      installBundledSkills: (options: {
        sourceRoot: string;
        targetRoot: string;
      }) => Promise<unknown>;
      resolveBundledSkillsTargetRoot: (options: {
        homeDirectory: string;
        configuredAgentDir?: string;
      }) => string;
    };

    const candidates = [
      path.join(process.cwd(), "bundled-skills"),
      path.join(process.cwd(), "..", "bundled-skills"),
    ];
    const sourceRoot = candidates.find((candidate) => existsSync(candidate));
    if (!sourceRoot) return;

    void installBundledSkills({
      sourceRoot,
      targetRoot: resolveBundledSkillsTargetRoot({
        homeDirectory: os.homedir(),
        configuredAgentDir: process.env.PI_CODING_AGENT_DIR,
      }),
    }).catch((error: unknown) => {
      console.warn(
        "[pi-web] bundled skills install failed:",
        error instanceof Error ? error.message : error,
      );
    });
  } catch (error) {
    console.warn(
      "[pi-web] bundled skills bootstrap skipped:",
      error instanceof Error ? error.message : error,
    );
  }
}
