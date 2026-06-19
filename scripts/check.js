import { readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const files = [
  ...readdirSync("dist").filter((file) => file.endsWith(".js")).map((file) => join("dist", file)),
  ...readdirSync("bin").filter((file) => file.endsWith(".js")).map((file) => join("bin", file))
];

for (const file of files) {
  run(process.execPath, ["--check", file]);
}

run("git", ["diff", "--check"]);

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}
