// Minimal AgentdirINFT wrapper. Two responsibilities:
//   1. setAgentStateRoot(tokenId, newRoot) — token-owner-only state rotation.
//   2. Walk AgentStateUpdated event log for a tokenId — history of root bumps.
//
// Reads use whatever provider is passed; writes need a Signer that owns
// the token. 0G Galileo requires min 2 gwei tip — caller must set gasPrice.

import { ethers, type Provider, type Signer } from "ethers";

const ABI = [
  "function setAgentStateRoot(uint256 tokenId, bytes32 newRoot) external",
  "function agentStateRoot(uint256 tokenId) external view returns (bytes32)",
  "function ownerOf(uint256 tokenId) external view returns (address)",
  "event AgentStateUpdated(uint256 indexed tokenId, bytes32 prevRoot, bytes32 newRoot, address indexed by)",
];

export type InftWriterOpts = {
  contract: string;
  signer?: Signer;
  provider?: Provider;
  /** Gas price in wei. 0G Galileo needs >= 2 gwei tip; default 5 gwei. */
  gasPriceWei?: bigint;
};

export type StateUpdateEvent = {
  tokenId: string;
  prevRoot: string;
  newRoot: string;
  by: string;
  blockNumber: number;
  txHash: string;
};

/** rootHash from 0G Storage is `0x` + 64 hex (bytes32). Throws on empty/garbage —
 *  silently zeroing on-chain state on a typo is worse than a hard error. */
function asBytes32(root: string): string {
  if (!root) throw new Error("setStateRoot: empty rootHash");
  const h = root.startsWith("0x") ? root : "0x" + root;
  if (!/^0x[0-9a-fA-F]{64}$/.test(h)) throw new Error(`not bytes32: ${root}`);
  return h;
}

export class InftWriter {
  readonly contract: string;
  readonly signer?: Signer;
  readonly provider: Provider;
  readonly gasPriceWei: bigint;

  constructor(opts: InftWriterOpts) {
    if (!opts.signer && !opts.provider) {
      throw new Error("InftWriter needs signer or provider");
    }
    this.contract = opts.contract;
    this.signer = opts.signer;
    // Signers in ethers v6 always have a provider; prefer the explicit one.
    this.provider = opts.provider ?? (opts.signer!.provider as Provider);
    this.gasPriceWei = opts.gasPriceWei ?? ethers.parseUnits("5", "gwei");
  }

  /** Read current state root for tokenId. */
  async getStateRoot(tokenId: string | number | bigint): Promise<string> {
    const c = new ethers.Contract(this.contract, ABI, this.provider);
    return c.agentStateRoot!(BigInt(tokenId));
  }

  async ownerOf(tokenId: string | number | bigint): Promise<string> {
    const c = new ethers.Contract(this.contract, ABI, this.provider);
    return c.ownerOf!(BigInt(tokenId));
  }

  /** Rotate state root. Caller must own the token. Returns tx hash. */
  async setStateRoot(tokenId: string | number | bigint, newRoot: string): Promise<string> {
    if (!this.signer) throw new Error("setStateRoot requires signer");
    const root32 = asBytes32(newRoot); // validate before any RPC.
    // Pre-flight ownership check. Cheap eth_call beats a reverted tx that
    // burns gas to tell us "NotTokenOwner".
    const expected = (await this.signer.getAddress()).toLowerCase();
    const owner = (await this.ownerOf(tokenId)).toLowerCase();
    if (owner !== expected) {
      throw new Error(`setStateRoot: signer ${expected} does not own token ${tokenId} (owner=${owner})`);
    }
    const c = new ethers.Contract(this.contract, ABI, this.signer);
    const tx = await c.setAgentStateRoot!(BigInt(tokenId), root32, {
      gasPrice: this.gasPriceWei,
    });
    await tx.wait();
    return tx.hash;
  }

  /**
   * Walk AgentStateUpdated events for a tokenId. Returns oldest → newest.
   * `fromBlock` defaults to 0 — callers SHOULD pass the deployment block to
   * keep RPC happy on long-lived contracts.
   */
  async stateHistory(
    tokenId: string | number | bigint,
    fromBlock: number | bigint = 0
  ): Promise<StateUpdateEvent[]> {
    const c = new ethers.Contract(this.contract, ABI, this.provider);
    const filter = c.filters.AgentStateUpdated!(BigInt(tokenId));
    const logs = await c.queryFilter(filter, fromBlock, "latest");
    return logs.map((log: any) => ({
      tokenId: String(log.args[0]),
      prevRoot: log.args[1],
      newRoot: log.args[2],
      by: log.args[3],
      blockNumber: log.blockNumber,
      txHash: log.transactionHash,
    }));
  }
}
