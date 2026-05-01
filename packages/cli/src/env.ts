// Lightweight env loader: parse .env.local at repo root, copy unset vars
// into process.env. No external dotenv dep.
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

let loaded = false;

export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  // src/ → packages/cli/ → packages/ → repoRoot
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, "..", "..", "..");
  const p = resolve(repoRoot, ".env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && m[1] && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

export function require_(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`missing env var: ${name}`);
    process.exit(2);
  }
  return v;
}
