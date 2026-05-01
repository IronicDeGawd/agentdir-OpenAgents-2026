#!/usr/bin/env tsx
// TEE-verified inference demo (E9). Single process, real broker, real
// 0G provider, real on-chain ledger settlement, real ZG-Res-Key
// validation.
//
// Pre-req: scripts/0g-broker-setup.ts has been run AND the wallet has
// >= 3 0G on Galileo. Set ZEROG_PROVIDER in .env.local to the provider
// address printed by that setup script (defaults to qwen-2.5-7b-instruct
// TeeML provider).
//
// Story:
//   1. Bob's runtime is wired with DirectCompute against a TeeML provider.
//   2. Alice calls bob.summarize over LocalBus.
//   3. Bob runs inference; the broker validates the TEE attestation via
//      processResponse() + settles the per-call fee on-chain.
//   4. Bob writes a RepAttestation with the TEE attestation embedded —
//      now reputation carries cryptographic proof of inference, not
//      just "responder said it worked."
//   5. Print the rootHash; agentdir rep --head <root> --target <tokenId>
//      walks it and shows TEE✓ next to each verified entry.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ethers } from "ethers";
import {
  DirectCompute,
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
} from "@agentdir/agent";

const REPO = join(import.meta.dirname ?? "", "..", "..", "..");
for (const line of readFileSync(join(REPO, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && m[1] && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const need = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} missing — see context/progress.md for setup`);
  return v;
};
const step = (n: number, s: string) => console.log(`\n\x1b[1m${n}. ${s}\x1b[0m`);

async function main() {
  const PK = need("PRIVATE_KEY");
  const PROVIDER = need("ZEROG_PROVIDER"); // run 0g-broker-setup first
  const RPC = process.env.ZEROG_RPC_URL ?? "https://evmrpc-testnet.0g.ai";

  step(1, "load alice + bob identities");
  const alice = await loadOrCreate("alice", null);
  const bob = await loadOrCreate("bob", null);
  console.log(`   alice axl=${alice.axlPubkeyHex.slice(0, 16)}…`);
  console.log(`   bob   axl=${bob.axlPubkeyHex.slice(0, 16)}…`);

  step(2, "boot bob's runtime with DirectCompute against TeeML provider");
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(PK, provider);
  const compute = await DirectCompute.create({ signer: wallet, provider: PROVIDER });
  console.log(`   provider: ${PROVIDER}`);
  console.log(`   model:    ${compute.model}`);
  console.log(`   endpoint: ${compute.endpoint}`);

  const bobBus = new LocalBusClient(bob.axlPubkeyHex);
  const aliceBus = new LocalBusClient(alice.axlPubkeyHex);
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
  });
  const bobLoop = bobAgent.start();

  step(3, "alice → bob.summarize (TEE-verified inference)");
  const t0 = Date.now();
  const res = await callSkill({
    axl: aliceBus as any,
    destPubkey: bob.axlPubkeyHex,
    callerPubkey: alice.axlPubkeyHex,
    skill: "summarize",
    input: {
      text: "TEE attestations let agents prove inference came from a verified provider, not a forged response. processResponse settles fees and validates the attestation in one call.",
    },
    callerINFT: alice.inftTokenId,
  });
  console.log(`   ok in ${Date.now() - t0}ms`);
  console.log(`   summary: ${(res.output as any).summary}`);
  console.log(`   tee:     provider=${compute.lastTeeAttestation?.provider}`);
  console.log(`            chatID=${compute.lastTeeAttestation?.chatID}`);
  console.log(`            verified=${compute.lastTeeAttestation?.verified}`);

  step(4, "bob's reputation attestation → 0G Storage (with TEE field)");
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline && !repChain.head) {
    await new Promise((r) => setTimeout(r, 500));
  }
  if (repChain.head) {
    console.log(`   rep head: ${repChain.head}`);
    const att = await repChain.getAt(repChain.head);
    console.log(`   tee attestation embedded:`);
    console.log(`     provider: ${att.teeAttestation?.provider ?? "(none)"}`);
    console.log(`     chatID:   ${att.teeAttestation?.chatID ?? "(none)"}`);
    console.log(`     verified: ${att.teeAttestation?.verified ?? false}`);
  } else {
    console.log("   (attestation upload still in flight)");
  }

  bobAgent.stop();
  await Promise.race([bobLoop, new Promise((r) => setTimeout(r, 2000))]);

  console.log("\n✅ TEE-verified demo complete\n");
  if (repChain.head) {
    console.log(`Walk reputation chain (shows TEE✓ next to verified entries):`);
    console.log(`  agentdir rep --head ${repChain.head} --target ${bob.inftTokenId}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
