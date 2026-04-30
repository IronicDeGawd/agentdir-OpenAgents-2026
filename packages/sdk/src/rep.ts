// Reputation chain: append-only attestations on 0G Storage.
// Each attestation JSON references the previous attestation's rootHash;
// the agent's ENS text record `network.agentdir.rep-head` always points
// at the most recent root. Merkle-verifiable, no separate service.

import { keccak256, toHex } from "viem";
import { canonicalJson } from "./agent-card.js";
import type { Storage } from "./storage.js";
import type { RepAttestation } from "./types.js";

export type AppendInput = Omit<RepAttestation, "v" | "ts" | "prevRoot" | "sig"> & {
  signer: (digestHex: `0x${string}`) => Promise<string>; // ed25519 sig hex
};

export class RepChain {
  constructor(
    public readonly storage: Storage,
    public head: string | null = null
  ) {}

  /** Compute digest the signer must sign. */
  static digest(att: Omit<RepAttestation, "sig">): `0x${string}` {
    return keccak256(toHex(canonicalJson(att)));
  }

  async append(input: AppendInput): Promise<{ root: string; att: RepAttestation }> {
    const base: Omit<RepAttestation, "sig"> = {
      v: 1,
      callerINFT: input.callerINFT,
      calleeINFT: input.calleeINFT,
      skill: input.skill,
      ok: input.ok,
      latencyMs: input.latencyMs,
      ts: Math.floor(Date.now() / 1000),
      prevRoot: this.head,
    };
    const sig = await input.signer(RepChain.digest(base));
    const att: RepAttestation = { ...base, sig };
    const root = await this.storage.putJson(att);
    this.head = root;
    return { root, att };
  }

  async getAt(rootHash: string): Promise<RepAttestation> {
    return this.storage.getJson<RepAttestation>(rootHash);
  }

  /** Walk chain from `head` backward up to `limit` entries (oldest last). */
  async walk(head: string, limit = 100): Promise<RepAttestation[]> {
    const out: RepAttestation[] = [];
    let cur: string | null = head;
    while (cur && out.length < limit) {
      const a: RepAttestation = await this.getAt(cur);
      out.push(a);
      cur = a.prevRoot;
    }
    return out;
  }

  /** Crude success-rate score over recent N attestations targeting `inft`. */
  static score(attestations: RepAttestation[], targetINFT: string): { n: number; ok: number; ratio: number } {
    const filtered = attestations.filter((a) => a.calleeINFT === targetINFT);
    const ok = filtered.filter((a) => a.ok).length;
    const n = filtered.length;
    return { n, ok, ratio: n === 0 ? 0 : ok / n };
  }
}
