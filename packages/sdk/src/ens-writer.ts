// ENS Sepolia write helpers. Sets text records on a name we own via the
// PublicResolver contract. Reads use EnsResolver from ./ens.ts.
//
// This is the on-chain path. For gasless / offchain subnames we'd plug in
// a NameStone-style HTTP adapter exposing the same setText interface.

import {
  createWalletClient,
  http,
  fallback,
  type Hex,
  type WalletClient,
  type Account,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { namehash, normalize } from "viem/ens";
import type { AgentCard, EnsRecordBundle } from "./types.js";
import { ENS_RECORD_KEYS } from "./types.js";

const SEPOLIA_PUBLIC_RESOLVER: Hex = "0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5";

const RESOLVER_ABI = [
  {
    type: "function",
    name: "setText",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
      { name: "value", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "text",
    stateMutability: "view",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
    ],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

export type EnsWriterOpts = {
  privateKey: Hex;
  rpcUrl?: string;
  /** Override resolver (e.g. if the name uses a non-default resolver). */
  resolver?: Hex;
};

export class EnsWriter {
  readonly client: WalletClient;
  readonly account: Account;
  readonly resolver: Hex;

  constructor(opts: EnsWriterOpts) {
    this.account = privateKeyToAccount(opts.privateKey);
    // Build a fallback chain: explicit opts.rpcUrl, then SEPOLIA_RPC_URL,
    // then publicnode.com, then Alchemy if available. drpc.org rate-limits
    // writes on free tier — keep it last/excluded.
    const candidates = [
      opts.rpcUrl,
      process.env.SEPOLIA_RPC_URL,
      "https://ethereum-sepolia-rpc.publicnode.com",
      process.env.ALCHEMY_RPC_URL?.trim(),
    ].filter((u): u is string => !!u && u.length > 0);
    const transport =
      candidates.length === 1
        ? http(candidates[0])
        : fallback(candidates.map((u) => http(u)), { rank: false });
    this.client = createWalletClient({
      account: this.account,
      chain: sepolia,
      transport,
    });
    this.resolver = opts.resolver ?? SEPOLIA_PUBLIC_RESOLVER;
  }

  /** Set a single text record. Returns the txHash. */
  async setText(name: string, key: string, value: string): Promise<Hex> {
    const node = namehash(normalize(name));
    return this.client.writeContract({
      address: this.resolver,
      abi: RESOLVER_ABI,
      functionName: "setText",
      args: [node, key, value],
      chain: sepolia,
      account: this.account,
    });
  }

  /** Bulk-publish the agentdir record bundle for one agent. Sequential. */
  async publishBundle(name: string, bundle: Partial<EnsRecordBundle>): Promise<Hex[]> {
    const out: Hex[] = [];
    for (const k of ENS_RECORD_KEYS) {
      const v = bundle[k];
      if (!v) continue;
      const tx = await this.setText(name, k, v);
      out.push(tx);
    }
    return out;
  }

  /** Convenience: build the record bundle from an AgentCard + extras. */
  static bundleFromCard(card: AgentCard, extras: Partial<EnsRecordBundle> = {}): Partial<EnsRecordBundle> {
    const out: Partial<EnsRecordBundle> = {
      "org.a2a.agent-card": JSON.stringify(card),
      "network.axl.pubkey": card.identity.axlPubkey,
    };
    if (card.identity.erc7857) {
      out["org.erc7857.contract"] = card.identity.erc7857.contract;
      out["org.erc7857.tokenId"] = card.identity.erc7857.tokenId;
    }
    if (card.repHead) out["network.agentdir.rep-head"] = card.repHead;
    return { ...out, ...extras };
  }
}
