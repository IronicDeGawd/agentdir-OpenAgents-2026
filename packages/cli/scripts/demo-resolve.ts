#!/usr/bin/env node
// Resolve an agentdir ENS subname via Sepolia, print the recovered identity.
// Usage: node demo-resolve.mjs <name>
import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";
import { normalize } from "viem/ens";

const [, , name] = process.argv;
if (!name) {
  console.error("usage: demo-resolve.mjs <name>");
  process.exit(2);
}

const c = createPublicClient({
  chain: sepolia,
  transport: http(process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com"),
});

const [pubkey, tokenId, contract, cardJson] = await Promise.all([
  c.getEnsText({ name: normalize(name), key: "network.axl.pubkey" }),
  c.getEnsText({ name: normalize(name), key: "org.erc7857.tokenId" }),
  c.getEnsText({ name: normalize(name), key: "org.erc7857.contract" }),
  c.getEnsText({ name: normalize(name), key: "org.a2a.agent-card" }),
]);

if (!pubkey || !cardJson) {
  console.error(`no agentdir records on ${name}`);
  process.exit(1);
}
const card = JSON.parse(cardJson);
console.log(`name:       ${card.name}`);
console.log(`axl pubkey: ${pubkey}`);
console.log(`iNFT:       ${contract} #${tokenId}`);
console.log(`skills:     ${card.skills.map((s) => s.id).join(", ")}`);
