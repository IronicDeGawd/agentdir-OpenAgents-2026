import { test } from "node:test";
import assert from "node:assert/strict";
import { EnsWriter } from "./ens-writer.js";
import { buildAgentCard } from "./agent-card.js";

const card = buildAgentCard({
  name: "alice.agentdir.eth",
  description: "demo",
  axlPubkey: "a".repeat(64),
  skills: [
    {
      id: "summarize",
      name: "summarize",
      description: "x",
      tags: ["nlp"],
      inputSchema: { type: "object" },
    },
  ],
  erc7857: { chainId: 16602, contract: "0x3061d8567ce510dcaf079dc59f7313be094261b0", tokenId: "1" },
  repHead: "0xabc",
});

test("bundleFromCard packs all expected keys", () => {
  const b = EnsWriter.bundleFromCard(card, { "network.axl.bootstrap": "tls://1.2.3.4:9001" });
  assert.ok(b["org.a2a.agent-card"]);
  assert.equal(b["network.axl.pubkey"], card.identity.axlPubkey);
  assert.equal(b["org.erc7857.tokenId"], "1");
  assert.equal(b["org.erc7857.contract"], card.identity.erc7857!.contract);
  assert.equal(b["network.agentdir.rep-head"], "0xabc");
  assert.equal(b["network.axl.bootstrap"], "tls://1.2.3.4:9001");
  // round-trip card json must parse back valid
  const back = JSON.parse(b["org.a2a.agent-card"]!);
  assert.equal(back.name, card.name);
});

test("bundleFromCard omits absent fields", () => {
  const minimal = buildAgentCard({
    name: "bob.agentdir.eth",
    description: "demo",
    axlPubkey: "b".repeat(64),
    skills: [],
  });
  const b = EnsWriter.bundleFromCard(minimal);
  assert.ok(b["org.a2a.agent-card"]);
  assert.equal(b["network.axl.pubkey"], "b".repeat(64));
  assert.equal(b["org.erc7857.tokenId"], undefined);
  assert.equal(b["network.agentdir.rep-head"], undefined);
});
