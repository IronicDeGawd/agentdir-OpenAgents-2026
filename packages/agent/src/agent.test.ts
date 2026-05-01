// Unit tests using fake AXL + storage. Verify request → response →
// attestation flow without network or 0G dependencies. Plus replay,
// bound-sig, and stale-request defenses.

import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { Agent } from "./agent.js";
import { SENTIMENT, SUMMARIZE, SkillRegistry } from "./skills.js";
import { isSkillResponse } from "./protocol.js";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";

ed.etc.sha512Async = (...m) => Promise.resolve(sha512(ed.etc.concatBytes(...m)));

class FakeAxl {
  inbox: { from: string; body: string }[] = [];
  outbox: { to: string; body: string }[] = [];
  async ourPubkey() { return "ff".repeat(32); }
  async topology() { return { our_ipv6: "", our_public_key: "ff".repeat(32) } as any; }
  async send(to: string, body: any) { this.outbox.push({ to, body: typeof body === "string" ? body : new TextDecoder().decode(body) }); }
  async sendJson(to: string, value: unknown) { this.outbox.push({ to, body: JSON.stringify(value) }); }
  async recvOnce() { return this.inbox.shift() ?? null; }
  async recv() { throw new Error("unused"); }
  async mcp() { throw new Error("unused"); }
  async a2aCard() { throw new Error("unused"); }
}

class FakeCompute {
  responses: string[];
  i = 0;
  constructor(responses: string[]) { this.responses = responses; }
  async chat() { return { text: this.responses[this.i++] ?? "fallback", raw: {} }; }
  async *stream(): AsyncGenerator<string> { yield "x"; }
  client = {} as any;
  model = "fake";
}

class FakeStorage {
  map = new Map<string, unknown>();
  n = 0;
  async putJson(v: unknown) { const r = `0x${(++this.n).toString(16).padStart(64, "0")}`; this.map.set(r, v); return r; }
  async getJson<T>(r: string) { return this.map.get(r) as T; }
}

const id = {
  handle: "alice",
  ensName: "alice.agentdir.eth",
  axlPrivateKeyHex: Buffer.from(ed.utils.randomPrivateKey()).toString("hex"),
  axlPubkeyHex: "",
  inftTokenId: "1",
};
const callerPriv = ed.utils.randomPrivateKey();
let callerPubHex = "";

const newReq = (overrides: any = {}) => ({
  v: 1,
  type: "skill.req",
  id: randomUUID(),
  nonce: randomBytes(16).toString("hex"),
  ts: Date.now(),
  skill: "summarize",
  input: { text: "hello world" },
  callerPubkey: callerPubHex,
  ...overrides,
});

test("init pubkeys", async () => {
  const oursPub = await ed.getPublicKeyAsync(Buffer.from(id.axlPrivateKeyHex, "hex"));
  id.axlPubkeyHex = Buffer.from(oursPub).toString("hex");
  const callerPub = await ed.getPublicKeyAsync(callerPriv);
  callerPubHex = Buffer.from(callerPub).toString("hex");
});

test("agent handles summarize request and replies signed + bound", async () => {
  const axl = new FakeAxl();
  const compute = new FakeCompute(["This is a summary."]);
  const skills = new SkillRegistry().add(SUMMARIZE);
  const agent = new Agent({ identity: id, axl: axl as any, compute: compute as any, skills });

  await agent.handleInbound(callerPubHex, JSON.stringify(newReq()));
  assert.equal(axl.outbox.length, 1);
  const sent = JSON.parse(axl.outbox[0]!.body);
  assert.ok(isSkillResponse(sent));
  assert.equal(sent.ok, true);
  assert.equal((sent.output as any).summary, "This is a summary.");
  assert.equal(sent.signerPubkey, id.axlPubkeyHex);
  assert.equal(sent.responder, id.axlPubkeyHex);
  assert.equal(sent.caller, callerPubHex);
  assert.equal(sent.skill, "summarize");
  assert.ok(typeof sent.sig === "string" && sent.sig.startsWith("0x"));
});

test("agent rejects request with mismatched callerPubkey field", async () => {
  const axl = new FakeAxl();
  const compute = new FakeCompute([]);
  const skills = new SkillRegistry().add(SUMMARIZE);
  const agent = new Agent({ identity: id, axl: axl as any, compute: compute as any, skills });
  // Sender claims to be someone else.
  await agent.handleInbound("aa".repeat(32), JSON.stringify(newReq()));
  const sent = JSON.parse(axl.outbox[0]!.body);
  assert.equal(sent.ok, false);
  assert.match(sent.error, /caller pubkey mismatch/);
});

test("agent rejects replayed request (same nonce)", async () => {
  const axl = new FakeAxl();
  const compute = new FakeCompute(["ok"]);
  const skills = new SkillRegistry().add(SUMMARIZE);
  const agent = new Agent({ identity: id, axl: axl as any, compute: compute as any, skills });
  const r = newReq();
  await agent.handleInbound(callerPubHex, JSON.stringify(r));
  // Replay verbatim.
  await agent.handleInbound(callerPubHex, JSON.stringify(r));
  assert.equal(axl.outbox.length, 2);
  const second = JSON.parse(axl.outbox[1]!.body);
  assert.equal(second.ok, false);
  assert.match(second.error, /replay/);
});

test("agent rejects stale request (ts too old)", async () => {
  const axl = new FakeAxl();
  const compute = new FakeCompute([]);
  const skills = new SkillRegistry().add(SUMMARIZE);
  const agent = new Agent({ identity: id, axl: axl as any, compute: compute as any, skills });
  await agent.handleInbound(
    callerPubHex,
    JSON.stringify(newReq({ ts: Date.now() - 60_000 }))
  );
  const sent = JSON.parse(axl.outbox[0]!.body);
  assert.equal(sent.ok, false);
  assert.match(sent.error, /stale/);
});

test("agent rejects oversized text input via runtime maxLength check", async () => {
  const axl = new FakeAxl();
  const compute = new FakeCompute([]);
  const skills = new SkillRegistry().add(SUMMARIZE);
  const agent = new Agent({ identity: id, axl: axl as any, compute: compute as any, skills });
  await agent.handleInbound(
    callerPubHex,
    JSON.stringify(newReq({ input: { text: "a".repeat(20_000) } }))
  );
  const sent = JSON.parse(axl.outbox[0]!.body);
  assert.equal(sent.ok, false);
  assert.match(sent.error, /maxLength/);
});

test("agent replies signed error for unknown skill", async () => {
  const axl = new FakeAxl();
  const compute = new FakeCompute([]);
  const skills = new SkillRegistry();
  const agent = new Agent({ identity: id, axl: axl as any, compute: compute as any, skills });
  await agent.handleInbound(callerPubHex, JSON.stringify(newReq({ skill: "nope" })));
  const sent = JSON.parse(axl.outbox[0]!.body);
  assert.equal(sent.ok, false);
  assert.match(sent.error, /unknown skill/);
  // Error responses are signed.
  assert.ok(typeof sent.sig === "string" && sent.sig.startsWith("0x"));
  assert.equal(sent.signerPubkey, id.axlPubkeyHex);
});

test("agent ignores non-JSON and non-request messages", async () => {
  const axl = new FakeAxl();
  const compute = new FakeCompute([]);
  const skills = new SkillRegistry();
  const agent = new Agent({ identity: id, axl: axl as any, compute: compute as any, skills });
  await agent.handleInbound("e".repeat(64), "not json");
  await agent.handleInbound("e".repeat(64), JSON.stringify({ hello: "world" }));
  assert.equal(axl.outbox.length, 0);
});

test("sentiment normalizes garbage to neutral", async () => {
  const axl = new FakeAxl();
  const compute = new FakeCompute(["?? unknown !!"]);
  const skills = new SkillRegistry().add(SENTIMENT);
  const agent = new Agent({ identity: id, axl: axl as any, compute: compute as any, skills });
  await agent.handleInbound(
    callerPubHex,
    JSON.stringify(newReq({ skill: "sentiment", input: { text: "ok" } }))
  );
  const sent = JSON.parse(axl.outbox[0]!.body);
  assert.equal((sent.output as any).label, "neutral");
});

test("requirePayment rejects unpaid call", async () => {
  const axl = new FakeAxl();
  const compute = new FakeCompute([]);
  const skills = new SkillRegistry().add(SUMMARIZE);
  const agent = new Agent({ identity: id, axl: axl as any, compute: compute as any, skills, requirePayment: true });
  await agent.handleInbound(callerPubHex, JSON.stringify(newReq()));
  const sent = JSON.parse(axl.outbox[0]!.body);
  assert.equal(sent.ok, false);
  assert.match(sent.error, /payment-rejected: no receipt/);
});

test("paid call: agent accepts a valid signed receipt", async () => {
  const { signReceipt } = await import("@agentdir/sdk");
  const axl = new FakeAxl();
  const compute = new FakeCompute(["Paid summary."]);
  const skills = new SkillRegistry().add(SUMMARIZE);
  const recipient = "0x" + "11".repeat(20);
  const tokenAddress = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
  const agent = new Agent({
    identity: id,
    axl: axl as any,
    compute: compute as any,
    skills,
    requirePayment: true,
    paymentExpectations: { recipient, tokenAddress, network: "11155111" },
  });

  const callerSigner = async (digestHex: `0x${string}`) => {
    const msg = Buffer.from(digestHex.slice(2), "hex");
    const sig = await ed.signAsync(msg, callerPriv);
    return "0x" + Buffer.from(sig).toString("hex");
  };
  const receipt = await signReceipt(
    {
      v: 1,
      kind: "kh-direct",
      amount: "0.01",
      tokenAddress,
      tokenSymbol: "USDC",
      network: "11155111",
      recipient,
      txHash: "0x" + "ab".repeat(32),
      executionId: "exec_test",
      callerPubkey: callerPubHex,
      skill: "summarize",
      ts: Math.floor(Date.now() / 1000),
    },
    callerSigner
  );
  await agent.handleInbound(callerPubHex, JSON.stringify(newReq({ payment: receipt })));
  const sent = JSON.parse(axl.outbox[0]!.body);
  assert.equal(sent.ok, true);
  assert.equal((sent.output as any).summary, "Paid summary.");
});

test("paid call: agent rejects receipt with wrong recipient", async () => {
  const { signReceipt } = await import("@agentdir/sdk");
  const axl = new FakeAxl();
  const skills = new SkillRegistry().add(SUMMARIZE);
  const recipient = "0x" + "11".repeat(20);
  const wrongRecipient = "0x" + "22".repeat(20);
  const tokenAddress = "0x" + "33".repeat(20);
  const agent = new Agent({
    identity: id,
    axl: axl as any,
    compute: new FakeCompute([]) as any,
    skills,
    requirePayment: true,
    paymentExpectations: { recipient, tokenAddress, network: "11155111" },
  });
  const callerSigner = async (digestHex: `0x${string}`) => {
    const msg = Buffer.from(digestHex.slice(2), "hex");
    const sig = await ed.signAsync(msg, callerPriv);
    return "0x" + Buffer.from(sig).toString("hex");
  };
  const receipt = await signReceipt(
    {
      v: 1,
      kind: "kh-direct",
      amount: "0.01",
      tokenAddress,
      tokenSymbol: "USDC",
      network: "11155111",
      recipient: wrongRecipient,
      txHash: "0x" + "ab".repeat(32),
      executionId: "exec_test",
      callerPubkey: callerPubHex,
      skill: "summarize",
      ts: Math.floor(Date.now() / 1000),
    },
    callerSigner
  );
  await agent.handleInbound(callerPubHex, JSON.stringify(newReq({ payment: receipt })));
  const sent = JSON.parse(axl.outbox[0]!.body);
  assert.equal(sent.ok, false);
  assert.match(sent.error, /payment-rejected: recipient mismatch/);
});

test("paid call: agent rejects forged receipt sig", async () => {
  const { signReceipt } = await import("@agentdir/sdk");
  const axl = new FakeAxl();
  const skills = new SkillRegistry().add(SUMMARIZE);
  const recipient = "0x" + "11".repeat(20);
  const tokenAddress = "0x" + "33".repeat(20);
  const agent = new Agent({
    identity: id,
    axl: axl as any,
    compute: new FakeCompute([]) as any,
    skills,
    requirePayment: true,
    paymentExpectations: { recipient, tokenAddress, network: "11155111" },
  });

  // Sign with a DIFFERENT key than callerPubHex (caller pretends to be the
  // real caller; receipt is signed by an attacker).
  const attackerPriv = ed.utils.randomPrivateKey();
  const attackerSigner = async (digestHex: `0x${string}`) => {
    const msg = Buffer.from(digestHex.slice(2), "hex");
    const sig = await ed.signAsync(msg, attackerPriv);
    return "0x" + Buffer.from(sig).toString("hex");
  };
  const receipt = await signReceipt(
    {
      v: 1,
      kind: "kh-direct",
      amount: "0.01",
      tokenAddress,
      tokenSymbol: "USDC",
      network: "11155111",
      recipient,
      txHash: "0x" + "ab".repeat(32),
      executionId: "exec_test",
      callerPubkey: callerPubHex,
      skill: "summarize",
      ts: Math.floor(Date.now() / 1000),
    },
    attackerSigner
  );
  await agent.handleInbound(callerPubHex, JSON.stringify(newReq({ payment: receipt })));
  const sent = JSON.parse(axl.outbox[0]!.body);
  assert.equal(sent.ok, false);
  assert.match(sent.error, /payment-rejected: bad receipt sig/);
});

test("agent counts calls and per-skill stats", async () => {
  const axl = new FakeAxl();
  const compute = new FakeCompute(["a", "b", "c"]);
  const skills = new SkillRegistry().add(SUMMARIZE);
  const agent = new Agent({ identity: id, axl: axl as any, compute: compute as any, skills });
  await agent.handleInbound(callerPubHex, JSON.stringify(newReq()));
  await agent.handleInbound(callerPubHex, JSON.stringify(newReq()));
  await agent.handleInbound(callerPubHex, JSON.stringify(newReq()));
  const s = agent.stats();
  assert.equal(s.callsTotal, 3);
  assert.equal(s.okTotal, 3);
  assert.equal(s.skillStats.summarize?.calls, 3);
  assert.equal(s.skillStats.summarize?.ok, 3);
});

test("snapshotEvery triggers rotation after threshold", async () => {
  const axl = new FakeAxl();
  const compute = new FakeCompute(["a", "b"]);
  const skills = new SkillRegistry().add(SUMMARIZE);
  const storage = new FakeStorage();
  const { SnapshotChain } = await import("@agentdir/sdk");
  const snapshots = new SnapshotChain(storage as any);
  const agent = new Agent({
    identity: id,
    axl: axl as any,
    compute: compute as any,
    skills,
    snapshots,
    snapshotEvery: 2,
  });
  await agent.handleInbound(callerPubHex, JSON.stringify(newReq()));
  assert.equal(storage.n, 0); // not yet
  await agent.handleInbound(callerPubHex, JSON.stringify(newReq()));
  // maybeSnapshot is fire-and-forget; let the microtask queue drain.
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(storage.n, 1);
  const blob: any = [...storage.map.values()][0];
  assert.equal(blob.callsTotal, 2);
  assert.equal(blob.okTotal, 2);
  assert.equal(blob.inftTokenId, "1");
});

test("snapshotNow seeds chain head from on-chain root on first call", async () => {
  const axl = new FakeAxl();
  const compute = new FakeCompute([]);
  const skills = new SkillRegistry();
  const storage = new FakeStorage();
  const { SnapshotChain } = await import("@agentdir/sdk");
  const snapshots = new SnapshotChain(storage as any);
  const FAKE_PREV = "0x" + "ab".repeat(32);
  const fakeInft = {
    getStateRoot: async () => FAKE_PREV,
    setStateRoot: async () => "0xtxhash",
  };
  const agent = new Agent({
    identity: id,
    axl: axl as any,
    compute: compute as any,
    skills,
    snapshots,
    inft: fakeInft as any,
  });
  const result = await agent.snapshotNow();
  assert.ok(result);
  assert.equal(result!.snapshot.prevSnapshotRoot, FAKE_PREV);
  assert.equal(result!.txHash, "0xtxhash");
});

test("snapshotNow uploads + signs blob", async () => {
  const axl = new FakeAxl();
  const compute = new FakeCompute([]);
  const skills = new SkillRegistry();
  const storage = new FakeStorage();
  const { SnapshotChain } = await import("@agentdir/sdk");
  const snapshots = new SnapshotChain(storage as any);
  const agent = new Agent({
    identity: id,
    axl: axl as any,
    compute: compute as any,
    skills,
    snapshots,
  });
  const result = await agent.snapshotNow();
  assert.ok(result);
  assert.equal(storage.n, 1);
  const { SnapshotChain: SC } = await import("@agentdir/sdk");
  assert.equal(await SC.verify(result!.snapshot, id.axlPubkeyHex), true);
});

test("rep chain receives one attestation per call", async () => {
  const axl = new FakeAxl();
  const compute = new FakeCompute(["Summary."]);
  const skills = new SkillRegistry().add(SUMMARIZE);
  const storage = new FakeStorage();
  const { RepChain } = await import("@agentdir/sdk");
  const rep = new RepChain(storage as any);
  const agent = new Agent({ identity: id, axl: axl as any, compute: compute as any, storage: storage as any, rep, skills });
  await agent.handleInbound(callerPubHex, JSON.stringify(newReq({ callerINFT: "42" })));
  assert.equal(storage.n, 1);
  const att: any = [...storage.map.values()][0];
  assert.equal(att.callerINFT, "42");
  assert.equal(att.calleeINFT, "1");
  assert.equal(att.ok, true);
});
