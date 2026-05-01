#!/usr/bin/env tsx
// Multi-agent swarm demo (E4). Three identities run in-process. The
// caller (irony) asks alice (the router) for a "summarize-or-sentiment"
// task. alice picks the right downstream from her routing table, calls
// it, and returns the downstream output along with the routing trace.
//
// Story for judges:
//   - Each hop is a real, signed SkillRequest/SkillResponse over
//     LocalBus. No fakes.
//   - Both alice and the downstream emit their own RepAttestation to
//     0G Storage, so reputation reflects the entire path.
//   - alice's route handler refuses to forward when hopBudget hits 0,
//     preventing infinite cycles.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  Compute,
  RepChain,
  Storage,
  makeSigner,
  type RoutingTable,
} from "@agentdir/sdk";
import {
  Agent,
  LocalBusClient,
  ROUTE,
  SENTIMENT,
  SUMMARIZE,
  SkillRegistry,
  callSkill,
  loadOrCreate,
} from "@agentdir/agent";

const REPO = join(import.meta.dirname ?? "", "..", "..", "..");
for (const line of readFileSync(join(REPO, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && m[1] && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const need = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} missing`);
  return v;
};
const step = (n: number, s: string) => console.log(`\n\x1b[1m${n}. ${s}\x1b[0m`);

async function main() {
  const PK = need("PRIVATE_KEY");
  const ZEROG = need("ZEROG_API_KEY");

  step(1, "load 4 identities (alice=router, bob=summarize, vasu=sentiment, irony=caller)");
  const alice = await loadOrCreate("alice", null);
  const bob = await loadOrCreate("bob", null);
  const vasu = await loadOrCreate("vasu", null);
  const irony = await loadOrCreate("irony", null);
  for (const a of [alice, bob, vasu, irony]) {
    console.log(`   ${a.handle.padEnd(6)} axl=${a.axlPubkeyHex.slice(0, 16)}…  iNFT=#${a.inftTokenId ?? "?"}`);
  }

  const compute = new Compute({
    apiKey: ZEROG,
    network: "testnet",
    model: process.env.ZEROG_MODEL ?? "qwen/qwen-2.5-7b-instruct",
  });
  const signer = makeSigner(PK);
  const storage = new Storage({ signer });
  const aliceRep = new RepChain(storage);
  const bobRep = new RepChain(storage);
  const vasuRep = new RepChain(storage);

  // Each agent gets its own LocalBus identity.
  const aliceBus = new LocalBusClient(alice.axlPubkeyHex);
  const bobBus = new LocalBusClient(bob.axlPubkeyHex);
  const vasuBus = new LocalBusClient(vasu.axlPubkeyHex);
  const ironyBus = new LocalBusClient(irony.axlPubkeyHex);

  step(2, "boot bob (summarize) + vasu (sentiment)");
  const bobAgent = new Agent({
    identity: bob,
    axl: bobBus as any,
    compute,
    storage,
    rep: bobRep,
    skills: new SkillRegistry().add(SUMMARIZE),
  });
  const vasuAgent = new Agent({
    identity: vasu,
    axl: vasuBus as any,
    compute,
    storage,
    rep: vasuRep,
    skills: new SkillRegistry().add(SENTIMENT),
  });
  const bobLoop = bobAgent.start();
  const vasuLoop = vasuAgent.start();

  step(3, "boot alice (router) with routing table → bob, vasu");
  const routingTable: RoutingTable = {
    summarize: { destPubkey: bob.axlPubkeyHex, skill: "summarize", ens: "bob.agentdir.eth" },
    sentiment: { destPubkey: vasu.axlPubkeyHex, skill: "sentiment", ens: "vasu.agentdir.eth" },
  };
  const aliceAgent = new Agent({
    identity: alice,
    axl: aliceBus as any,
    compute,
    storage,
    rep: aliceRep,
    skills: new SkillRegistry().add(ROUTE),
    swarm: { axl: aliceBus as any, routingTable },
  });
  const aliceLoop = aliceAgent.start();
  console.log(`   alice route table:`);
  for (const [tag, r] of Object.entries(routingTable)) {
    console.log(`     ${tag.padEnd(10)} → ${r.ens} (${r.destPubkey.slice(0, 16)}…)`);
  }

  step(4, "irony → alice.route(tag=summarize)");
  const text =
    "Decentralized agents need three things to actually be useful: identity, a way to find each other, and a verifiable track record. agentdir provides all three.";
  const t0 = Date.now();
  const r1 = await callSkill({
    axl: ironyBus as any,
    destPubkey: alice.axlPubkeyHex,
    callerPubkey: irony.axlPubkeyHex,
    skill: "route",
    input: { tag: "summarize", payload: { text }, hopBudget: 3 },
    callerINFT: irony.inftTokenId,
  });
  console.log(`   ok in ${Date.now() - t0}ms`);
  const r1out = r1.output as any;
  console.log(`   output:  ${JSON.stringify(r1out.output)}`);
  console.log(`   trace:`);
  for (const hop of r1out.trace) {
    console.log(
      `     ${hop.from.slice(0, 12)}… → ${hop.to.slice(0, 12)}…  ${hop.skill}  ${hop.latencyMs}ms${hop.responderEns ? "  (" + hop.responderEns + ")" : ""}`
    );
  }

  step(5, "irony → alice.route(tag=sentiment)");
  const t1 = Date.now();
  const r2 = await callSkill({
    axl: ironyBus as any,
    destPubkey: alice.axlPubkeyHex,
    callerPubkey: irony.axlPubkeyHex,
    skill: "route",
    input: {
      tag: "sentiment",
      payload: { text: "I love how everything just clicked together at the end." },
      hopBudget: 3,
    },
    callerINFT: irony.inftTokenId,
  });
  console.log(`   ok in ${Date.now() - t1}ms`);
  const r2out = r2.output as any;
  console.log(`   output:  ${JSON.stringify(r2out.output)}`);
  console.log(`   trace:`);
  for (const hop of r2out.trace) {
    console.log(
      `     ${hop.from.slice(0, 12)}… → ${hop.to.slice(0, 12)}…  ${hop.skill}  ${hop.latencyMs}ms${hop.responderEns ? "  (" + hop.responderEns + ")" : ""}`
    );
  }

  step(6, "rep heads (each hop emits its own attestation)");
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline && (!aliceRep.head || !bobRep.head || !vasuRep.head)) {
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log(`   alice rep head: ${aliceRep.head ?? "(pending)"}`);
  console.log(`   bob   rep head: ${bobRep.head ?? "(pending)"}`);
  console.log(`   vasu  rep head: ${vasuRep.head ?? "(pending)"}`);

  bobAgent.stop();
  vasuAgent.stop();
  aliceAgent.stop();
  await Promise.race([
    Promise.all([bobLoop, vasuLoop, aliceLoop]),
    new Promise((r) => setTimeout(r, 2000)),
  ]);
  console.log("\n✅ swarm demo complete\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
