#!/usr/bin/env tsx
// End-to-end agentdir demo, single process, no AXL.
//
// Story (judge-watchable):
//   1. Two agents loaded from disk (alice, bob), each with persistent
//      ed25519 identity. Their ENS records on Sepolia + iNFTs on 0G Galileo
//      were already published (see context/progress.md).
//   2. Alice resolves bob.agentdir.eth via the *real* Sepolia Universal
//      Resolver — recovers AXL pubkey, iNFT id, skill list. Zero local trust.
//   3. Bob's agent runtime starts on a LocalBusClient (in-process AXL
//      stand-in). Skills wired: summarize + sentiment (via 0G Compute).
//   4. Alice calls bob's `summarize`. Request signed by alice's key, sent
//      over LocalBus. Bob runs inference on 0G Compute, signs response with
//      his agent key, replies. Alice verifies the sig against the
//      ENS-published pubkey — proves identity binding works end-to-end.
//   5. Bob writes a signed RepAttestation to 0G Storage. RootHash printed —
//      a permanent on-chain audit trail of the call.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";
import { normalize } from "viem/ens";
import {
  Compute,
  RepChain,
  Storage,
  makeSigner,
} from "@agentdir/sdk";
import {
  Agent,
  LocalBusClient,
  callSkill,
  loadOrCreate,
  SkillRegistry,
  SUMMARIZE,
  SENTIMENT,
} from "@agentdir/agent";

// ── env ──
const REPO = join(import.meta.dirname ?? "", "..", "..", "..");
const envPath = join(REPO, ".env.local");
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && m[1] && !process.env[m[1]]) process.env[m[1]] = m[2];
}
if (!process.env.PRIVATE_KEY) throw new Error("PRIVATE_KEY missing");
if (!process.env.ZEROG_API_KEY) throw new Error("ZEROG_API_KEY missing");

// ── helpers ──
const step = (n: number, s: string) => console.log(`\n\x1b[1m${n}. ${s}\x1b[0m`);

async function main() {
  // 1. Load identities
  step(1, "load alice + bob identities (persistent ed25519, on disk)");
  const alice = await loadOrCreate("alice", null);
  const bob = await loadOrCreate("bob", null);
  console.log(`   alice  axl=${alice.axlPubkeyHex.slice(0, 16)}…  iNFT=#${alice.inftTokenId}`);
  console.log(`   bob    axl=${bob.axlPubkeyHex.slice(0, 16)}…  iNFT=#${bob.inftTokenId}`);

  // 2. Resolve bob.agentdir.eth via Sepolia ENS
  step(2, "alice resolves bob.agentdir.eth on Sepolia Universal Resolver");
  const ensClient = createPublicClient({
    chain: sepolia,
    transport: http(process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com"),
  });
  const resolvedPubkey = await ensClient.getEnsText({
    name: normalize("bob.agentdir.eth"),
    key: "network.axl.pubkey",
  });
  const resolvedTokenId = await ensClient.getEnsText({
    name: normalize("bob.agentdir.eth"),
    key: "org.erc7857.tokenId",
  });
  const cardJson = await ensClient.getEnsText({
    name: normalize("bob.agentdir.eth"),
    key: "org.a2a.agent-card",
  });
  if (!resolvedPubkey || !cardJson) throw new Error("bob has no agentdir records");
  const card = JSON.parse(cardJson);
  console.log(`   axl pubkey from ENS: ${resolvedPubkey.slice(0, 16)}…`);
  console.log(`   iNFT id from ENS:    #${resolvedTokenId}`);
  console.log(`   skills from card:    ${card.skills.map((s: any) => s.id).join(", ")}`);
  if (resolvedPubkey.toLowerCase() !== bob.axlPubkeyHex.toLowerCase()) {
    throw new Error("identity binding broken — ENS pubkey does not match disk identity");
  }
  console.log(`   ✓ ENS-published pubkey matches bob's local identity`);

  // 3. Set up bob's runtime
  step(3, "boot bob's agent runtime (LocalBus, skills via 0G Compute)");
  const bobBus = new LocalBusClient(bob.axlPubkeyHex);
  const aliceBus = new LocalBusClient(alice.axlPubkeyHex);
  const compute = new Compute({
    apiKey: process.env.ZEROG_API_KEY!,
    network: "testnet",
    model: process.env.ZEROG_MODEL ?? "qwen/qwen-2.5-7b-instruct",
  });
  const signer = makeSigner(process.env.PRIVATE_KEY!);
  const storage = new Storage({ signer });
  const repChain = new RepChain(storage);
  const skills = new SkillRegistry().add(SUMMARIZE).add(SENTIMENT);
  const bobAgent = new Agent({
    identity: bob,
    axl: bobBus as any,
    compute,
    storage,
    rep: repChain,
    skills,
  });
  // Background recv loop on bob.
  const bobLoop = bobAgent.start();

  // 4. Alice calls bob.summarize
  step(4, "alice → bob: summarize via LocalBus, response signed + verified");
  const t0 = Date.now();
  const res = await callSkill({
    axl: aliceBus as any,
    destPubkey: resolvedPubkey, // from ENS, not local
    callerPubkey: alice.axlPubkeyHex,
    skill: "summarize",
    input: {
      text: "AI agents can now find each other on Ethereum, settle reputation on 0G Storage, and own their identity as iNFTs",
    },
    callerINFT: alice.inftTokenId,
    expectedResponderPubkey: resolvedPubkey,
  });
  const ms = Date.now() - t0;
  console.log(`   ok in ${ms}ms`);
  console.log(`   summary: ${(res.output as any).summary}`);
  console.log(`   ✓ response signature verified against ENS-published pubkey`);

  // 5. Wait for bob's attestation to land on 0G Storage
  step(5, "bob's reputation attestation → 0G Storage");
  console.log("   uploading attestation (this calls 0G Storage indexer; ~30-60s)…");
  // Poll until the rep chain head appears — proves attestation upload finished.
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline && !repChain.head) {
    await new Promise((r) => setTimeout(r, 500));
  }
  const head = repChain.head;
  if (!head) {
    console.log(`   ✗ timeout: attestation did not finish uploading`);
  } else {
    console.log(`   ✓ rep head rootHash: ${head}`);
    const att = await repChain.getAt(head);
    console.log(`   caller=#${att.callerINFT}  callee=#${att.calleeINFT}  skill=${att.skill}  ok=${att.ok}  latency=${att.latencyMs}ms`);
    console.log(`   sig: ${att.sig.slice(0, 16)}…`);
  }

  bobAgent.stop();
  await Promise.race([bobLoop, new Promise((r) => setTimeout(r, 2_000))]);

  console.log("\n✅ demo complete\n");
  console.log("on-chain artifacts:");
  console.log(`   iNFT contract:  https://chainscan-galileo.0g.ai/address/0x3061d8567ce510dcaf079dc59f7313be094261b0`);
  console.log(`   alice ENS:      https://sepolia.app.ens.domains/alice.agentdir.eth`);
  console.log(`   bob   ENS:      https://sepolia.app.ens.domains/bob.agentdir.eth`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
