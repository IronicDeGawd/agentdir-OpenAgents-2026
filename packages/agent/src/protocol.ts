// Wire format for inter-agent skill calls over AXL.
// Sent via /send (raw bytes); the agentdir convention is: a single JSON
// envelope per send. We use plain JSON for simplicity — at scale the same
// shape can be wrapped in MCP envelopes for the AXL multiplexer to route
// directly, but our reference runtime polls /recv.

export type SkillRequest = {
  v: 1;
  type: "skill.req";
  id: string; // correlation id (uuid)
  skill: string; // skill.id
  input: unknown;
  // Optional payment intent — opaque to the runtime; used by KH/x402 adapters.
  payment?: { kind: "x402"; tx?: string };
  // Caller's iNFT (caller's identity for rep attestation).
  callerINFT?: string;
};

export type SkillResponseOk = {
  v: 1;
  type: "skill.res";
  id: string;
  ok: true;
  output: unknown;
  // Signature over canonicalJson({id, output}) by the responder's AXL key.
  sig: string;
  signerPubkey: string; // 64-hex; lets caller verify without ENS lookup
};

export type SkillResponseErr = {
  v: 1;
  type: "skill.res";
  id: string;
  ok: false;
  error: string;
};

export type SkillResponse = SkillResponseOk | SkillResponseErr;

export type Envelope = SkillRequest | SkillResponse;

export function isSkillRequest(x: any): x is SkillRequest {
  return x && x.v === 1 && x.type === "skill.req" && typeof x.skill === "string";
}

export function isSkillResponse(x: any): x is SkillResponse {
  return x && x.v === 1 && x.type === "skill.res" && typeof x.id === "string";
}
