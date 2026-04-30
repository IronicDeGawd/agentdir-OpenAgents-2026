// 0G Storage wrappers. File upload → rootHash; download verifies merkle proof.
// We do NOT use 0G KV — see context/progress.md for rationale.

import { ethers, type Signer } from "ethers";
import { Indexer, MemData } from "@0gfoundation/0g-ts-sdk";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const TESTNET_RPC = "https://evmrpc-testnet.0g.ai";
const TESTNET_INDEXER = "https://indexer-storage-testnet-turbo.0g.ai";

export type StorageOpts = {
  rpcUrl?: string;
  indexerUrl?: string;
  signer: Signer;
};

export class Storage {
  readonly indexer: Indexer;
  readonly rpcUrl: string;
  readonly signer: Signer;

  constructor(opts: StorageOpts) {
    this.rpcUrl = opts.rpcUrl ?? TESTNET_RPC;
    this.indexer = new Indexer(opts.indexerUrl ?? TESTNET_INDEXER);
    this.signer = opts.signer;
  }

  /** Upload a JSON-serializable value, return content-addressed rootHash. */
  async putJson(value: unknown): Promise<string> {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    return this.putBytes(bytes);
  }

  async putBytes(data: Uint8Array): Promise<string> {
    const mem = new MemData(data);
    const [tree, treeErr] = await mem.merkleTree();
    if (treeErr !== null) throw new Error(`merkle: ${treeErr}`);
    const root = tree?.rootHash();
    if (!root) throw new Error("no rootHash");
    const [, err] = await this.indexer.upload(mem, this.rpcUrl, this.signer);
    if (err !== null) throw new Error(`upload: ${err}`);
    return root;
  }

  /** Download by rootHash, verify proof, return bytes. */
  async getBytes(rootHash: string): Promise<Uint8Array> {
    // Always tmpdir() — CWD may be unwritable in packaged agents.
    // randomUUID prevents same-millisecond collisions on concurrent gets.
    const tmp = join(tmpdir(), `agentdir-dl-${randomUUID()}.bin`);
    const err = await this.indexer.download(rootHash, tmp, true);
    if (err !== null) throw new Error(`download: ${err}`);
    const fs = await import("node:fs/promises");
    try {
      const buf = await fs.readFile(tmp);
      return new Uint8Array(buf);
    } finally {
      await fs.unlink(tmp).catch(() => {});
    }
  }

  async getJson<T = unknown>(rootHash: string): Promise<T> {
    const bytes = await this.getBytes(rootHash);
    return JSON.parse(new TextDecoder().decode(bytes));
  }
}

export function makeSigner(privateKey: string, rpcUrl = TESTNET_RPC): Signer {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  return new ethers.Wallet(privateKey, provider);
}
