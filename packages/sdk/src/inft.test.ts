import { test } from "node:test";
import assert from "node:assert/strict";
import { InftWriter } from "./inft.js";

// Stub provider just to satisfy the constructor's "needs signer or provider".
const stubProvider = {} as any;

test("setStateRoot throws on empty rootHash", async () => {
  const w = new InftWriter({
    contract: "0x" + "11".repeat(20),
    signer: { getAddress: async () => "0x0", provider: stubProvider } as any,
  });
  await assert.rejects(() => w.setStateRoot(1, ""), /empty rootHash/);
});

test("setStateRoot throws on non-bytes32 garbage", async () => {
  const w = new InftWriter({
    contract: "0x" + "11".repeat(20),
    signer: { getAddress: async () => "0x0", provider: stubProvider } as any,
  });
  await assert.rejects(() => w.setStateRoot(1, "0xdeadbeef"), /not bytes32/);
});

test("setStateRoot rejects when signer does not own token", async () => {
  const ownerAddr = "0x" + "aa".repeat(20);
  const signerAddr = "0x" + "bb".repeat(20);
  const fakeSigner = {
    getAddress: async () => signerAddr,
    provider: stubProvider,
  } as any;

  const w = new InftWriter({
    contract: "0x" + "11".repeat(20),
    signer: fakeSigner,
  });
  // Stub the ownerOf method so we don't hit a real RPC.
  (w as any).ownerOf = async () => ownerAddr;

  await assert.rejects(
    () => w.setStateRoot(1, "0x" + "cc".repeat(32)),
    /does not own token/
  );
});
