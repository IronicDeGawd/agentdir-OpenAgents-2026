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
// reads (getJson, indexer.download) never touch the key. In production we
// require an explicit env key — silent fallback hides misconfiguration. In
// dev only, fabricate a throwaway 32-byte hex with a loud warning.
const HEX_KEY_RE = /^[0-9a-fA-F]{64}$/;

function readOnlyPrivateKey(): string {
  const raw = process.env.AGENTDIR_READ_KEY ?? process.env.PRIVATE_KEY ?? "";
  const stripped = raw.startsWith("0x") ? raw.slice(2) : raw;
  if (stripped) {
    if (!HEX_KEY_RE.test(stripped)) {
      throw new Error(
        "AGENTDIR_READ_KEY / PRIVATE_KEY must be 32-byte hex (64 chars, optional 0x prefix)",
      );
    }
    return `0x${stripped}`;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "AGENTDIR_READ_KEY (or PRIVATE_KEY) is required in production. Refusing to fabricate ephemeral signer.",
    );
  }
  console.warn(
    "[sdk-server] No AGENTDIR_READ_KEY / PRIVATE_KEY set — fabricating a throwaway dev key. Reads only; do not deploy this way.",
  );
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

export function getDirectory(seed?: string[]): Directory {
  return new Directory({
    ens: { network: "sepolia", sepoliaRpc: process.env.SEPOLIA_RPC_URL },
    storage: getStorage(),
    seed: seed && seed.length ? seed : AGENTDIR.agents.map((a) => a.ens),
  });
}

export function getRepChain(head: string | null = null): RepChain {
  return new RepChain(getStorage(), head);
}

export type { DirectoryQuery };
