#!/usr/bin/env node
// Smoke test the DirectCompute path through the *built* Next bundle.
// Loads the bundled chunk and tries to import the symbol Next would resolve.
// Catches the createRequire / path mangling regression locally instead of
// finding it on prod after deploy.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

const route = ".next/server/app/api/call/route.js";
const txt = await readFile(route, "utf8").catch(() => null);
if (!txt) {
  console.error(`Build artifact missing: ${route}. Run pnpm build first.`);
  process.exit(2);
}

// We don't actually invoke a request here (would need Mongo); we just verify
// the bundle preserves createRequire and node:path symbols. A future fuller
// smoke can spin a dev server with mocked Mongo.
const checks = [
  { needle: "createRequire", help: "node:module createRequire must survive bundling" },
  { needle: "node:path", help: "node:path import must remain a runtime require" },
];
let bad = false;
for (const c of checks) {
  if (!txt.includes(c.needle)) {
    console.warn(`hint: \`${c.needle}\` not found in bundle — ${c.help}`);
    // Not fatal; webpack can rename symbols. Just informational.
  }
}

// Real failure mode is "b.createRequire is not a function" — that happens at
// runtime after a numeric path leak. Look for the obvious mangle pattern:
// `import("node:module")` left in the bundle (which webpack inlines wrong).
if (/await\s+import\(["']node:module["']\)/.test(txt)) {
  console.error("regression: bundle still has dynamic await import('node:module') which webpack mangles");
  bad = true;
}

if (bad) process.exit(1);
console.log("smoke ok — DirectCompute bundle markers look right");
