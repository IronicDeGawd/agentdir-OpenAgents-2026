import { test } from "node:test";
import assert from "node:assert/strict";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import {
  signReceipt,
  verifyReceipt,
  checkReceiptShape,
  KhDirectExecuteAdapter,
  type PaymentReceiptBody,
  type PaymentExpectations,
} from "./payments.js";

ed.etc.sha512Async = (...m) => Promise.resolve(sha512(ed.etc.concatBytes(...m)));
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

async function mkSigner() {
  const priv = ed.utils.randomPrivateKey();
  const pub = await ed.getPublicKeyAsync(priv);
  const pubHex = Buffer.from(pub).toString("hex");
  const signer = async (digestHex: `0x${string}`) => {
    const msg = Buffer.from(digestHex.slice(2), "hex");
    const sig = await ed.signAsync(msg, priv);
    return "0x" + Buffer.from(sig).toString("hex");
  };
  return { pubHex, signer };
}

const makeBody = (over: Partial<PaymentReceiptBody> = {}): PaymentReceiptBody => ({
  v: 1,
  kind: "kh-direct",
  amount: "0.05",
  tokenAddress: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  tokenSymbol: "USDC",
  network: "11155111",
  recipient: "0xb9c58185d09D0aCf3b237cD45C67345E32e628BA",
  txHash: "0x" + "ab".repeat(32),
  executionId: "exec_abc",
  callerPubkey: "ff".repeat(32),
  skill: "summarize",
  ts: Math.floor(Date.now() / 1000),
  ...over,
});

const baseExp = (callerPubkey: string): PaymentExpectations => ({
  amount: "0.05",
  tokenAddress: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  network: "11155111",
  recipient: "0xb9c58185d09D0aCf3b237cD45C67345E32e628BA",
  callerPubkey,
  skill: "summarize",
});

test("signReceipt + verifyReceipt roundtrip", async () => {
  const { pubHex, signer } = await mkSigner();
  const body = makeBody({ callerPubkey: pubHex });
  const r = await signReceipt(body, signer);
  assert.equal(await verifyReceipt(r, pubHex), true);
});

test("verifyReceipt fails under wrong pubkey", async () => {
  const { pubHex, signer } = await mkSigner();
  const other = await ed.getPublicKeyAsync(ed.utils.randomPrivateKey());
  const otherHex = Buffer.from(other).toString("hex");
  const r = await signReceipt(makeBody({ callerPubkey: pubHex }), signer);
  assert.equal(await verifyReceipt(r, otherHex), false);
});

test("checkReceiptShape passes on matching receipt", async () => {
  const { pubHex, signer } = await mkSigner();
  const r = await signReceipt(makeBody({ callerPubkey: pubHex }), signer);
  assert.equal(checkReceiptShape(r, baseExp(pubHex)), null);
});

test("checkReceiptShape rejects amount mismatch", async () => {
  const { pubHex, signer } = await mkSigner();
  const r = await signReceipt(makeBody({ callerPubkey: pubHex, amount: "0.10" }), signer);
  assert.match(checkReceiptShape(r, baseExp(pubHex)) ?? "", /amount mismatch/);
});

test("checkReceiptShape rejects recipient mismatch", async () => {
  const { pubHex, signer } = await mkSigner();
  const r = await signReceipt(
    makeBody({ callerPubkey: pubHex, recipient: "0x" + "11".repeat(20) }),
    signer
  );
  assert.match(checkReceiptShape(r, baseExp(pubHex)) ?? "", /recipient mismatch/);
});

test("checkReceiptShape rejects skill mismatch", async () => {
  const { pubHex, signer } = await mkSigner();
  const r = await signReceipt(makeBody({ callerPubkey: pubHex, skill: "sentiment" }), signer);
  assert.match(checkReceiptShape(r, baseExp(pubHex)) ?? "", /skill mismatch/);
});

test("checkReceiptShape rejects stale ts", async () => {
  const { pubHex, signer } = await mkSigner();
  const oldTs = Math.floor(Date.now() / 1000) - 24 * 3600;
  const r = await signReceipt(makeBody({ callerPubkey: pubHex, ts: oldTs }), signer);
  assert.match(checkReceiptShape(r, baseExp(pubHex)) ?? "", /ts skew/);
});

test("KhDirectExecuteAdapter.settle uses fetch and returns signed receipt", async () => {
  // Stub global fetch.
  const origFetch = globalThis.fetch;
  let callCount = 0;
  globalThis.fetch = (async (url: string, init?: any) => {
    callCount += 1;
    if (callCount === 1) {
      // /execute/transfer init
      assert.match(String(url), /\/execute\/transfer$/);
      const body = JSON.parse(init.body);
      assert.equal(body.network, "11155111");
      assert.equal(body.amount, "0.07");
      return new Response(
        JSON.stringify({
          executionId: "exec_xyz",
          status: "completed",
          transactionHash: "0xdeadbeef" + "00".repeat(28),
        }),
        { status: 200 }
      );
    }
    // /execute/{id}/status (final txhash readback)
    return new Response(
      JSON.stringify({ status: "completed", transactionHash: "0xdeadbeef" + "00".repeat(28) }),
      { status: 200 }
    );
  }) as any;

  try {
    const { pubHex, signer } = await mkSigner();
    const adapter = new KhDirectExecuteAdapter({
      apiKey: "kh_test",
      tokenAddress: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
      tokenSymbol: "USDC",
      network: "11155111",
    });
    const receipt = await adapter.settle({
      amount: "0.07",
      recipient: "0xb9c58185d09D0aCf3b237cD45C67345E32e628BA",
      skill: "summarize",
      callerPubkey: pubHex,
      signer,
    });
    assert.equal(receipt.kind, "kh-direct");
    assert.equal(receipt.amount, "0.07");
    assert.equal(receipt.executionId, "exec_xyz");
    assert.equal(receipt.txHash, "0xdeadbeef" + "00".repeat(28));
    assert.equal(receipt.skill, "summarize");
    assert.equal(receipt.callerPubkey, pubHex);
    assert.equal(await verifyReceipt(receipt, pubHex), true);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("KhDirectExecuteAdapter.settle throws on KH failure", async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        executionId: "exec_fail",
        status: "failed",
        error: "Insufficient USDC balance",
      }),
      { status: 200 }
    )) as any;
  try {
    const { pubHex, signer } = await mkSigner();
    const adapter = new KhDirectExecuteAdapter({
      apiKey: "kh_test",
      tokenAddress: "0x" + "01".repeat(20),
      tokenSymbol: "USDC",
      network: "11155111",
      timeoutMs: 1000,
    });
    await assert.rejects(
      () =>
        adapter.settle({
          amount: "0.05",
          recipient: "0x" + "02".repeat(20),
          skill: "x",
          callerPubkey: pubHex,
          signer,
        }),
      /KH transfer failed/
    );
  } finally {
    globalThis.fetch = origFetch;
  }
});
