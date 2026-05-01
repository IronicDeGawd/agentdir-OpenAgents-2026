// Reputation-driven agent directory (E5).
//
// Today ENS does not expose subname enumeration directly — there is no
// "list every name under agentdir.eth" RPC. Production deploys would
// query a subgraph. For the hackathon we accept a seed list of names
// and let callers add to it; the ranking logic is what matters.
//
// Pipeline:
//   1. For each ENS name in the seed, fetch the AgentCard +
//      `network.agentdir.rep-head` text record.
//   2. Filter cards whose skills.id list contains the requested skill.
//   3. Walk each rep chain (bounded by `lookback`) and compute a
//      confidence-weighted success score via RepChain.scoreFor.
//   4. Sort descending by score; cap at `limit`.
//
// The whole pipeline is parallel-friendly — Promise.all over names —
// so a directory of 50 candidates ranks in ~one round trip.

import { EnsResolver, type EnsClientOpts } from "./ens.js";
import { parseAgentCard } from "./agent-card.js";
import { RepChain } from "./rep.js";
import type { Storage } from "./storage.js";
import type { AgentCard } from "./types.js";

export type DirectoryOpts = {
  /** ENS read client config (mainnet vs sepolia, RPC override). */
  ens?: EnsClientOpts;
  /** 0G Storage for walking rep chains. */
  storage: Storage;
  /** ENS names to consider. Required until subgraph wiring lands. */
  seed: string[];
};

export type DirectoryQuery = {
  /** Skill id the caller wants. */
  skill: string;
  /** Lower bound on agent score; defaults to 0. */
  minScore?: number;
  /** Max ranked entries to return. Defaults to 10. */
  limit?: number;
  /** Attestation window per agent. Defaults to 50. */
  lookback?: number;
};

export type DirectoryEntry = {
  ens: string;
  card: AgentCard;
  inftTokenId: string | null;
  repHead: string | null;
  /** RepChain.scoreFor output. n=0 when chain unavailable or empty. */
  score: { n: number; ok: number; ratio: number; score: number };
};

export class Directory {
  readonly resolver: EnsResolver;
  readonly storage: Storage;
  readonly seed: string[];

  constructor(opts: DirectoryOpts) {
    this.resolver = new EnsResolver(opts.ens);
    this.storage = opts.storage;
    this.seed = opts.seed;
  }

  /** Ranked candidates serving `skill`, newest-attestation-weighted. */
  async query(q: DirectoryQuery): Promise<DirectoryEntry[]> {
    const lookback = q.lookback ?? 50;
    const minScore = q.minScore ?? 0;
    const limit = q.limit ?? 10;

    const entries = await Promise.all(
      this.seed.map((name) => this.entryFor(name, q.skill, lookback))
    );
    return entries
      .filter((e): e is DirectoryEntry => e !== null)
      .filter((e) => e.score.score >= minScore)
      .sort((a, b) => b.score.score - a.score.score)
      .slice(0, limit);
  }

  private async entryFor(
    ens: string,
    skill: string,
    lookback: number
  ): Promise<DirectoryEntry | null> {
    let bundle;
    try {
      bundle = await this.resolver.getRecordBundle(ens);
    } catch {
      return null; // ENS resolution failed for this name
    }
    const cardJson = bundle["org.a2a.agent-card"];
    if (!cardJson) return null;

    let card: AgentCard;
    try {
      card = parseAgentCard(cardJson);
    } catch {
      return null;
    }
    if (!card.skills.some((s) => s.id === skill)) return null;

    const inftTokenId = bundle["org.erc7857.tokenId"] ?? null;
    const repHead = bundle["network.agentdir.rep-head"] ?? null;

    let score = { n: 0, ok: 0, ratio: 0, score: 0 };
    if (repHead && inftTokenId) {
      try {
        const chain = new RepChain(this.storage);
        const list = await chain.walk(repHead, lookback);
        score = RepChain.scoreFor(list, inftTokenId, { skill, lookback });
      } catch {
        // chain walk failed — leave score at zero; agent still listed
      }
    }
    return { ens, card, inftTokenId, repHead, score };
  }
}
