// Payment adapters for paid skill calls (E1 — KH x402 paid skills).
//
// Receipt model:
//   1. Caller adapter settles (USDC transfer) and returns a Receipt blob.
//   2. Caller signs the receipt body with its AXL ed25519 key. Sig binds the
//      receipt to the caller — a stolen receipt can't be replayed by another
//      identity because the agent re-checks signerPubkey == req.callerPubkey.
//   3. Callee agent verifies the sig in `verifyReceipt` (AXL pubkey known
//      from the SkillRequest envelope). Optional onchain readback can be
//      layered on later — sig + tx hash + executionId is enough for v1.
//
// The first adapter implementation hits KH's Direct Execution API
// (POST /api/execute/transfer). It works on any KH-supported chain
// (Sepolia, Base, etc.) and returns a real on-chain ERC-20 Transfer tx.
// Switching to Base mainnet USDC = swap two strings (network + tokenAddress).

import { keccak256, toHex } from "viem";
import * as ed from "@noble/ed25519";
import { canonicalJson } from "./agent-card.js";

export type PaymentReceiptBody = {
  v: 1;
  kind: "kh-direct" | "x402";
  /** Settlement amount, decimal string (e.g. "0.05"). */
  amount: string;
  /** ERC-20 token address that moved. */
  tokenAddress: string;
  /** Token symbol for display only. */
  tokenSymbol: string;
  /** Chain id as a decimal string ("11155111", "8453"). */
  network: string;
  /** EVM address of the agent that received funds. */
  recipient: string;
  /** Onchain tx hash. */
  txHash: string;
  /** KH execution id (or empty string for non-KH adapters). */
  executionId: string;
  /** Caller AXL pubkey hex (32B, no 0x). */
  callerPubkey: string;
  /** Skill id this payment authorizes. Binds the receipt to the call. */
  skill: string;
  /** Unix seconds at settlement time. */
  ts: number;
};

export type PaymentReceipt = PaymentReceiptBody & {
  /** ed25519(canonicalJson(body)) by caller. */
  sig: string;
};

const stripHex = (h: string) => (h.startsWith("0x") ? h.slice(2) : h);

export function receiptDigest(body: PaymentReceiptBody): `0x${string}` {
  return keccak256(toHex(canonicalJson(body)));
}

/** Sign a receipt body with the caller's AXL ed25519 key. */
export async function signReceipt(
  body: PaymentReceiptBody,
  signer: (digestHex: `0x${string}`) => Promise<string>
): Promise<PaymentReceipt> {
  const sig = await signer(receiptDigest(body));
  return { ...body, sig };
}

/**
 * Verify the signature on a receipt against an expected caller pubkey.
 * Returns false on any error (bad hex, sig forge, mismatched pubkey).
 */
export async function verifyReceipt(
  receipt: PaymentReceipt,
  callerAxlPubkeyHex: string
): Promise<boolean> {
  try {
    const { sig, ...body } = receipt;
    const digest = receiptDigest(body);
    const sigBytes = Buffer.from(stripHex(sig), "hex");
    const pubBytes = Buffer.from(stripHex(callerAxlPubkeyHex), "hex");
    const msgBytes = Buffer.from(stripHex(digest), "hex");
    return await ed.verifyAsync(sigBytes, msgBytes, pubBytes);
  } catch {
    return false;
  }
}

/** Strict cross-check that receipt fields match what the agent expected. */
export type PaymentExpectations = {
  amount: string;
  tokenAddress: string;
  network: string;
  recipient: string;
  callerPubkey: string;
  skill: string;
  /** Max receipt age in ms; default 5 minutes. */
  maxAgeMs?: number;
};

/** Returns null on pass, or a string reason on mismatch. Caller can format the rejection. */
export function checkReceiptShape(
  receipt: PaymentReceipt,
  exp: PaymentExpectations
): string | null {
  const max = exp.maxAgeMs ?? 5 * 60_000;
  const age = Date.now() - receipt.ts * 1000;
  if (age > max || age < -max) return `receipt ts skew ${age}ms`;
  if (receipt.amount !== exp.amount) return `amount mismatch (got ${receipt.amount}, want ${exp.amount})`;
  if (receipt.tokenAddress.toLowerCase() !== exp.tokenAddress.toLowerCase())
    return `token mismatch`;
  if (receipt.network !== exp.network) return `network mismatch`;
  if (receipt.recipient.toLowerCase() !== exp.recipient.toLowerCase())
    return `recipient mismatch`;
  if (receipt.callerPubkey.toLowerCase() !== stripHex(exp.callerPubkey).toLowerCase())
    return `callerPubkey mismatch`;
  if (receipt.skill !== exp.skill) return `skill mismatch`;
  return null;
}

// ---------------------------------------------------------------------
// Adapter contract — concrete impl below.
// ---------------------------------------------------------------------

export type SettleArgs = {
  /** Decimal string, e.g. "0.05". */
  amount: string;
  /** Receiving agent's EVM address. */
  recipient: string;
  /** Skill id being paid for; bound into the receipt. */
  skill: string;
  /** Caller AXL pubkey hex (32 bytes, with or without 0x). */
  callerPubkey: string;
  /** Caller signer, returns ed25519 hex of the receipt digest. */
  signer: (digestHex: `0x${string}`) => Promise<string>;
};

export interface PaymentAdapter {
  /** Move funds + return a signed receipt. Throws if settlement fails. */
  settle(args: SettleArgs): Promise<PaymentReceipt>;
}

// ---------------------------------------------------------------------
// KH Direct Execute adapter — POST /api/execute/transfer + poll status.
// ---------------------------------------------------------------------

export type KhDirectExecuteAdapterOpts = {
  /** kh_ org API key. */
  apiKey: string;
  /** ERC-20 token address (e.g. Sepolia USDC). */
  tokenAddress: string;
  /** Token symbol for receipt display ("USDC"). */
  tokenSymbol: string;
  /** Chain id as decimal string ("11155111" for Sepolia, "8453" for Base). */
  network: string;
  /** Override REST base. Default https://app.keeperhub.com/api. */
  baseUrl?: string;
  /** Polling timeout for execution status in ms. Default 60s. */
  timeoutMs?: number;
};

export class KhDirectExecuteAdapter implements PaymentAdapter {
  readonly opts: KhDirectExecuteAdapterOpts;
  readonly baseUrl: string;
  readonly timeoutMs: number;

  constructor(opts: KhDirectExecuteAdapterOpts) {
    this.opts = opts;
    this.baseUrl = opts.baseUrl ?? "https://app.keeperhub.com/api";
    this.timeoutMs = opts.timeoutMs ?? 60_000;
  }

  async settle(args: SettleArgs): Promise<PaymentReceipt> {
    // 1. Trigger transfer.
    const initRes = await fetch(`${this.baseUrl}/execute/transfer`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.opts.apiKey}`,
      },
      body: JSON.stringify({
        network: this.opts.network,
        recipientAddress: args.recipient,
        amount: args.amount,
        tokenAddress: this.opts.tokenAddress,
      }),
    });
    if (!initRes.ok) {
      const text = await initRes.text().catch(() => "");
      throw new Error(`KH transfer init ${initRes.status}: ${text.slice(0, 300)}`);
    }
    const initJson = (await initRes.json()) as {
      executionId: string;
      status: string;
    };
    const executionId = initJson.executionId;
    if (!executionId) throw new Error("KH response missing executionId");

    // 2. Poll until terminal. Direct execute often returns "completed"
    //    on the init call (synchronous), but treat "pending"/"running" as
    //    valid pre-settlement states.
    const deadline = Date.now() + this.timeoutMs;
    let status = initJson.status;
    let txHash: string | null = null;
    let lastBody: any = initJson;
    while (Date.now() < deadline) {
      if (status === "completed" || status === "success") break;
      if (status === "failed" || status === "error" || status === "cancelled")
        throw new Error(`KH transfer ${status}: ${JSON.stringify(lastBody).slice(0, 300)}`);
      await new Promise((r) => setTimeout(r, 1500));
      const sRes = await fetch(`${this.baseUrl}/execute/${executionId}/status`, {
        headers: { Authorization: `Bearer ${this.opts.apiKey}` },
      });
      if (!sRes.ok) continue;
      lastBody = await sRes.json();
      status = lastBody.status;
      if (lastBody.transactionHash) txHash = lastBody.transactionHash;
    }
    if (status !== "completed" && status !== "success")
      throw new Error(`KH transfer timeout (last status=${status})`);

    // 3. Read final tx hash.
    if (!txHash) {
      const sRes = await fetch(`${this.baseUrl}/execute/${executionId}/status`, {
        headers: { Authorization: `Bearer ${this.opts.apiKey}` },
      });
      if (sRes.ok) {
        const body: any = await sRes.json();
        txHash = body.transactionHash ?? body.result?.transactionHash ?? null;
      }
    }
    if (!txHash) throw new Error("KH transfer succeeded but transactionHash missing");

    // 4. Build + sign receipt.
    const body: PaymentReceiptBody = {
      v: 1,
      kind: "kh-direct",
      amount: args.amount,
      tokenAddress: this.opts.tokenAddress,
      tokenSymbol: this.opts.tokenSymbol,
      network: this.opts.network,
      recipient: args.recipient,
      txHash,
      executionId,
      callerPubkey: stripHex(args.callerPubkey),
      skill: args.skill,
      ts: Math.floor(Date.now() / 1000),
    };
    return signReceipt(body, args.signer);
  }
}
