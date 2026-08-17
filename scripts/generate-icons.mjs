// 从 public/ 中的 SVG 生成 macOS 用 PNG 图标。
// 手动执行：npm run icons

import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function renderSvg(svgPath, pngPath, size) {
  await sharp(svgPath, { density: 96 })
    .resize(size, size, { fit: "contain" })
    .png()
    .toFile(pngPath);
  const meta = await sharp(pngPath).metadata();
  console.log(`[icons] ${path.relative(root, pngPath)}  ${meta.width}x${meta.height}`);
}

async function main() {
  await renderSvg(
    path.join(root, "public", "icon.svg"),
    path.join(root, "public", "icon-mac.png"),
    1024,
  );
}

main().catch((err) => {
  console.error("[icons] failed:", err);
  process.exit(1);
});
