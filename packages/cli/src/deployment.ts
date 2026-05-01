// Read packages/contracts/deployments/galileo.json without bundling.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type Deployment = {
  chainId: number;
  rpcUrl: string;
  explorer: string;
  AgentdirINFT: { address: `0x${string}`; deployer: string; deployTx: string; block: number };
};

export function loadDeployment(): Deployment {
  // src/ → packages/cli/ → packages/ → repoRoot
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, "..", "..", "..");
  const p = resolve(repoRoot, "packages/contracts/deployments/galileo.json");
  return JSON.parse(readFileSync(p, "utf8")) as Deployment;
}
