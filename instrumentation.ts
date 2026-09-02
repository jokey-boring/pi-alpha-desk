import path from "node:path";
import { pathToFileURL } from "node:url";

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { configureHttpDispatcher } = await import("@/lib/http-dispatcher");
  configureHttpDispatcher();

  // 开发 / next start 也同步内置 skills；dist/server.js 启动时会再跑一次（有指纹快路径）
  try {
    const bootstrapModule = pathToFileURL(
      path.join(process.cwd(), "lib", "bundled-skills-bootstrap.cjs"),
    ).href;
    const { bootstrapBundledSkills } = await import(/* webpackIgnore: true */ bootstrapModule);
    void bootstrapBundledSkills().catch((error: unknown) => {
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
