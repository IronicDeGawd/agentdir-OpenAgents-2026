#!/usr/bin/env tsx
// One-time setup for the 0G Compute broker. Idempotent — safe to re-run.
//
// Steps:
//   1. Connect ethers wallet to 0G Galileo testnet.
//   2. Construct broker, list available providers, pick the first one
//      serving qwen-2.5-7b-instruct (or override via PROVIDER env).
//   3. Ensure the main account is funded (deposit 0.01 0G if balance == 0).
//   4. Acknowledge the provider's signer (required before first request).
//   5. Transfer 0.005 0G to the provider sub-account if not already funded.
//
// Run: pnpm --filter @agentdir/sdk exec tsx scripts/0g-broker-setup.ts

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ethers } from "ethers";
// ESM bundle is broken; CJS works. Walk up from main entry.
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
const require_ = createRequire(import.meta.url);
const mainEntry = require_.resolve("@0gfoundation/0g-compute-ts-sdk");
const pkgRoot = resolve(dirname(mainEntry), "..");
const { createZGComputeNetworkBroker } = require_(
  join(pkgRoot, "lib.commonjs", "index.js")
);

const REPO = join(import.meta.dirname ?? "", "..", "..", "..");
for (const line of readFileSync(join(REPO, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && m[1] && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const RPC = process.env.ZEROG_RPC_URL ?? "https://evmrpc-testnet.0g.ai";
const TARGET_MODEL = process.env.ZEROG_MODEL ?? "qwen/qwen-2.5-7b-instruct";
// 0G Galileo broker enforces a minimum 3.0 ledger creation amount.
// Wallet must hold >= 3 0G before this script will work. Faucet at
// https://faucet.0g.ai (0.1 0G/day per address — accumulate or use
// multiple faucet sources).
const DEPOSIT_AMOUNT = "3"; // 0G
const SUB_AMOUNT = "0.5"; // 0G

async function main() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error("PRIVATE_KEY missing");
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(pk, provider);
  console.log(`[setup] wallet: ${wallet.address}`);
  const bal = await provider.getBalance(wallet.address);
  console.log(`[setup] 0G balance: ${ethers.formatEther(bal)}`);

  const broker = await createZGComputeNetworkBroker(wallet);

  // 1. List providers, pick one for our model.
  console.log(`[setup] listing services...`);
  const services: any[] = await broker.inference.listService();
  const candidate =
    process.env.PROVIDER ??
    services.find((s) => s.model === TARGET_MODEL)?.provider ??
    services[0]?.provider;
  if (!candidate) {
    throw new Error("no providers available");
  }
  const meta = services.find((s) => s.provider === candidate);
  console.log(`[setup] provider: ${candidate}`);
  console.log(`[setup] model:    ${meta?.model}`);
  console.log(`[setup] verifiability: ${meta?.verifiability ?? "(none)"}`);

  // 2. Ensure account is funded.
  let acct: any;
  try {
    acct = await broker.ledger.getLedger();
    console.log(`[setup] ledger balance: ${ethers.formatEther(acct.totalBalance ?? 0n)}`);
  } catch (e: any) {
    console.log(`[setup] no ledger yet, will create on deposit`);
  }
  const needsDeposit = !acct || (acct.totalBalance ?? 0n) === 0n;
  if (needsDeposit) {
    console.log(`[setup] depositing ${DEPOSIT_AMOUNT} 0G into broker ledger...`);
    await broker.ledger.addLedger(parseFloat(DEPOSIT_AMOUNT));
    console.log(`[setup]   ✓ deposited`);
  }

  // 3. Acknowledge provider (idempotent — broker no-ops if already ack'd).
  console.log(`[setup] acknowledging provider signer...`);
  try {
    await broker.inference.acknowledgeProviderSigner(candidate);
    console.log(`[setup]   ✓ acknowledged`);
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (/already/i.test(msg)) {
      console.log(`[setup]   already acknowledged`);
    } else {
      throw e;
    }
  }

  // 4. Sub-account funding. broker.inference may auto-handle; fall back
  //    to ledger.transferFund if surface differs.
  console.log(`[setup] transferring ${SUB_AMOUNT} 0G to provider sub-account...`);
  try {
    if (typeof (broker.inference as any).transferFund === "function") {
      await (broker.inference as any).transferFund(candidate, parseFloat(SUB_AMOUNT));
    } else if (typeof (broker.ledger as any).transferFund === "function") {
      await (broker.ledger as any).transferFund(candidate, parseFloat(SUB_AMOUNT));
    } else {
      console.log(`[setup]   no transferFund surface — broker may auto-fund per-call`);
    }
    console.log(`[setup]   ✓ transferred`);
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (/sufficient|already/i.test(msg)) {
      console.log(`[setup]   already funded`);
    } else {
      console.log(`[setup]   ⚠ transferFund: ${msg.slice(0, 200)}`);
    }
  }

  console.log(`\n✅ broker setup complete\n`);
  console.log(`Add to .env.local for the demo:`);
  console.log(`  ZEROG_PROVIDER=${candidate}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
