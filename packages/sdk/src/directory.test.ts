import { test } from "node:test";
import assert from "node:assert/strict";
import { Directory } from "./directory.js";
import { RepChain } from "./rep.js";
import { buildAgentCard } from "./agent-card.js";
import type { AgentCard, RepAttestation } from "./types.js";

class FakeStorage {
  map = new Map<string, unknown>();
  n = 0;
  async putJson(v: unknown) {
    const r = `0x${(++this.n).toString(16).padStart(64, "0")}`;
    this.map.set(r, v);
    return r;
  }
  async getJson<T>(r: string): Promise<T> {
    const v = this.map.get(r);
    if (!v) throw new Error(`not found: ${r}`);
    return v as T;
  }
  async putBytes(): Promise<string> {
    throw new Error("nope");
  }
  async getBytes(): Promise<Uint8Array> {
    throw new Error("nope");
  }
}

function makeCard(name: string, skills: string[]): AgentCard {
  return buildAgentCard({
    name,
    description: `agent ${name}`,
    axlPubkey: "ff".repeat(32),
    skills: skills.map((id) => ({
      id,
      name: id,
      description: id,
      tags: ["x"],
      inputSchema: { type: "object", properties: { text: { type: "string" } } },
    })),
  });
}

// Stub Directory.entryFor by overriding the EnsResolver internals via
// extension. Easier: subclass Directory with a fake resolver layer.
class StubDirectory extends Directory {
  bundles: Map<string, Record<string, string>> = new Map();
  constructor(storage: FakeStorage, seed: string[]) {
    super({ storage: storage as any, seed });
  }
  // shadow entryFor by stubbing the resolver bundle
  async query(q: any): Promise<any> {
    const bundles = this.bundles;
    (this.resolver as any).getRecordBundle = async (name: string) =>
      bundles.get(name) ?? {};
    return super.query(q);
  }
}

test("RepChain.scoreFor weights by confidence (lookback)", () => {
  const a: RepAttestation[] = [
    { v: 1, callerINFT: "1", calleeINFT: "2", skill: "x", ok: true, latencyMs: 0, ts: 0, prevRoot: null, sig: "" },
  ];
  // 1 sample, lookback 10 → confidence 0.1, ratio 1.0 → score 0.1
  const s = RepChain.scoreFor(a, "2", { skill: "x", lookback: 10 });
  assert.equal(s.n, 1);
  assert.equal(s.ok, 1);
  assert.equal(s.ratio, 1);
  assert.ok(Math.abs(s.score - 0.1) < 1e-9);
});

test("RepChain.scoreFor full window scores 1.0 for perfect record", () => {
  const a: RepAttestation[] = Array.from({ length: 10 }, () => ({
    v: 1 as const,
    callerINFT: "1",
    calleeINFT: "2",
    skill: "x",
    ok: true,
    latencyMs: 0,
    ts: 0,
    prevRoot: null,
    sig: "",
  }));
  const s = RepChain.scoreFor(a, "2", { skill: "x", lookback: 10 });
  assert.equal(s.score, 1);
});

test("RepChain.scoreFor filters by skill", () => {
  const a: RepAttestation[] = [
    { v: 1, callerINFT: "1", calleeINFT: "2", skill: "summarize", ok: true, latencyMs: 0, ts: 0, prevRoot: null, sig: "" },
    { v: 1, callerINFT: "1", calleeINFT: "2", skill: "sentiment", ok: false, latencyMs: 0, ts: 0, prevRoot: null, sig: "" },
  ];
  const s = RepChain.scoreFor(a, "2", { skill: "summarize", lookback: 10 });
  assert.equal(s.n, 1);
  assert.equal(s.ok, 1);
});

test("RepChain.scoreFor n=0 returns score 0 for empty input", () => {
  const s = RepChain.scoreFor([], "2", { skill: "x" });
  assert.equal(s.score, 0);
  assert.equal(s.n, 0);
});

test("Directory ranks higher-rep agent above lower", async () => {
  const storage = new FakeStorage();

  // Build two rep heads on the fake storage.
  const repA = new RepChain(storage as any);
  const repB = new RepChain(storage as any);
  const sig = async () => "0xsig";

  // A: 1 success at calleeINFT=10 for summarize.
  await repA.append({ callerINFT: "1", calleeINFT: "10", skill: "summarize", ok: true, latencyMs: 100, signer: sig });
  const aHead = repA.head!;

  // B: 5 successes (perfect) at calleeINFT=20 for summarize.
  for (let i = 0; i < 5; i++) {
    await repB.append({ callerINFT: "1", calleeINFT: "20", skill: "summarize", ok: true, latencyMs: 100, signer: sig });
  }
  const bHead = repB.head!;

  const dir = new StubDirectory(storage, ["a.test", "b.test"]);
  dir.bundles.set("a.test", {
    "org.a2a.agent-card": JSON.stringify(makeCard("a.test", ["summarize"])),
    "org.erc7857.tokenId": "10",
    "network.agentdir.rep-head": aHead,
  });
  dir.bundles.set("b.test", {
    "org.a2a.agent-card": JSON.stringify(makeCard("b.test", ["summarize"])),
    "org.erc7857.tokenId": "20",
    "network.agentdir.rep-head": bHead,
  });

  const ranked = await dir.query({ skill: "summarize", lookback: 10 });
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0]!.ens, "b.test"); // 5 samples → 0.5 score
  assert.equal(ranked[1]!.ens, "a.test"); // 1 sample → 0.1 score
  assert.ok(ranked[0]!.score.score > ranked[1]!.score.score);
});

test("Directory filters out agents without the requested skill", async () => {
  const storage = new FakeStorage();
  const dir = new StubDirectory(storage, ["a.test", "b.test"]);
  dir.bundles.set("a.test", {
    "org.a2a.agent-card": JSON.stringify(makeCard("a.test", ["summarize"])),
    "org.erc7857.tokenId": "1",
  });
  dir.bundles.set("b.test", {
    "org.a2a.agent-card": JSON.stringify(makeCard("b.test", ["sentiment"])),
    "org.erc7857.tokenId": "2",
  });
  const ranked = await dir.query({ skill: "summarize" });
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]!.ens, "a.test");
});

test("Directory enforces minScore", async () => {
  const storage = new FakeStorage();
  const repA = new RepChain(storage as any);
  const sig = async () => "0xsig";
  await repA.append({ callerINFT: "1", calleeINFT: "10", skill: "summarize", ok: true, latencyMs: 0, signer: sig });

  const dir = new StubDirectory(storage, ["a.test"]);
  dir.bundles.set("a.test", {
    "org.a2a.agent-card": JSON.stringify(makeCard("a.test", ["summarize"])),
    "org.erc7857.tokenId": "10",
    "network.agentdir.rep-head": repA.head!,
  });
  // 1/10 lookback = 0.1 score; minScore 0.5 should drop it.
  const ranked = await dir.query({ skill: "summarize", lookback: 10, minScore: 0.5 });
  assert.equal(ranked.length, 0);
});

test("Directory still lists agents without rep-head (score=0)", async () => {
  const storage = new FakeStorage();
  const dir = new StubDirectory(storage, ["a.test"]);
  dir.bundles.set("a.test", {
    "org.a2a.agent-card": JSON.stringify(makeCard("a.test", ["summarize"])),
    "org.erc7857.tokenId": "10",
    // no rep-head
  });
  const ranked = await dir.query({ skill: "summarize" });
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]!.score.score, 0);
  assert.equal(ranked[0]!.score.n, 0);
});

test("Directory respects limit", async () => {
  const storage = new FakeStorage();
  const dir = new StubDirectory(storage, ["a.test", "b.test", "c.test"]);
  for (const n of ["a.test", "b.test", "c.test"]) {
    dir.bundles.set(n, {
      "org.a2a.agent-card": JSON.stringify(makeCard(n, ["summarize"])),
      "org.erc7857.tokenId": "1",
    });
  }
  const ranked = await dir.query({ skill: "summarize", limit: 2 });
  assert.equal(ranked.length, 2);
});
