import "server-only";

import { randomBytes } from "node:crypto";
import { isAddress, verifyMessage } from "viem";
import { getDb, ensureIndexes } from "./db";

// Single-use, TTL'd challenge nonces. Mongo TTL index drops expired
// nonces automatically (see ensureIndexes). consumedAt is set atomically
// on first verify to prevent replay.

const NONCE_TTL_SEC = 60;
const NONCE_BYTES = 16;

type Action = "mint" | "snapshot" | "transfer" | "skill-edit";

export interface Challenge {
  nonce: string;
  message: string;
  expiresAt: Date;
}

function buildMessage(action: Action, ownerAddress: string, ens: string, nonce: string): string {
  // Human-readable, anchors who/what/why so a malicious dapp can't trick
  // a user into signing something reusable elsewhere. Nonce prevents replay.
  return [
    "agentdir authorization",
    `action: ${action}`,
    `owner: ${ownerAddress.toLowerCase()}`,
    `ens: ${ens}`,
    `nonce: ${nonce}`,
    `expires: ${NONCE_TTL_SEC}s`,
  ].join("\n");
}

export async function issueChallenge(input: {
  action: Action;
  ownerAddress: string;
  ens: string;
}): Promise<Challenge> {
  if (!isAddress(input.ownerAddress)) throw new Error("bad ownerAddress");
  if (!["mint", "snapshot", "transfer", "skill-edit"].includes(input.action)) {
    throw new Error("unsupported action");
  }

  await ensureIndexes();
  const nonce = randomBytes(NONCE_BYTES).toString("hex");
  const message = buildMessage(input.action, input.ownerAddress, input.ens, nonce);
  const expiresAt = new Date(Date.now() + NONCE_TTL_SEC * 1000);

  const db = await getDb();
  await db.collection("auth_nonces").insertOne({
    _id: nonce,
    ownerAddress: input.ownerAddress.toLowerCase(),
    ens: input.ens,
    action: input.action,
    message,
    expiresAt,
    consumedAt: null,
  } as any);

  return { nonce, message, expiresAt };
}

export interface VerifyResult {
  ok: boolean;
  reason?: string;
}

export async function verifyAndConsume(input: {
  ownerAddress: string;
  ens: string;
  message: string;
  signature: `0x${string}`;
}): Promise<VerifyResult> {
  if (!isAddress(input.ownerAddress)) return { ok: false, reason: "bad ownerAddress" };

  // Parse nonce out of message (last line `nonce: <hex>`).
  const m = input.message.match(/\nnonce: ([0-9a-f]{32})\n/);
  if (!m) return { ok: false, reason: "message missing nonce" };
  const nonce = m[1];

  // Atomic consume: only succeed if nonce row exists, isn't consumed,
  // and matches owner+ens. findOneAndUpdate avoids the time-of-check vs
  // time-of-use race that two parallel mints could exploit.
  const db = await getDb();
  const consumed = await db.collection("auth_nonces").findOneAndUpdate(
    {
      _id: nonce,
      ownerAddress: input.ownerAddress.toLowerCase(),
      ens: input.ens,
      consumedAt: null,
      expiresAt: { $gt: new Date() },
    } as any,
    { $set: { consumedAt: new Date() } },
    { returnDocument: "before" },
  );
  if (!consumed) return { ok: false, reason: "nonce missing, expired, or replayed" };
  if (consumed.message !== input.message) return { ok: false, reason: "message mismatch" };

  // Verify the signature finally.
  let valid = false;
  try {
    valid = await verifyMessage({
      address: input.ownerAddress as `0x${string}`,
      message: input.message,
      signature: input.signature,
    });
  } catch {
    valid = false;
  }
  if (!valid) {
    // Optimistically un-consume so a typo doesn't burn the user's nonce.
    // Race-free because we just consumed it; nobody else has it.
    await db
      .collection("auth_nonces")
      .updateOne({ _id: nonce } as any, { $set: { consumedAt: null } });
    return { ok: false, reason: "signature did not verify" };
  }
  return { ok: true };
}
