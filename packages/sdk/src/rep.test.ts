import { test } from "node:test";
import assert from "node:assert/strict";
import { RepChain } from "./rep.js";
import type { RepAttestation } from "./types.js";

// Fake in-memory storage that mimics the Storage interface for testing.
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

const signer = async (_d: `0x${string}`) => "0xsig";

test("append builds a chain via prevRoot", async () => {
  const chain = new RepChain(new FakeStorage() as any);
  const a = await chain.append({
    callerINFT: "1",
    calleeINFT: "2",
    skill: "summarize",
    ok: true,
    latencyMs: 100,
    signer,
  });
  const b = await chain.append({
    callerINFT: "1",
    calleeINFT: "2",
    skill: "summarize",
    ok: false,
    latencyMs: 200,
    signer,
  });
  assert.equal(a.att.prevRoot, null);
  assert.equal(b.att.prevRoot, a.root);
  assert.equal(chain.head, b.root);
});

test("walk returns newest first", async () => {
  const chain = new RepChain(new FakeStorage() as any);
  const a = await chain.append({
    callerINFT: "1",
    calleeINFT: "2",
    skill: "x",
    ok: true,
    latencyMs: 10,
    signer,
  });
  const b = await chain.append({
    callerINFT: "1",
    calleeINFT: "2",
    skill: "x",
    ok: true,
    latencyMs: 20,
    signer,
  });
  const list = await chain.walk(b.root);
  assert.equal(list.length, 2);
  assert.equal(list[0]!.latencyMs, 20);
  assert.equal(list[1]!.latencyMs, 10);
  assert.equal(list[1]!.prevRoot, null);
  assert.equal(list[0]!.prevRoot, a.root);
});

test("score computes ok ratio for a target inft", () => {
  const atts: RepAttestation[] = [
    { v: 1, callerINFT: "1", calleeINFT: "2", skill: "x", ok: true, latencyMs: 0, ts: 0, prevRoot: null, sig: "" },
    { v: 1, callerINFT: "1", calleeINFT: "2", skill: "x", ok: true, latencyMs: 0, ts: 0, prevRoot: null, sig: "" },
    { v: 1, callerINFT: "1", calleeINFT: "2", skill: "x", ok: false, latencyMs: 0, ts: 0, prevRoot: null, sig: "" },
    { v: 1, callerINFT: "1", calleeINFT: "3", skill: "x", ok: false, latencyMs: 0, ts: 0, prevRoot: null, sig: "" },
  ];
  const s = RepChain.score(atts, "2");
  assert.equal(s.n, 3);
  assert.equal(s.ok, 2);
  assert.ok(Math.abs(s.ratio - 2 / 3) < 1e-9);
});
