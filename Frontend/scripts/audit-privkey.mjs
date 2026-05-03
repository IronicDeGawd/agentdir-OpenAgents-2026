#!/usr/bin/env node
// Refuses to merge if `axlPrivateKey` appears outside the small set of
// modules that legitimately handle it. Run via `pnpm run audit:privkey`.
// Exit non-zero on violation so CI catches it.

import { execSync } from "node:child_process";

const ALLOWED = [
  "lib/identity-crypto.ts",
  "lib/identity-store.ts",
  "lib/identity-gen.ts",
  "app/api/mint/route.ts",
  "app/api/snapshot/route.ts",
  "app/mint/mint-flow.tsx",
  "lib/__tests__",
  "scripts/audit-privkey.mjs",
];

let raw;
try {
  raw = execSync("grep -rln axlPrivateKey app lib components scripts || true", {
    encoding: "utf8",
  });
} catch (e) {
  console.error("grep failed:", e.message);
  process.exit(2);
}

const offenders = raw
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean)
  .filter((path) => !ALLOWED.some((a) => path.includes(a)));

if (offenders.length > 0) {
  console.error("Privkey reference found in unexpected files:");
  for (const p of offenders) console.error("  - " + p);
  process.exit(1);
}
console.log("audit ok — no unexpected axlPrivateKey references");
