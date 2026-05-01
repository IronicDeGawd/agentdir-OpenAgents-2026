// agentdir state-history --handle alice [--limit 20] [--verify]
// Walks AgentStateUpdated events for the agent's iNFT token. Optionally
// downloads + verifies each snapshot blob.

import { ethers } from "ethers";
import { InftWriter, SnapshotChain, Storage, makeSigner } from "@agentdir/sdk";
import { loadOrCreate } from "@agentdir/agent";
import { loadDeployment } from "./deployment.js";
import { require_ } from "./env.js";

const ZERO = "0x" + "00".repeat(32);

export async function stateHistory(args: { handle: string; limit?: number; verify?: boolean }) {
  const dep = loadDeployment();
  const id = await loadOrCreate(args.handle, null);
  if (!id.inftTokenId) throw new Error(`identity '${args.handle}' has no inftTokenId`);

  const provider = new ethers.JsonRpcProvider(dep.rpcUrl);
  const inft = new InftWriter({ contract: dep.AgentdirINFT.address, provider });

  console.log(`[state-history] handle=${id.handle} token=${id.inftTokenId}`);
  console.log(`[state-history] querying AgentStateUpdated from block ${dep.AgentdirINFT.block}...`);

  const events = await inft.stateHistory(id.inftTokenId, dep.AgentdirINFT.block);
  if (events.length === 0) {
    console.log(`[state-history] no state updates yet`);
    return;
  }

  const limit = args.limit ?? 20;
  const slice = events.slice(-limit).reverse(); // newest first
  console.log(`[state-history] ${events.length} total events, showing ${slice.length}:\n`);

  for (const ev of slice) {
    console.log(`  block ${ev.blockNumber}  by ${ev.by}`);
    console.log(`    prev:    ${ev.prevRoot}`);
    console.log(`    new:     ${ev.newRoot}`);
    console.log(`    tx:      ${ev.txHash}`);

    if (args.verify && ev.newRoot !== ZERO) {
      const pk = require_("PRIVATE_KEY");
      const signer = makeSigner(pk, dep.rpcUrl);
      const storage = new Storage({ signer });
      try {
        const snap = await storage.getJson<any>(ev.newRoot);
        const ok = await SnapshotChain.verify(snap, id.axlPubkeyHex);
        console.log(`    blob:    ${ok ? "verified ✓" : "verify FAILED"}`);
        console.log(`    ts:      ${new Date(snap.ts * 1000).toISOString()}`);
        console.log(`    calls:   ${snap.callsTotal} (${snap.okTotal} ok)`);
      } catch (e: any) {
        console.log(`    blob:    download failed (${e?.message ?? e})`);
      }
    }
    console.log();
  }
}
