import { test } from "node:test";
import assert from "node:assert/strict";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import { SnapshotChain } from "./snapshot.js";

ed.etc.sha512Async = (...m) => Promise.resolve(sha512(ed.etc.concatBytes(...m)));
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

class FakeStorage {
  private map = new Map<string, unknown>();
  private n = 0;
  async putJson(value: unknown): Promise<string> {
    const root = `0x${(++this.n).toString(16).padStart(64, "0")}`;
    this.map.set(root, value);
    return root;
  }
  async getJson<T>(rootHash: string): Promise<T> {
    return this.map.get(rootHash) as T;
  }
  async putBytes(): Promise<string> {
    throw new Error("not used");
  }
  async getBytes(): Promise<Uint8Array> {
    throw new Error("not used");
  }
}

async function makeSigner() {
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

test("snapshot append links via prevSnapshotRoot", async () => {
  const { pubHex, signer } = await makeSigner();
  const chain = new SnapshotChain(new FakeStorage() as any);

  const a = await chain.append({
    ensName: "alice.agentdir.eth",
    signerPubkey: pubHex,
    inftTokenId: "1",
    callsTotal: 5,
    okTotal: 5,
    skillStats: { summarize: { calls: 5, ok: 5 } },
    repHead: null,
    signer,
  });
  const b = await chain.append({
    ensName: "alice.agentdir.eth",
    signerPubkey: pubHex,
    inftTokenId: "1",
    callsTotal: 10,
    okTotal: 9,
    skillStats: { summarize: { calls: 10, ok: 9 } },
    repHead: "0xabc",
    signer,
  });

  assert.equal(a.snapshot.prevSnapshotRoot, null);
  assert.equal(b.snapshot.prevSnapshotRoot, a.root);
  assert.equal(chain.head, b.root);
  assert.equal(b.snapshot.callsTotal, 10);
  assert.equal(b.snapshot.repHead, "0xabc");
});

test("snapshot walk returns newest first", async () => {
  const { pubHex, signer } = await makeSigner();
  const chain = new SnapshotChain(new FakeStorage() as any);
  const a = await chain.append({
    ensName: "x.eth",
    signerPubkey: pubHex,
    inftTokenId: "1",
    callsTotal: 1,
    okTotal: 1,
    skillStats: {},
    repHead: null,
    signer,
  });
  const b = await chain.append({
    ensName: "x.eth",
    signerPubkey: pubHex,
    inftTokenId: "1",
    callsTotal: 2,
    okTotal: 2,
    skillStats: {},
    repHead: null,
    signer,
  });
  const list = await chain.walk(b.root);
  assert.equal(list.length, 2);
  assert.equal(list[0]!.callsTotal, 2);
  assert.equal(list[1]!.callsTotal, 1);
  assert.equal(list[1]!.prevSnapshotRoot, null);
  assert.equal(list[0]!.prevSnapshotRoot, a.root);
});

test("snapshot signature verifies under correct pubkey", async () => {
  const { pubHex, signer } = await makeSigner();
  const chain = new SnapshotChain(new FakeStorage() as any);
  const { snapshot } = await chain.append({
    ensName: "x.eth",
    signerPubkey: pubHex,
    inftTokenId: "1",
    callsTotal: 1,
    okTotal: 1,
    skillStats: {},
    repHead: null,
    signer,
  });
  assert.equal(await SnapshotChain.verify(snapshot, pubHex), true);
});

test("snapshot signature fails under wrong pubkey", async () => {
  const { pubHex, signer } = await makeSigner();
  const other = await ed.getPublicKeyAsync(ed.utils.randomPrivateKey());
  const otherHex = Buffer.from(other).toString("hex");
  const chain = new SnapshotChain(new FakeStorage() as any);
  const { snapshot } = await chain.append({
    ensName: "x.eth",
    signerPubkey: pubHex,
    inftTokenId: "1",
    callsTotal: 1,
    okTotal: 1,
    skillStats: {},
    repHead: null,
    signer,
  });
  assert.equal(await SnapshotChain.verify(snapshot, otherHex), false);
});

test("walk stops on signature mismatch when verifyKey passed", async () => {
  const { pubHex, signer } = await makeSigner();
  const other = await ed.getPublicKeyAsync(ed.utils.randomPrivateKey());
  const otherHex = Buffer.from(other).toString("hex");
  const chain = new SnapshotChain(new FakeStorage() as any);
  await chain.append({
    ensName: "x.eth",
    signerPubkey: pubHex,
    inftTokenId: "1",
    callsTotal: 1,
    okTotal: 1,
    skillStats: {},
    repHead: null,
    signer,
  });
  const b = await chain.append({
    ensName: "x.eth",
    signerPubkey: pubHex,
    inftTokenId: "1",
    callsTotal: 2,
    okTotal: 2,
    skillStats: {},
    repHead: null,
    signer,
  });
  const list = await chain.walk(b.root, 50, otherHex);
  assert.equal(list.length, 0);
});
