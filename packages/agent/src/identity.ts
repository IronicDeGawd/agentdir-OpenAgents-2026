// Persistent agent identity: AXL ed25519 keypair + ENS name + iNFT tokenId.
// On-disk layout: ~/.agentdir/<handle>/identity.json (chmod 600)
// Private key is raw ed25519 seed bytes, hex-encoded — never logged.

import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";

ed.etc.sha512Async = (...m) => Promise.resolve(sha512(ed.etc.concatBytes(...m)));
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

export type AgentIdentity = {
  handle: string; // local nickname, e.g. "alice"
  ensName: string; // e.g. "alice.agentdir.eth"
  axlPrivateKeyHex: string; // 32 bytes hex (no 0x)
  axlPubkeyHex: string; // 32 bytes hex
  inftContract?: string; // deployment address on 0G chain
  inftTokenId?: string; // decimal string
  walletPrivateKey?: string; // EVM key for on-chain ops; reuse global if absent
};

const root = () => join(homedir(), ".agentdir");
const dir = (handle: string) => join(root(), handle);
const file = (handle: string) => join(dir(handle), "identity.json");

/**
 * Load existing identity from disk OR create a fresh one.
 * If a file exists with a different `ensName`, throws — silent ENS swap is
 * always a bug. Pass `ensName=null` to load whatever exists without checks.
 */
export async function loadOrCreate(
  handle: string,
  ensName: string | null
): Promise<AgentIdentity> {
  const p = file(handle);
  // Atomic: try-read; only fall through to creation on ENOENT.
  try {
    const txt = await readFile(p, "utf8");
    const id = JSON.parse(txt) as AgentIdentity;
    if (ensName !== null && id.ensName !== ensName) {
      throw new Error(
        `identity '${handle}' has ensName '${id.ensName}' but caller passed '${ensName}'. ` +
          `Refusing to silently overwrite. Pass null to ignore, or delete ${p}.`
      );
    }
    return id;
  } catch (e: any) {
    if (e?.code !== "ENOENT") throw e;
    // fall through to create
  }
  if (ensName === null) throw new Error(`no identity for handle '${handle}' and no ensName provided`);
  await mkdir(dir(handle), { recursive: true });
  const priv = ed.utils.randomPrivateKey();
  const pub = await ed.getPublicKeyAsync(priv);
  const id: AgentIdentity = {
    handle,
    ensName,
    axlPrivateKeyHex: Buffer.from(priv).toString("hex"),
    axlPubkeyHex: Buffer.from(pub).toString("hex"),
  };
  // wx flag → fail if file appeared between our read and write (race-safe).
  await writeFile(p, JSON.stringify(id, null, 2), { flag: "wx" });
  await chmod(p, 0o600);
  return id;
}

export async function saveIdentity(id: AgentIdentity): Promise<void> {
  await mkdir(dir(id.handle), { recursive: true });
  await writeFile(file(id.handle), JSON.stringify(id, null, 2));
  await chmod(file(id.handle), 0o600);
}

/** Sign arbitrary 32-byte digest with this identity's AXL key. Returns 0x-hex sig. */
export async function signDigest(id: AgentIdentity, digestHex: `0x${string}`): Promise<string> {
  const priv = Buffer.from(id.axlPrivateKeyHex, "hex");
  const msg = Buffer.from(digestHex.slice(2), "hex");
  const sig = await ed.signAsync(msg, priv);
  return "0x" + Buffer.from(sig).toString("hex");
}
