import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAgentCard,
  canonicalJson,
  cardDigest,
  parseAgentCard,
  validateAgentCard,
} from "./agent-card.js";
import type { Skill } from "./types.js";

const skill: Skill = {
  id: "summarize",
  name: "summarize",
  description: "summarize text",
  tags: ["nlp"],
  inputSchema: { type: "object", properties: { text: { type: "string" } } },
  pricing: { x402: { token: "USDC", chainId: 8453, amount: "10000" } },
};

const sampleCard = buildAgentCard({
  name: "alice.agentdir.eth",
  description: "demo agent",
  axlPubkey: "a".repeat(64),
  skills: [skill],
});

test("canonicalJson sorts keys deeply", () => {
  const a = canonicalJson({ b: 1, a: { d: 2, c: 3 } });
  const b = canonicalJson({ a: { c: 3, d: 2 }, b: 1 });
  assert.equal(a, b);
});

test("buildAgentCard produces a valid card", () => {
  assert.equal(validateAgentCard(sampleCard), null);
});

test("validateAgentCard rejects bad pubkey", () => {
  const bad = { ...sampleCard, identity: { axlPubkey: "not-hex" } };
  const err = validateAgentCard(bad);
  assert.match(err ?? "", /axlPubkey/);
});

test("validateAgentCard rejects skill missing tags", () => {
  const bad = { ...sampleCard, skills: [{ ...skill, tags: undefined as any }] };
  const err = validateAgentCard(bad);
  assert.match(err ?? "", /tags/);
});

test("canonicalJson drops undefined values", () => {
  const a = canonicalJson({ a: 1, b: undefined, c: 2 });
  assert.equal(a, '{"a":1,"c":2}');
});

test("validateAgentCard rejects missing skill schema", () => {
  const bad = {
    ...sampleCard,
    skills: [{ id: "x", name: "x", description: "x", tags: [] } as any],
  };
  const err = validateAgentCard(bad);
  assert.match(err ?? "", /inputSchema/);
});

test("parseAgentCard rejects invalid", () => {
  assert.throws(() => parseAgentCard("{}"));
});

test("parseAgentCard accepts roundtrip", () => {
  const json = JSON.stringify(sampleCard);
  const back = parseAgentCard(json);
  assert.equal(back.name, sampleCard.name);
});

test("cardDigest stable across key reorderings", () => {
  const a = cardDigest(sampleCard);
  const reordered = JSON.parse(JSON.stringify(sampleCard));
  reordered.skills = [...reordered.skills];
  const b = cardDigest(reordered);
  assert.equal(a, b);
});
