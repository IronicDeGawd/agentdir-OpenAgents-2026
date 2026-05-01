// agentdir publish --handle alice --ens alice.somename.eth [--rep-head <root>]
// Build the agentdir record bundle from the local identity + on-chain iNFT
// + reputation head, and setText on the Sepolia PublicResolver.
// Requires that PRIVATE_KEY owns the ENS name on Sepolia.

import { buildAgentCard, EnsWriter, SUMMARIZE_DEF, SENTIMENT_DEF } from "./skill-defs.js";
import { loadOrCreate } from "@agentdir/agent";
import { require_ } from "./env.js";
import type { Hex } from "viem";

export async function publish(args: { handle: string; ens: string; repHead?: string }) {
  const id = await loadOrCreate(args.handle, null);
  if (!id.inftContract || !id.inftTokenId) {
    console.error("identity has no iNFT yet — run `agentdir mint` first");
    process.exit(2);
  }

  const card = buildAgentCard({
    name: args.ens,
    description: `agentdir agent ${args.handle}`,
    axlPubkey: id.axlPubkeyHex,
    skills: [SUMMARIZE_DEF, SENTIMENT_DEF],
    erc7857: { chainId: 16602, contract: id.inftContract, tokenId: id.inftTokenId },
    repHead: args.repHead,
  });

  const writer = new EnsWriter({
    privateKey: ("0x" + require_("PRIVATE_KEY").replace(/^0x/, "")) as Hex,
  });
  const bundle = EnsWriter.bundleFromCard(card, {
    "network.axl.bootstrap": process.env.AXL_BOOTSTRAP ?? "",
  });

  console.log(`[publish] ${args.ens} ← ${Object.keys(bundle).length} records`);
  for (const k of Object.keys(bundle)) console.log(`  - ${k}`);

  const txs = await writer.publishBundle(args.ens, bundle);
  console.log(`[publish] sent ${txs.length} txs`);
  for (const tx of txs) console.log(`  https://sepolia.etherscan.io/tx/${tx}`);
}
