import { mkdir, copyFile, cp } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();

await mkdir(join(root, "dist", "server"), { recursive: true });
await mkdir(join(root, "dist", "client", "static"), { recursive: true });
await copyFile(join(root, "worker", "index.js"), join(root, "dist", "server", "index.js"));
await cp(join(root, "static", "frontend"), join(root, "dist", "client", "static", "frontend"), {
  recursive: true,
});
