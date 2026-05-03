// Server-side wiring for @agentdir/sdk. Lazily constructed singletons so a
// single request doesn't pay reconstruction cost across nested handlers.
//
// Storage requires a signer in its constructor, but only uses it for uploads;
// reads (getJson, indexer.download) never touch the key. For a read-only
// directory UI we either pull a key from env or generate a throwaway wallet.

import "server-only";

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

// Storage requires a signer in its constructor but only uses it for uploads;
// reads (getJson, indexer.download) never touch the key. For read-only
// directory pages we use the env key when available, else generate a
// throwaway 32-byte hex via Web Crypto. No on-chain action ever signs with this.
function readOnlyPrivateKey(): string {
  const env = process.env.AGENTDIR_READ_KEY ?? process.env.PRIVATE_KEY;
  if (env && env.length >= 64) return env.startsWith("0x") ? env : `0x${env}`;
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

let _signer: ReturnType<typeof makeSigner> | null = null;
function getSigner() {
  if (!_signer) _signer = makeSigner(readOnlyPrivateKey(), ZG_RPC);
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
