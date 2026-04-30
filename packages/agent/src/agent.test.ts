// Unit tests using fake AXL + storage. Verify the request → response →
// attestation flow without network or 0G dependencies.

import { test } from "node:test";
import assert from "node:assert/strict";
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

test("agent handles summarize request and replies signed", async () => {
  const ours = await ed.getPublicKeyAsync(Buffer.from(id.axlPrivateKeyHex, "hex"));
  id.axlPubkeyHex = Buffer.from(ours).toString("hex");

  const axl = new FakeAxl();
  const compute = new FakeCompute(["This is a summary."]);
  const skills = new SkillRegistry().add(SUMMARIZE);
  const agent = new Agent({
    identity: id,
    axl: axl as any,
    compute: compute as any,
    skills,
  });

  await agent.handleInbound(
    "ee".repeat(32),
    JSON.stringify({
      v: 1,
      type: "skill.req",
      id: "req-1",
      skill: "summarize",
      input: { text: "long story short" },
    })
  );

  assert.equal(axl.outbox.length, 1);
  const sent = JSON.parse(axl.outbox[0]!.body);
  assert.ok(isSkillResponse(sent));
  assert.equal(sent.ok, true);
  assert.equal((sent.output as any).summary, "This is a summary.");
  assert.equal(sent.signerPubkey, id.axlPubkeyHex);
});

test("agent replies error for unknown skill", async () => {
  const axl = new FakeAxl();
  const compute = new FakeCompute([]);
  const skills = new SkillRegistry();
  const agent = new Agent({
    identity: id,
    axl: axl as any,
    compute: compute as any,
    skills,
  });
  await agent.handleInbound(
    "ee".repeat(32),
    JSON.stringify({ v: 1, type: "skill.req", id: "req-2", skill: "nope", input: {} })
  );
  const sent = JSON.parse(axl.outbox[0]!.body);
  assert.equal(sent.ok, false);
  assert.match(sent.error, /unknown skill/);
});

test("agent ignores non-JSON and non-request messages", async () => {
  const axl = new FakeAxl();
  const compute = new FakeCompute([]);
  const skills = new SkillRegistry();
  const agent = new Agent({
    identity: id,
    axl: axl as any,
    compute: compute as any,
    skills,
  });
  await agent.handleInbound("e".repeat(64), "not json");
  await agent.handleInbound("e".repeat(64), JSON.stringify({ hello: "world" }));
  assert.equal(axl.outbox.length, 0);
});

test("sentiment normalizes garbage to neutral", async () => {
  const axl = new FakeAxl();
  const compute = new FakeCompute(["?? unknown !!"]);
  const skills = new SkillRegistry().add(SENTIMENT);
  const agent = new Agent({
    identity: id,
    axl: axl as any,
    compute: compute as any,
    skills,
  });
  await agent.handleInbound(
    "ee".repeat(32),
    JSON.stringify({
      v: 1,
      type: "skill.req",
      id: "req-3",
      skill: "sentiment",
      input: { text: "ok" },
    })
  );
  const sent = JSON.parse(axl.outbox[0]!.body);
  assert.equal((sent.output as any).label, "neutral");
});

test("requirePayment rejects unpaid call", async () => {
  const axl = new FakeAxl();
  const compute = new FakeCompute(["Summary."]);
  const skills = new SkillRegistry().add(SUMMARIZE);
  const agent = new Agent({
    identity: id,
    axl: axl as any,
    compute: compute as any,
    skills,
    requirePayment: true,
  });
  await agent.handleInbound(
    "ee".repeat(32),
    JSON.stringify({
      v: 1,
      type: "skill.req",
      id: "req-4",
      skill: "summarize",
      input: { text: "x" },
    })
  );
  const sent = JSON.parse(axl.outbox[0]!.body);
  assert.equal(sent.ok, false);
  assert.match(sent.error, /payment-required/);
});

test("rep chain receives one attestation per call (success or failure)", async () => {
  const axl = new FakeAxl();
  const compute = new FakeCompute(["Summary."]);
  const skills = new SkillRegistry().add(SUMMARIZE);
  const storage = new FakeStorage();
  const { RepChain } = await import("@agentdir/sdk");
  const rep = new RepChain(storage as any);
  const agent = new Agent({
    identity: id,
    axl: axl as any,
    compute: compute as any,
    storage: storage as any,
    rep,
    skills,
  });
  await agent.handleInbound(
    "ee".repeat(32),
    JSON.stringify({
      v: 1,
      type: "skill.req",
      id: "req-5",
      skill: "summarize",
      input: { text: "x" },
      callerINFT: "42",
    })
  );
  // FakeStorage records one putJson — the attestation.
  assert.equal(storage.n, 1);
  const att: any = [...storage.map.values()][0];
  assert.equal(att.callerINFT, "42");
  assert.equal(att.calleeINFT, "1");
  assert.equal(att.skill, "summarize");
  assert.equal(att.ok, true);
});
