// agentdir snapshot --handle alice
// Manual memory snapshot rotation. Builds snapshot blob from local agent
// memory state (rep head from ENS + zero-counters since CLI is stateless),
// uploads to 0G Storage, then anchors rootHash on-chain via setAgentStateRoot.
//
// CLI is one-shot — has no in-process call counters. Counters in the snapshot
// reflect the snapshot moment ("manual rotation, no live counts available").
// For accurate counts use `Agent.snapshotNow()` from a long-running runtime.

import { ethers } from "ethers";
import {
  EnsResolver,
  InftWriter,
  SnapshotChain,
  Storage,
} from "@agentdir/sdk";
import { loadOrCreate, signDigest } from "@agentdir/agent";
import { loadDeployment } from "./deployment.js";
import { require_ } from "./env.js";

export async function snapshot(args: { handle: string }) {
  const dep = loadDeployment();
  const id = await loadOrCreate(args.handle, null);
  if (!id.inftTokenId) throw new Error(`identity '${args.handle}' has no inftTokenId — mint first`);

  const pk = require_("PRIVATE_KEY");
  // Single Wallet, single Provider — Storage and InftWriter both accept a Signer.
  const provider = new ethers.JsonRpcProvider(dep.rpcUrl);
  const wallet = new ethers.Wallet(pk, provider);
  const storage = new Storage({ signer: wallet });

  const head = await new EnsResolver({ network: "sepolia" })
    .getRecordBundle(id.ensName)
    .then((b) => b["network.agentdir.rep-head"] ?? null)
    .catch(() => null);

  const chain = new SnapshotChain(storage, null);
  const inft = new InftWriter({ contract: dep.AgentdirINFT.address, signer: wallet });

  const prevOnchain = await inft.getStateRoot(id.inftTokenId);
  console.log(`[snapshot] handle=${id.handle} token=${id.inftTokenId}`);
  console.log(`[snapshot] prev on-chain root: ${prevOnchain}`);
  console.log(`[snapshot] rep head: ${head ?? "(none)"}`);

  // Seed the snapshot chain head from the on-chain root if it's a real bytes32
  // pointing at a previous snapshot. If the on-chain root is 0x00..0, this is
  // the first rotation.
  const ZERO = "0x" + "00".repeat(32);
  if (prevOnchain && prevOnchain !== ZERO) chain.head = prevOnchain;

  console.log(`[snapshot] uploading blob to 0G Storage...`);
  const { root, snapshot: snap } = await chain.append({
    ensName: id.ensName,
    signerPubkey: id.axlPubkeyHex,
    inftTokenId: id.inftTokenId,
    callsTotal: 0,
    okTotal: 0,
    skillStats: {},
    repHead: head,
    signer: (digest) => signDigest(id, digest),
  });
  console.log(`[snapshot] new root: ${root}`);
  console.log(`[snapshot] prev linked: ${snap.prevSnapshotRoot ?? "(genesis)"}`);

  console.log(`[snapshot] anchoring on iNFT...`);
  const txHash = await inft.setStateRoot(id.inftTokenId, root);
  console.log(`[snapshot] tx: ${txHash}`);
  console.log(`[snapshot] explorer: ${dep.explorer}/tx/${txHash}`);
}
