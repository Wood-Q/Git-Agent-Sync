import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const source = "agent-sync-showcase.html";
const targets = [
  join("docs", "index.html"),
  join("docs", ".vitepress", "dist", "index.html")
];

if (!existsSync(source)) {
  throw new Error(`missing showcase page: ${source}`);
}

for (const target of targets) {
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  console.log(`docs: copied ${source} to ${target}`);
}
