// Server-side wiring for @agentdir/sdk. Lazily constructed singletons so a
// single request doesn't pay reconstruction cost across nested handlers.
//
// Storage requires a signer in its constructor, but only uses it for uploads;
// reads (getJson, indexer.download) never touch the key. For a read-only
// directory UI we either pull a key from env or generate a throwaway wallet.

import "server-only";

import { ethers } from "ethers";
import {
  Directory,
  EnsResolver,
  RepChain,
  Storage,
  makeSigner,
  type DirectoryQuery,
} from "@agentdir/sdk";
import { AGENTDIR } from "./agentdir";

const ZG_RPC = process.env.ZG_RPC_URL ?? "https://evmrpc-testnet.0g.ai";

let _signer: ethers.Signer | null = null;
function getSigner(): ethers.Signer {
  if (_signer) return _signer;
  const pk = process.env.AGENTDIR_READ_KEY ?? process.env.PRIVATE_KEY;
  if (pk && pk.length > 0) {
    _signer = makeSigner(pk, ZG_RPC);
  } else {
    // Throwaway wallet — used only to satisfy the Storage constructor.
    // No on-chain action will ever be signed with this.
    const provider = new ethers.JsonRpcProvider(ZG_RPC);
    _signer = ethers.Wallet.createRandom().connect(provider);
  }
  return _signer;
}

let _storage: Storage | null = null;
export function getStorage(): Storage {
  if (!_storage) _storage = new Storage({ signer: getSigner(), rpcUrl: ZG_RPC });
  return _storage;
}

let _ens: EnsResolver | null = null;
export function getEnsResolver(): EnsResolver {
  if (!_ens) {
    _ens = new EnsResolver({
      network: "sepolia",
      sepoliaRpc: process.env.SEPOLIA_RPC_URL,
    });
  }
  return _ens;
}

let _directory: Directory | null = null;
export function getDirectory(seed?: string[]): Directory {
  // Custom seed → fresh instance. Default seed → cached singleton.
  if (seed && seed.length) {
    return new Directory({
      ens: { network: "sepolia", sepoliaRpc: process.env.SEPOLIA_RPC_URL },
      storage: getStorage(),
      seed,
    });
  }
  if (!_directory) {
    _directory = new Directory({
      ens: { network: "sepolia", sepoliaRpc: process.env.SEPOLIA_RPC_URL },
      storage: getStorage(),
      seed: AGENTDIR.agents.map((a) => a.ens),
    });
  }
  return _directory;
}

export function getRepChain(head: string | null = null): RepChain {
  return new RepChain(getStorage(), head);
}

export type { DirectoryQuery };
