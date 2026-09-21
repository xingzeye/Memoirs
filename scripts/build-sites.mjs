import { mkdir, cp } from "node:fs/promises";
import { join } from "node:path";
import { build } from "esbuild";

const root = process.cwd();

await mkdir(join(root, "dist", "server"), { recursive: true });
await mkdir(join(root, "dist", "client", "static"), { recursive: true });
await build({
  entryPoints: [join(root, "worker", "index.js")],
  outfile: join(root, "dist", "server", "index.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
});
await cp(join(root, "static", "frontend"), join(root, "dist", "client", "static", "frontend"), {
  recursive: true,
});
