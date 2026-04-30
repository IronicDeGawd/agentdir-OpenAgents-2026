// Generate a fresh EVM wallet for agentdir testnet work.
// Writes to .env.local (gitignored). Never commit secrets.
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// REPO_ROOT must be passed as env var since the script may be copied to a
// nested workspace dir to inherit viem from that workspace's node_modules.
const here = dirname(fileURLToPath(import.meta.url));
const root = process.env.REPO_ROOT || resolve(here, "..");
const envPath = resolve(root, ".env.local");

const pk = generatePrivateKey();
const acct = privateKeyToAccount(pk);

const block = `
# --- agentdir testnet wallet (auto-generated) ---
# Address: ${acct.address}
# Use ONLY for 0G Galileo + Sepolia testnet. Never fund with real assets.
PRIVATE_KEY=${pk}
WALLET_ADDRESS=${acct.address}
`;

if (existsSync(envPath)) {
  const existing = readFileSync(envPath, "utf8");
  if (existing.includes("PRIVATE_KEY=") && !existing.includes("PRIVATE_KEY=0x\n") && !existing.includes("PRIVATE_KEY=\n")) {
    console.error("ERR  .env.local already has PRIVATE_KEY. Edit manually if you want to overwrite.");
    process.exit(1);
  }
  writeFileSync(envPath, existing.trimEnd() + "\n" + block);
} else {
  writeFileSync(envPath, block.trimStart());
}

console.log("address: " + acct.address);
console.log("private key written to .env.local (gitignored)");
console.log("\nfund this address from:");
console.log("  https://faucet.0g.ai                                              (0G testnet)");
console.log("  https://cloud.google.com/application/web3/faucet/0g/galileo       (GCP fallback)");
console.log("  https://www.alchemy.com/faucets/ethereum-sepolia                  (Sepolia)");
