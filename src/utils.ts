import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";

export function writeJson(path: string, value: unknown) {
  writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeFileAtomic(path: string, content: string, options: any = undefined) {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = join(dirname(path), `.${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2)}.tmp`);
  writeFileSync(tempPath, content, options);
  renameSync(tempPath, path);
}

export function readJson<T = any>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

export function safeRead(path: string) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

export function unique<T>(values: Iterable<T>): T[] {
  return [...new Set(values)];
}

export function normalizePath(path: string) {
  return resolve(path).replaceAll("\\", "/");
}

export function toSlash(path: string) {
  return path.replaceAll("\\", "/");
}

export function shrinkHome(path: string) {
  const home = normalizePath(homedir());
  const normalized = normalizePath(path);
  if (normalized.startsWith(`${home}/`)) {
    return `~/${relative(home, normalized).replaceAll(sep, "/")}`;
  }
  return normalized;
}

export function expandHome(path: string) {
  if (path === "~") {
    return homedir();
  }
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

export function walk(root: string) {
  const files: string[] = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }
  return files;
}
