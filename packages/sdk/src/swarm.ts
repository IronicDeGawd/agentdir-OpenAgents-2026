// Swarm primitives: types + helpers for multi-agent routing.
//
// Mental model:
//   - A "swarm" is a sequence of signed skill calls across multiple
//     agent identities. Each hop is a normal SkillRequest/SkillResponse
//     over LocalBus or AXL — no new transport needed.
//   - One agent (the router) hosts a `route` skill. Its handler picks
//     a downstream agent for a tag, forwards the call, and packages
//     the downstream output + a RouteHop record.
//   - The full trace is a list of RouteHop objects. The terminal agent
//     in the trace produced the final answer; intermediates are just
//     witnesses.
//
// The router NEVER fabricates a downstream response — it has to
// actually call the downstream agent. So a 3-hop trace is 3 real
// signed responses, each verifiable independently.

export type RouteHop = {
  from: string; // caller AXL pubkey hex (no 0x)
  to: string; // responder AXL pubkey hex
  skill: string;
  ok: boolean;
  latencyMs: number;
  /** Optional ENS name of the responder, for nicer UI display. */
  responderEns?: string;
};

/**
 * Static routing table mapping skill IDs to a downstream agent.
 * Real implementations would query the directory + sort by rep score
 * (E5 — reputation-driven discovery). For E4 we keep this static so
 * the swarm is reproducible during demos.
 */
export type RoutingEntry = {
  /** Downstream agent's AXL pubkey hex (no 0x). */
  destPubkey: string;
  /** Concrete skill id to invoke on the downstream agent. */
  skill: string;
  /** Optional ENS name for display in trace. */
  ens?: string;
};

export type RoutingTable = Record<string, RoutingEntry>;

export type RouteSkillInput = {
  /** Tag the router should pick a downstream for. e.g. "summarize". */
  tag: string;
  /** Forwarded as `input` to the downstream skill. */
  payload: unknown;
  /** Max remaining hops. Decrements at each route step. 0 = abort. */
  hopBudget?: number;
};

export type RouteSkillOutput = {
  /** Final downstream output, untouched. */
  output: unknown;
  /** Routing trace, oldest hop first. */
  trace: RouteHop[];
};
