// ENS read paths for agentdir agents. Writes intentionally not here yet —
// path (Sepolia onchain vs NameStone offchain) decided in Phase 1.5.

import { createPublicClient, http, toCoinType, type PublicClient } from "viem";
import { mainnet, sepolia } from "viem/chains";
import { normalize } from "viem/ens";
import { ENS_RECORD_KEYS, type AgentCard, type EnsRecordBundle } from "./types.js";
import { parseAgentCard } from "./agent-card.js";

export type EnsClientOpts = {
  mainnetRpc?: string;
  sepoliaRpc?: string;
  /** which chain's text records to read; default mainnet */
  network?: "mainnet" | "sepolia";
};

export class EnsResolver {
  readonly client: PublicClient;
  readonly network: "mainnet" | "sepolia";

  constructor(opts: EnsClientOpts = {}) {
    this.network = opts.network ?? "mainnet";
    const url =
      this.network === "mainnet"
        ? (opts.mainnetRpc ?? "https://eth.drpc.org")
        : (opts.sepoliaRpc ?? "https://sepolia.drpc.org");
    this.client = createPublicClient({
      chain: this.network === "mainnet" ? mainnet : sepolia,
      transport: http(url, { timeout: 15_000, retryCount: 2 }),
    });
  }

  async getAddress(name: string): Promise<string | null> {
    return this.client.getEnsAddress({ name: normalize(name) });
  }

  /** Multichain: resolve EVM address for a specific L2 chainId. */
  async getAddressForChain(name: string, chainId: number): Promise<string | null> {
    return this.client.getEnsAddress({
      name: normalize(name),
      coinType: toCoinType(chainId),
    });
  }

  async getPrimaryName(address: `0x${string}`): Promise<string | null> {
    return this.client.getEnsName({ address });
  }

  async getText(name: string, key: string): Promise<string | null> {
    return this.client.getEnsText({ name: normalize(name), key });
  }

  /** Fetch every agentdir text record in parallel. Missing → undefined. */
  async getRecordBundle(name: string): Promise<Partial<EnsRecordBundle>> {
    const entries = await Promise.all(
      ENS_RECORD_KEYS.map(async (k) => [k, await this.getText(name, k)] as const)
    );
    const out: Partial<EnsRecordBundle> = {};
    for (const [k, v] of entries) if (v) (out as any)[k] = v;
    return out;
  }

  /** Pull the AgentCard for a name. Throws if missing or malformed. */
  async getAgentCard(name: string): Promise<AgentCard> {
    const json = await this.getText(name, "org.a2a.agent-card");
    if (!json) throw new Error(`no org.a2a.agent-card on ${name}`);
    return parseAgentCard(json);
  }

  /**
   * Spoofing defense:
   * (1) ENS name resolves to expected wallet,
   * (2) reverse resolution from that wallet returns the same name,
   * (3) AgentCard's axlPubkey matches the `network.axl.pubkey` text record.
   * Returns null on success, error string otherwise.
   */
  async verifyIdentity(name: string, expectedAxlPubkey: string): Promise<string | null> {
    const addr = await this.getAddress(name);
    if (!addr) return "name does not resolve";
    const reverse = await this.getPrimaryName(addr as `0x${string}`);
    if (reverse?.toLowerCase() !== name.toLowerCase()) return "reverse mismatch";
    const pub = await this.getText(name, "network.axl.pubkey");
    if (!pub || pub.toLowerCase() !== expectedAxlPubkey.toLowerCase())
      return "axl.pubkey mismatch";
    return null;
  }
}
