// Wire format for inter-agent skill calls over AXL.
// Sent via /send (raw bytes); the agentdir convention is: a single JSON
// envelope per send. We use plain JSON for simplicity — at scale the same
// shape can be wrapped in MCP envelopes for the AXL multiplexer to route
// directly, but our reference runtime polls /recv.

export type SkillRequest = {
  v: 1;
  type: "skill.req";
  id: string; // correlation id (UUIDv4 from node:crypto)
  nonce: string; // CSPRNG bytes hex; replay defense
  ts: number; // unix ms; replay defense (server enforces freshness window)
  skill: string; // skill.id
  input: unknown;
  // Optional payment intent — opaque to runtime; used by KH/x402 adapters.
  payment?: { kind: "x402"; tx?: string };
  // Caller's iNFT (caller's identity for rep attestation).
  callerINFT?: string;
  // Caller's AXL pubkey — bound into responder sig domain.
  callerPubkey: string;
};

/**
 * Domain for response signatures. Bound fields:
 *  v=1, id, ok, output|error, responder pubkey, caller pubkey, skill, ts.
 * Replays across (caller, responder, skill, time) tuples are not accepted.
 */
export type ResponseSigDomain = {
  v: 1;
  id: string;
  ok: boolean;
  /** present iff ok=true */
  output?: unknown;
  /** present iff ok=false */
  error?: string;
  responder: string; // 64-hex
  caller: string; // 64-hex
  skill: string;
  ts: number; // unix ms when responder signed
};

export type SkillResponseOk = {
  v: 1;
  type: "skill.res";
  id: string;
  ok: true;
  output: unknown;
  ts: number;
  responder: string; // duplicated for audit; verifier MUST recompute over expected responder
  caller: string;
  skill: string;
  sig: string;
  signerPubkey: string; // 64-hex; lets caller verify without ENS lookup
};

export type SkillResponseErr = {
  v: 1;
  type: "skill.res";
  id: string;
  ok: false;
  error: string;
  ts: number;
  responder: string;
  caller: string;
  skill: string;
  sig: string;
  signerPubkey: string;
};

export type SkillResponse = SkillResponseOk | SkillResponseErr;

export type Envelope = SkillRequest | SkillResponse;

export function isSkillRequest(x: any): x is SkillRequest {
  return (
    x &&
    x.v === 1 &&
    x.type === "skill.req" &&
    typeof x.id === "string" &&
    typeof x.nonce === "string" &&
    typeof x.ts === "number" &&
    typeof x.skill === "string" &&
    typeof x.callerPubkey === "string"
  );
}

export function isSkillResponse(x: any): x is SkillResponse {
  return x && x.v === 1 && x.type === "skill.res" && typeof x.id === "string";
}
