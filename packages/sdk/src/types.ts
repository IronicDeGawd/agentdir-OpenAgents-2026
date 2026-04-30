// Shared types for the agentdir SDK.

/**
 * Skill = one named capability an agent advertises and can be paid to perform.
 * Compatible with A2A 0.2.5 AgentSkill shape.
 */
export type Skill = {
  id: string;
  name: string;
  description: string;
  tags: string[]; // A2A required
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  pricing?: {
    x402?: { token: "USDC" | string; chainId: number; amount: string };
  };
};

export type AgentCapabilities = {
  streaming?: boolean;
  pushNotifications?: boolean;
  stateTransitionHistory?: boolean;
};

/**
 * AgentCard = A2A 0.2.5-shaped card plus agentdir-specific identity.
 * Published as the ENS text record `org.a2a.agent-card` (JSON-encoded).
 */
export type AgentCard = {
  protocolVersion: "0.2.5";
  name: string; // ENS subname, e.g. "alice.agentdir.eth"
  description: string;
  url: string; // axl://<axl_pubkey_hex>
  version: string; // implementation version, semver-ish
  capabilities: AgentCapabilities;
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: Skill[];
  identity: {
    erc7857?: { chainId: number; contract: string; tokenId: string };
    axlPubkey: string;
  };
  // Pointer to head of this agent's reputation chain on 0G Storage.
  // ENS text record `network.agentdir.rep-head` mirrors this for cheap lookup.
  repHead?: string;
};

/**
 * One reputation attestation. Append-only chain stored on 0G Storage.
 * Each attestation references the previous root hash, forming a merkle chain.
 */
export type RepAttestation = {
  v: 1;
  callerINFT: string; // erc7857 tokenId of attester
  calleeINFT: string;
  skill: string; // skill.id
  ok: boolean; // success/failure
  latencyMs: number;
  ts: number; // unix seconds
  prevRoot: string | null; // previous attestation rootHash (or null for first)
  // Signature over keccak256(canonicalJson(this without sig)).
  // Signer = caller's AXL ed25519 key (hex).
  sig: string;
};

/**
 * Bundle of ENS text records that agentdir agents publish for an identity.
 * Kept here so the writer (mint flow) and reader (resolver) cannot drift.
 */
export type EnsRecordBundle = {
  "org.a2a.agent-card": string; // JSON.stringify(AgentCard)
  "network.axl.pubkey": string; // 64-char hex ed25519 pubkey
  "network.axl.bootstrap"?: string; // tls://host:port
  "org.erc7857.tokenId"?: string; // decimal string
  "org.erc7857.contract"?: string; // 0x...
  "network.agentdir.rep-head"?: string; // latest rep rootHash
  "pay.x402.uri"?: string; // pricing/payment endpoint
};

export const ENS_RECORD_KEYS: (keyof EnsRecordBundle)[] = [
  "org.a2a.agent-card",
  "network.axl.pubkey",
  "network.axl.bootstrap",
  "org.erc7857.tokenId",
  "org.erc7857.contract",
  "network.agentdir.rep-head",
  "pay.x402.uri",
];
