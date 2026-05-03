import "server-only";

import { Binary } from "mongodb";
import { getDb, ensureIndexes } from "./db";
import { seal, open, type SealedBlob } from "./identity-crypto";

// ── Types ────────────────────────────────────────────────────────────
//
// Mirror the on-disk AgentIdentity shape from packages/agent/src/identity.ts
// so call-server.ts can drop this in as a 1:1 replacement for loadOrCreate.

export type AgentIdentity = {
  handle: string;
  ensName: string;
  axlPrivateKeyHex: string;
  axlPubkeyHex: string;
  inftContract?: string;
  inftTokenId?: string;
};

type IdentityDoc = {
  handle: string;
  ens: string;
  ownerAddress: string;
  axlPubkeyHex: string;
  encryptedPrivkey: {
    ciphertext: Binary;
    iv: Binary;
    authTag: Binary;
    kekVersion: number;
  };
  inftContract?: string;
  inftTokenId?: string;
  hostingMode: "server-hosted";
  createdAt: Date;
  lastBootedAt: Date | null;
  status: "active" | "disabled";
};

// ── Memo cache ───────────────────────────────────────────────────────
//
// Hot path: /api/call boots a callee runtime per ENS; identity is
// fetched once and stays warm in process memory. KEK decrypt isn't free
// so cache the plaintext too.
//
// Cache key is handle. Privkey lives in Node heap until the process
// dies. We accept this for the single-host server-hosted topology.

const cache = new Map<string, AgentIdentity>();

export function evictCache(handle?: string): void {
  if (handle) cache.delete(handle);
  else cache.clear();
}

// ── Reads ───────────────────────────────────────────────────────────

export async function loadIdentity(handle: string): Promise<AgentIdentity> {
  const cached = cache.get(handle);
  if (cached) return cached;

  await ensureIndexes();
  const db = await getDb();
  const doc = (await db.collection<IdentityDoc>("identities").findOne(
    { handle, status: "active" },
  )) as IdentityDoc | null;
  if (!doc) throw new Error(`identity not found: ${handle}`);

  const blob: SealedBlob = {
    ciphertext: Buffer.from(doc.encryptedPrivkey.ciphertext.buffer),
    iv: Buffer.from(doc.encryptedPrivkey.iv.buffer),
    authTag: Buffer.from(doc.encryptedPrivkey.authTag.buffer),
    kekVersion: doc.encryptedPrivkey.kekVersion,
  };
  const privHex = open(blob);

  const identity: AgentIdentity = {
    handle: doc.handle,
    ensName: doc.ens,
    axlPrivateKeyHex: privHex,
    axlPubkeyHex: doc.axlPubkeyHex,
  };
  if (doc.inftContract) identity.inftContract = doc.inftContract;
  if (doc.inftTokenId) identity.inftTokenId = doc.inftTokenId;

  cache.set(handle, identity);
  return identity;
}

export async function findIdentityByOwner(
  ownerAddress: string,
): Promise<{ handle: string; ens: string }[]> {
  await ensureIndexes();
  const db = await getDb();
  const rows = await db
    .collection<IdentityDoc>("identities")
    .find({ ownerAddress: ownerAddress.toLowerCase(), status: "active" })
    .project<{ handle: string; ens: string }>({ handle: 1, ens: 1, _id: 0 })
    .toArray();
  return rows;
}

export async function listActiveHandles(): Promise<string[]> {
  await ensureIndexes();
  const db = await getDb();
  const rows = await db
    .collection<IdentityDoc>("identities")
    .find({ status: "active" })
    .project<{ handle: string }>({ handle: 1, _id: 0 })
    .toArray();
  return rows.map((r) => r.handle);
}

// ── Writes ──────────────────────────────────────────────────────────

export type SaveIdentityInput = {
  handle: string;
  ens: string;
  ownerAddress: string;
  axlPrivateKeyHex: string;
  axlPubkeyHex: string;
  inftContract?: string;
  inftTokenId?: string;
};

export async function saveIdentity(input: SaveIdentityInput): Promise<void> {
  await ensureIndexes();
  const db = await getDb();

  const blob = seal(input.axlPrivateKeyHex);

  const doc: IdentityDoc = {
    handle: input.handle,
    ens: input.ens,
    ownerAddress: input.ownerAddress.toLowerCase(),
    axlPubkeyHex: input.axlPubkeyHex,
    encryptedPrivkey: {
      ciphertext: new Binary(blob.ciphertext),
      iv: new Binary(blob.iv),
      authTag: new Binary(blob.authTag),
      kekVersion: blob.kekVersion,
    },
    hostingMode: "server-hosted",
    createdAt: new Date(),
    lastBootedAt: null,
    status: "active",
  };
  if (input.inftContract) doc.inftContract = input.inftContract;
  if (input.inftTokenId) doc.inftTokenId = input.inftTokenId;

  // Insert-only on first run; if a stale row exists for this handle the
  // unique index throws and the caller surfaces a 409. Retrying overwrites
  // would silently rebind a privkey, which we never want.
  await db.collection<IdentityDoc>("identities").insertOne(doc);
  cache.delete(input.handle);
}

export async function markBooted(handle: string): Promise<void> {
  const db = await getDb();
  await db
    .collection<IdentityDoc>("identities")
    .updateOne({ handle }, { $set: { lastBootedAt: new Date() } });
}

// Audit logging — separate collection so we can rotate / archive without
// touching identities.
export async function logMint(entry: {
  handle: string;
  ens: string;
  ownerAddress: string;
  txHashGalileo: string;
  ip: string;
  userAgent: string;
}): Promise<void> {
  const db = await getDb();
  await db.collection("mint_log").insertOne({ ...entry, createdAt: new Date() });
}
