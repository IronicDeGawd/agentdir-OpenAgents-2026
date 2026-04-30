// A2A-compatible AgentCard build/parse + signature helpers.
// AgentCard is published as ENS text record `org.a2a.agent-card`, byte-equal
// JSON, signed by the agent's AXL ed25519 key for spoof-resistance.

import { keccak256, toHex } from "viem";
import type { AgentCapabilities, AgentCard, Skill } from "./types.js";

export function buildAgentCard(input: {
  name: string;
  description: string;
  axlPubkey: string;
  skills: Skill[];
  version?: string;
  capabilities?: AgentCard["capabilities"];
  defaultInputModes?: string[];
  defaultOutputModes?: string[];
  erc7857?: { chainId: number; contract: string; tokenId: string };
  repHead?: string;
}): AgentCard {
  const identity: AgentCard["identity"] = { axlPubkey: input.axlPubkey };
  if (input.erc7857) identity.erc7857 = input.erc7857;
  const card: AgentCard = {
    protocolVersion: "0.2.5",
    name: input.name,
    description: input.description,
    url: `axl://${input.axlPubkey}`,
    version: input.version ?? "0.1.0",
    capabilities: input.capabilities ?? {},
    defaultInputModes: input.defaultInputModes ?? ["text/plain"],
    defaultOutputModes: input.defaultOutputModes ?? ["text/plain"],
    skills: input.skills.map((s) => ({ ...s, tags: s.tags ?? [] })),
    identity,
  };
  if (input.repHead) card.repHead = input.repHead;
  return card;
}

/**
 * Stable JSON encoding for canonical hashing. Sorts keys deeply.
 * Drops undefined values to mirror JSON.stringify semantics —
 * required so signatures over the card are reproducible across producers.
 */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k])).join(",") + "}";
}

/** keccak256 hash of canonical-json card encoding, hex-encoded. */
export function cardDigest(card: AgentCard): `0x${string}` {
  return keccak256(toHex(canonicalJson(card)));
}

/**
 * Validate a card has the required fields and skill shapes.
 * Returns null on success, error message otherwise.
 */
export function validateAgentCard(card: unknown): string | null {
  if (!card || typeof card !== "object") return "card is not an object";
  const c = card as AgentCard;
  if (c.protocolVersion !== "0.2.5") return "protocolVersion must be 0.2.5";
  if (!c.name || !c.name.includes(".")) return "name must be a dotted ENS name";
  if (!c.version || typeof c.version !== "string") return "version must be a string";
  if (!c.capabilities || typeof c.capabilities !== "object")
    return "capabilities must be an object";
  if (!Array.isArray(c.defaultInputModes)) return "defaultInputModes must be an array";
  if (!Array.isArray(c.defaultOutputModes)) return "defaultOutputModes must be an array";
  if (!c.identity?.axlPubkey || !/^[0-9a-fA-F]{64}$/.test(c.identity.axlPubkey))
    return "identity.axlPubkey must be 64-hex ed25519 pubkey";
  if (!Array.isArray(c.skills)) return "skills must be an array";
  for (const s of c.skills) {
    if (!s.id || !s.name) return `skill missing id/name: ${JSON.stringify(s)}`;
    if (!Array.isArray(s.tags)) return `skill ${s.id} missing tags array`;
    if (!s.inputSchema || typeof s.inputSchema !== "object")
      return `skill ${s.id} missing inputSchema`;
  }
  return null;
}

// re-export for SDK consumers
export type { AgentCapabilities };

export function parseAgentCard(json: string): AgentCard {
  const c = JSON.parse(json);
  const err = validateAgentCard(c);
  if (err) throw new Error("invalid AgentCard: " + err);
  return c;
}
