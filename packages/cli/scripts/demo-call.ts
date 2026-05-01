#!/usr/bin/env node
// Resolve a target ENS name → AXL pubkey → call a skill via local AXL node.
// Verifies the responder signature against the ENS-published pubkey.
//
// Usage:
//   demo-call.mjs --axl http://127.0.0.1:9102 --from alice --target bob.agentdir.eth \
//                 --skill summarize --input '{"text":"..."}'
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";
import { normalize } from "viem/ens";
import { AxlClient } from "@agentdir/sdk";
import { callSkill } from "@agentdir/agent";

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) {
    args[a.slice(2)] = process.argv[i + 1];
    i++;
  }
}

const ensClient = createPublicClient({
  chain: sepolia,
  transport: http(process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com"),
});

const targetPubkey = await ensClient.getEnsText({
  name: normalize(args.target),
  key: "network.axl.pubkey",
});
const targetTokenId = await ensClient.getEnsText({
  name: normalize(args.target),
  key: "org.erc7857.tokenId",
});
if (!targetPubkey) throw new Error(`no axl pubkey for ${args.target}`);
console.log(`resolved ${args.target} → axl=${targetPubkey.slice(0, 16)}… inft=#${targetTokenId}`);

const fromIdPath = join(homedir(), ".agentdir", args.from, "identity.json");
const fromId = JSON.parse(readFileSync(fromIdPath, "utf8"));
const axl = new AxlClient(args.axl);
const localPub = (await axl.topology()).our_public_key;
if (localPub.toLowerCase() !== fromId.axlPubkeyHex.toLowerCase()) {
  console.error(`local AXL node pubkey ${localPub} != identity ${fromId.axlPubkeyHex}`);
  console.error("did you boot the AXL node with --config alice-node.json that uses agent-derived PEM?");
  process.exit(1);
}

const t0 = Date.now();
const res = await callSkill({
  axl,
  destPubkey: targetPubkey,
  callerPubkey: fromId.axlPubkeyHex,
  skill: args.skill,
  input: JSON.parse(args.input),
  callerINFT: fromId.inftTokenId,
  expectedResponderPubkey: targetPubkey,
});
console.log(`ok in ${Date.now() - t0}ms`);
console.log(JSON.stringify(res.output, null, 2));
