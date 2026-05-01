#!/usr/bin/env tsx
// Paid skill call demo (E1). Single process, real on-chain settlement.
//
// Story:
//   1. Alice + bob loaded from disk. Bob's runtime requires payment.
//   2. Alice asks the KH Direct Execute API to move 0.01 USDC from the KH
//      Turnkey wallet to bob's recipient address on Sepolia (real tx).
//   3. Alice signs the receipt with her AXL ed25519 key. The signature
//      binds the receipt to her identity — a stolen receipt cannot be
//      replayed by another caller because the agent re-checks
//      receipt.sig against req.callerPubkey.
//   4. Alice calls bob.summarize over LocalBus, attaching the signed
//      receipt. Bob's runtime verifies amount/recipient/network/skill/sig
//      before invoking the skill. Reply is signed and returned.
//   5. Bob writes a RepAttestation to 0G Storage as usual.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  Compute,
  KhDirectExecuteAdapter,
  RepChain,
  Storage,
  makeSigner,
} from "@agentdir/sdk";
import {
  Agent,
  LocalBusClient,
  callSkill,
  loadOrCreate,
  signDigest,
  SkillRegistry,
  SUMMARIZE,
} from "@agentdir/agent";

const REPO = join(import.meta.dirname ?? "", "..", "..", "..");
const envPath = join(REPO, ".env.local");
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && m[1] && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const need = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} missing`);
  return v;
};

const step = (n: number, s: string) => console.log(`\n\x1b[1m${n}. ${s}\x1b[0m`);

async function main() {
  const SEPOLIA = "11155111";
  const USDC = need("SEPOLIA_USDC_ADDR");
  const KH_KEY = need("KEEPERHUB_ORG_KEY");
  const ZEROG = need("ZEROG_API_KEY");
  const PK = need("PRIVATE_KEY");

  step(1, "load alice + bob identities");
  const alice = await loadOrCreate("alice", null);
  const bob = await loadOrCreate("bob", null);
  console.log(`   alice axl=${alice.axlPubkeyHex.slice(0, 16)}…`);
  console.log(`   bob   axl=${bob.axlPubkeyHex.slice(0, 16)}…`);

  // Bob's recipient EVM addr = our shared wallet. In a real deployment each
  // agent would have its own wallet via mint flow. For the hackathon demo,
  // both agents are operated by the same human, so the shared wallet is
  // both the iNFT owner and the payment recipient.
  const recipient = "0xb9c58185d09D0aCf3b237cD45C67345E32e628BA";

  step(2, "boot bob's runtime (requires payment)");
  const bobBus = new LocalBusClient(bob.axlPubkeyHex);
  const aliceBus = new LocalBusClient(alice.axlPubkeyHex);
  const compute = new Compute({
    apiKey: ZEROG,
    network: "testnet",
    model: process.env.ZEROG_MODEL ?? "qwen/qwen-2.5-7b-instruct",
  });
  const signer = makeSigner(PK);
  const storage = new Storage({ signer });
  const repChain = new RepChain(storage);
  const skills = new SkillRegistry().add(SUMMARIZE);
  const bobAgent = new Agent({
    identity: bob,
    axl: bobBus as any,
    compute,
    storage,
    rep: repChain,
    skills,
    requirePayment: true,
    paymentExpectations: {
      recipient,
      tokenAddress: USDC,
      network: SEPOLIA,
    },
  });
  const bobLoop = bobAgent.start();

  step(3, "alice settles 0.01 USDC via KH Direct Execute (real Sepolia tx)");
  const adapter = new KhDirectExecuteAdapter({
    apiKey: KH_KEY,
    tokenAddress: USDC,
    tokenSymbol: "USDC",
    network: SEPOLIA,
  });
  const t0 = Date.now();
  const receipt = await adapter.settle({
    amount: "0.01",
    recipient,
    skill: "summarize",
    callerPubkey: alice.axlPubkeyHex,
    signer: (digest) => signDigest(alice, digest),
  });
  console.log(`   settled in ${Date.now() - t0}ms`);
  console.log(`   tx:           https://sepolia.etherscan.io/tx/${receipt.txHash}`);
  console.log(`   executionId:  ${receipt.executionId}`);
  console.log(`   receipt sig:  ${receipt.sig.slice(0, 24)}…`);

  step(4, "alice → bob.summarize (paid, signed receipt attached)");
  const callT0 = Date.now();
  const res = await callSkill({
    axl: aliceBus as any,
    destPubkey: bob.axlPubkeyHex,
    callerPubkey: alice.axlPubkeyHex,
    skill: "summarize",
    input: {
      text: "Agentdir lets agents pay each other in stablecoins per skill call. Reputation lives on 0G Storage. Identity lives in ENS + iNFTs.",
    },
    callerINFT: alice.inftTokenId,
    payment: receipt,
  });
  console.log(`   ok in ${Date.now() - callT0}ms`);
  console.log(`   summary: ${(res.output as any).summary}`);

  step(5, "bob's reputation attestation → 0G Storage");
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline && !repChain.head) {
    await new Promise((r) => setTimeout(r, 500));
  }
  if (repChain.head) {
    console.log(`   rep head rootHash: ${repChain.head}`);
  } else {
    console.log("   (attestation upload still in flight, skipping)");
  }

  bobAgent.stop();
  await Promise.race([bobLoop, new Promise((r) => setTimeout(r, 2000))]);

  console.log("\n✅ paid demo complete\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
