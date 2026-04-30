// Real ed25519 sign+verify roundtrip + concurrency lock test.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import { keccak256, toHex } from "viem";
import { canonicalJson } from "./agent-card.js";
import { RepChain } from "./rep.js";
import type { RepAttestation } from "./types.js";

// noble v2 needs sha512 wired in async path.
ed.etc.sha512Async = (...m) => Promise.resolve(sha512(ed.etc.concatBytes(...m)));
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

class FakeStorage {
  private map = new Map<string, unknown>();
  private n = 0;
  async putJson(value: unknown): Promise<string> {
    // simulate async write so concurrent appends actually overlap
    await new Promise((r) => setTimeout(r, 5));
    const root = `0x${(++this.n).toString(16).padStart(64, "0")}`;
    this.map.set(root, value);
    return root;
  }
  async getJson<T>(rootHash: string): Promise<T> {
    return this.map.get(rootHash) as T;
  }
}

const stripHex = (h: string) => (h.startsWith("0x") ? h.slice(2) : h);

test("RepChain.verify accepts a valid ed25519 signature", async () => {
  const priv = ed.utils.randomPrivateKey();
  const pub = await ed.getPublicKeyAsync(priv);
  const pubHex = Buffer.from(pub).toString("hex");

  const chain = new RepChain(new FakeStorage() as any);
  const signer = async (digest: `0x${string}`) => {
    const sig = await ed.signAsync(Buffer.from(stripHex(digest), "hex"), priv);
    return "0x" + Buffer.from(sig).toString("hex");
  };

  const { att } = await chain.append({
    callerINFT: "1",
    calleeINFT: "2",
    skill: "summarize",
    ok: true,
    latencyMs: 100,
    signer,
  });

  assert.equal(await RepChain.verify(att, pubHex), true);
});

test("RepChain.verify rejects tampered attestation", async () => {
  const priv = ed.utils.randomPrivateKey();
  const pub = await ed.getPublicKeyAsync(priv);
  const pubHex = Buffer.from(pub).toString("hex");

  const chain = new RepChain(new FakeStorage() as any);
  const signer = async (digest: `0x${string}`) => {
    const sig = await ed.signAsync(Buffer.from(stripHex(digest), "hex"), priv);
    return "0x" + Buffer.from(sig).toString("hex");
  };

  const { att } = await chain.append({
    callerINFT: "1",
    calleeINFT: "2",
    skill: "summarize",
    ok: true,
    latencyMs: 100,
    signer,
  });
  const tampered: RepAttestation = { ...att, ok: false };
  assert.equal(await RepChain.verify(tampered, pubHex), false);
});

test("RepChain.verify rejects sig from wrong key", async () => {
  const priv = ed.utils.randomPrivateKey();
  const otherPub = await ed.getPublicKeyAsync(ed.utils.randomPrivateKey());
  const otherPubHex = Buffer.from(otherPub).toString("hex");
  const chain = new RepChain(new FakeStorage() as any);
  const signer = async (digest: `0x${string}`) => {
    const sig = await ed.signAsync(Buffer.from(stripHex(digest), "hex"), priv);
    return "0x" + Buffer.from(sig).toString("hex");
  };
  const { att } = await chain.append({
    callerINFT: "1",
    calleeINFT: "2",
    skill: "x",
    ok: true,
    latencyMs: 1,
    signer,
  });
  assert.equal(await RepChain.verify(att, otherPubHex), false);
});

test("concurrent append calls produce a chain, not a fork", async () => {
  const chain = new RepChain(new FakeStorage() as any);
  const signer = async () => "0xdead";
  const inputs = Array.from({ length: 5 }, (_, i) => ({
    callerINFT: "1",
    calleeINFT: "2",
    skill: `s${i}`,
    ok: true,
    latencyMs: i,
    signer,
  }));
  const results = await Promise.all(inputs.map((i) => chain.append(i)));
  // Each prevRoot must equal the prior result's root (or null for the first).
  for (let i = 0; i < results.length; i++) {
    const expected = i === 0 ? null : results[i - 1]!.root;
    assert.equal(results[i]!.att.prevRoot, expected, `entry ${i} fork at prevRoot`);
  }
});

// keep linter happy
void canonicalJson;
void keccak256;
void toHex;
