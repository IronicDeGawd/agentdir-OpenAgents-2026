// Memory snapshot chain: agent state serialized as JSON blob on 0G Storage,
// linked by prevSnapshotRoot. Latest root is anchored on-chain via
// `setAgentStateRoot(tokenId, root)` on the AgentdirINFT contract.
//
// Snapshot blob captures: rep head pointer, attestation count, per-skill stats,
// timestamp, agent ENS name, signer pubkey. Signed by agent's AXL key so chain
// is forge-resistant.

import { keccak256, toHex } from "viem";
import * as ed from "@noble/ed25519";
import { canonicalJson } from "./agent-card.js";
import type { Storage } from "./storage.js";

export type SkillStats = {
  /** skill.id → { calls, ok, errLastTs } */
  [skillId: string]: { calls: number; ok: number; errLastTs?: number };
};

export type MemorySnapshot = {
  v: 1;
  ensName: string;
  signerPubkey: string; // 64-char hex
  inftTokenId: string;
  ts: number; // unix seconds
  callsTotal: number;
  okTotal: number;
  skillStats: SkillStats;
  repHead: string | null;
  prevSnapshotRoot: string | null;
  sig: string; // ed25519 over keccak256(canonicalJson(this without sig))
};

export type SnapshotBody = Omit<MemorySnapshot, "sig">;

const stripHex = (h: string) => (h.startsWith("0x") ? h.slice(2) : h);

export class SnapshotChain {
  // Serialize writes so concurrent rotations don't fork the chain.
  private _lock: Promise<unknown> = Promise.resolve();

  constructor(
    public readonly storage: Storage,
    public head: string | null = null
  ) {}

  static digest(body: SnapshotBody): `0x${string}` {
    return keccak256(toHex(canonicalJson(body)));
  }

  static async verify(snap: MemorySnapshot, signerPubkeyHex: string): Promise<boolean> {
    try {
      const { sig, ...rest } = snap;
      const digest = SnapshotChain.digest(rest);
      const sigBytes = Buffer.from(stripHex(sig), "hex");
      const pubBytes = Buffer.from(stripHex(signerPubkeyHex), "hex");
      const msgBytes = Buffer.from(stripHex(digest), "hex");
      return await ed.verifyAsync(sigBytes, msgBytes, pubBytes);
    } catch {
      return false;
    }
  }

  async append(input: {
    ensName: string;
    signerPubkey: string;
    inftTokenId: string;
    callsTotal: number;
    okTotal: number;
    skillStats: SkillStats;
    repHead: string | null;
    signer: (digestHex: `0x${string}`) => Promise<string>;
  }): Promise<{ root: string; snapshot: MemorySnapshot }> {
    const run = (this._lock = this._lock.then(() => this._appendInner(input)));
    return run as Promise<{ root: string; snapshot: MemorySnapshot }>;
  }

  private async _appendInner(input: {
    ensName: string;
    signerPubkey: string;
    inftTokenId: string;
    callsTotal: number;
    okTotal: number;
    skillStats: SkillStats;
    repHead: string | null;
    signer: (digestHex: `0x${string}`) => Promise<string>;
  }) {
    const body: SnapshotBody = {
      v: 1,
      ensName: input.ensName,
      signerPubkey: input.signerPubkey,
      inftTokenId: input.inftTokenId,
      ts: Math.floor(Date.now() / 1000),
      callsTotal: input.callsTotal,
      okTotal: input.okTotal,
      skillStats: input.skillStats,
      repHead: input.repHead,
      prevSnapshotRoot: this.head,
    };
    const sig = await input.signer(SnapshotChain.digest(body));
    const snapshot: MemorySnapshot = { ...body, sig };
    const root = await this.storage.putJson(snapshot);
    this.head = root;
    return { root, snapshot };
  }

  async getAt(rootHash: string): Promise<MemorySnapshot> {
    return this.storage.getJson<MemorySnapshot>(rootHash);
  }

  /** Walk snapshot chain backward from head. */
  async walk(head: string, limit = 50, verifyKey?: string): Promise<MemorySnapshot[]> {
    const out: MemorySnapshot[] = [];
    let cur: string | null = head;
    while (cur && out.length < limit) {
      const s: MemorySnapshot = await this.getAt(cur);
      if (verifyKey && !(await SnapshotChain.verify(s, verifyKey))) break;
      out.push(s);
      cur = s.prevSnapshotRoot;
    }
    return out;
  }
}
