import { test } from "node:test";
import assert from "node:assert/strict";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import { Agent } from "./agent.js";
import { ROUTE, SUMMARIZE, SkillRegistry } from "./skills.js";
import { LocalBusClient, resetLocalBus } from "./local-bus.js";
import { callSkill } from "./caller.js";
import type { RoutingTable } from "@agentdir/sdk";

ed.etc.sha512Async = (...m) => Promise.resolve(sha512(ed.etc.concatBytes(...m)));

class FakeCompute {
  responses: string[];
  i = 0;
  lastTeeAttestation: null = null;
  constructor(responses: string[]) {
    this.responses = responses;
  }
  async chat() {
    return { text: this.responses[this.i++] ?? "fallback", raw: {} };
  }
  async *stream(): AsyncGenerator<string> {
    yield "x";
  }
  client = {} as any;
  model = "fake";
}

async function mkIdentity(handle: string) {
  const priv = ed.utils.randomPrivateKey();
  const pub = await ed.getPublicKeyAsync(priv);
  return {
    handle,
    ensName: `${handle}.agentdir.eth`,
    axlPrivateKeyHex: Buffer.from(priv).toString("hex"),
    axlPubkeyHex: Buffer.from(pub).toString("hex"),
    inftTokenId: handle === "alice" ? "1" : handle === "bob" ? "2" : "3",
  };
}

test("route skill forwards to downstream agent and captures hop", async () => {
  resetLocalBus();
  const alice = await mkIdentity("alice");
  const bob = await mkIdentity("bob");
  const irony = await mkIdentity("irony");

  const aliceBus = new LocalBusClient(alice.axlPubkeyHex);
  const bobBus = new LocalBusClient(bob.axlPubkeyHex);
  const ironyBus = new LocalBusClient(irony.axlPubkeyHex);

  const bobAgent = new Agent({
    identity: bob,
    axl: bobBus as any,
    compute: new FakeCompute(["a summary"]) as any,
    skills: new SkillRegistry().add(SUMMARIZE),
  });

  const routingTable: RoutingTable = {
    summarize: { destPubkey: bob.axlPubkeyHex, skill: "summarize", ens: "bob.agentdir.eth" },
  };
  const aliceAgent = new Agent({
    identity: alice,
    axl: aliceBus as any,
    compute: new FakeCompute([]) as any,
    skills: new SkillRegistry().add(ROUTE),
    swarm: { axl: aliceBus as any, routingTable },
  });

  const bobLoop = bobAgent.start();
  const aliceLoop = aliceAgent.start();

  const res = await callSkill({
    axl: ironyBus as any,
    destPubkey: alice.axlPubkeyHex,
    callerPubkey: irony.axlPubkeyHex,
    skill: "route",
    input: { tag: "summarize", payload: { text: "hi" }, hopBudget: 3 },
  });

  const out = res.output as any;
  assert.deepEqual(out.output, { summary: "a summary" });
  assert.equal(out.trace.length, 1);
  const hop = out.trace[0];
  assert.equal(hop.from, alice.axlPubkeyHex);
  assert.equal(hop.to, bob.axlPubkeyHex);
  assert.equal(hop.skill, "summarize");
  assert.equal(hop.responderEns, "bob.agentdir.eth");
  assert.ok(hop.latencyMs >= 0);

  aliceAgent.stop();
  bobAgent.stop();
  await Promise.race([
    Promise.all([aliceLoop, bobLoop]),
    new Promise((r) => setTimeout(r, 1000)),
  ]);
});

test("route skill rejects unknown tag", async () => {
  resetLocalBus();
  const alice = await mkIdentity("alice");
  const irony = await mkIdentity("irony");
  const aliceBus = new LocalBusClient(alice.axlPubkeyHex);
  const ironyBus = new LocalBusClient(irony.axlPubkeyHex);

  const aliceAgent = new Agent({
    identity: alice,
    axl: aliceBus as any,
    compute: new FakeCompute([]) as any,
    skills: new SkillRegistry().add(ROUTE),
    swarm: { axl: aliceBus as any, routingTable: {} },
  });
  const aliceLoop = aliceAgent.start();
  await assert.rejects(
    () =>
      callSkill({
        axl: ironyBus as any,
        destPubkey: alice.axlPubkeyHex,
        callerPubkey: irony.axlPubkeyHex,
        skill: "route",
        input: { tag: "summarize", payload: {}, hopBudget: 3 },
      }),
    /no route for tag 'summarize'/
  );
  aliceAgent.stop();
  await Promise.race([aliceLoop, new Promise((r) => setTimeout(r, 1000))]);
});

test("route skill refuses to forward when hopBudget is 0", async () => {
  resetLocalBus();
  const alice = await mkIdentity("alice");
  const bob = await mkIdentity("bob");
  const irony = await mkIdentity("irony");
  const aliceBus = new LocalBusClient(alice.axlPubkeyHex);
  new LocalBusClient(bob.axlPubkeyHex); // create bob inbox so routingTable is valid
  const ironyBus = new LocalBusClient(irony.axlPubkeyHex);

  const routingTable: RoutingTable = {
    summarize: { destPubkey: bob.axlPubkeyHex, skill: "summarize" },
  };
  const aliceAgent = new Agent({
    identity: alice,
    axl: aliceBus as any,
    compute: new FakeCompute([]) as any,
    skills: new SkillRegistry().add(ROUTE),
    swarm: { axl: aliceBus as any, routingTable },
  });
  const aliceLoop = aliceAgent.start();
  await assert.rejects(
    () =>
      callSkill({
        axl: ironyBus as any,
        destPubkey: alice.axlPubkeyHex,
        callerPubkey: irony.axlPubkeyHex,
        skill: "route",
        input: { tag: "summarize", payload: {}, hopBudget: 0 },
      }),
    /hop budget exhausted/
  );
  aliceAgent.stop();
  await Promise.race([aliceLoop, new Promise((r) => setTimeout(r, 1000))]);
});

test("route skill surfaces failed-hop info when downstream errors", async () => {
  resetLocalBus();
  const alice = await mkIdentity("alice");
  const bob = await mkIdentity("bob");
  const irony = await mkIdentity("irony");
  const aliceBus = new LocalBusClient(alice.axlPubkeyHex);
  const bobBus = new LocalBusClient(bob.axlPubkeyHex);
  const ironyBus = new LocalBusClient(irony.axlPubkeyHex);

  // Bob is up but has NO summarize skill — calling it returns "unknown skill"
  // signed error, which callSkill turns into a thrown Error.
  const bobAgent = new Agent({
    identity: bob,
    axl: bobBus as any,
    compute: new FakeCompute([]) as any,
    skills: new SkillRegistry(), // empty
  });
  const routingTable: RoutingTable = {
    summarize: { destPubkey: bob.axlPubkeyHex, skill: "summarize", ens: "bob.agentdir.eth" },
  };
  const aliceAgent = new Agent({
    identity: alice,
    axl: aliceBus as any,
    compute: new FakeCompute([]) as any,
    skills: new SkillRegistry().add(ROUTE),
    swarm: { axl: aliceBus as any, routingTable },
  });
  const aliceLoop = aliceAgent.start();
  const bobLoop = bobAgent.start();
  await assert.rejects(
    () =>
      callSkill({
        axl: ironyBus as any,
        destPubkey: alice.axlPubkeyHex,
        callerPubkey: irony.axlPubkeyHex,
        skill: "route",
        input: { tag: "summarize", payload: { text: "hi" }, hopBudget: 3 },
      }),
    /route hop failed:.*unknown skill/
  );
  aliceAgent.stop();
  bobAgent.stop();
  await Promise.race([
    Promise.all([aliceLoop, bobLoop]),
    new Promise((r) => setTimeout(r, 1000)),
  ]);
});

test("route skill rejects when agent has no swarm config", async () => {
  resetLocalBus();
  const alice = await mkIdentity("alice");
  const irony = await mkIdentity("irony");
  const aliceBus = new LocalBusClient(alice.axlPubkeyHex);
  const ironyBus = new LocalBusClient(irony.axlPubkeyHex);

  const aliceAgent = new Agent({
    identity: alice,
    axl: aliceBus as any,
    compute: new FakeCompute([]) as any,
    skills: new SkillRegistry().add(ROUTE),
    // no swarm!
  });
  const aliceLoop = aliceAgent.start();
  await assert.rejects(
    () =>
      callSkill({
        axl: ironyBus as any,
        destPubkey: alice.axlPubkeyHex,
        callerPubkey: irony.axlPubkeyHex,
        skill: "route",
        input: { tag: "summarize", payload: {}, hopBudget: 3 },
      }),
    /agent has no swarm config/
  );
  aliceAgent.stop();
  await Promise.race([aliceLoop, new Promise((r) => setTimeout(r, 1000))]);
});
