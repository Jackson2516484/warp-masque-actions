// 构建脚本。用 esbuild 的 JS API 而不是 CLI：
// CLI 里写 --banner:js="a\nb" 时，\n 在 shell 的双引号串里不会被解释，
// 会把一整段 banner 变成「一行里含字面 \n」，产物头部看着像坏了。
import * as esbuild from "esbuild";

const banner = [
  "// Opera VPN over Cloudflare WARP (MASQUE) —— 单文件版",
  "// 由 src/ 打包而成，网页部署用。改代码请改 src/ 后重新 npm run build。",
  "// 仓库 https://github.com/byJoey/warp-masque-actions",
].join("\n");

await esbuild.build({
  entryPoints: ["src/index.js"],
  bundle: true,
  format: "esm",
  target: "es2022",
  outfile: "dist/worker.js",
  banner: { js: banner },
});

const { size } = await import("node:fs").then((fs) => fs.promises.stat("dist/worker.js"));
console.log(`dist/worker.js  ${(size / 1024).toFixed(1)} KB`);
