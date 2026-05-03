#!/usr/bin/env node
/**
 * One-shot seed: read each ~/.agentdir/<handle>/identity.json, encrypt
 * the privkey w/ IDENTITY_KEK from env, and insert into Mongo. Idempotent
 * — duplicate handles fail the unique index and are reported, not retried
 * (silent re-bind would be a security footgun).
 *
 * Run from repo root:
 *   MONGO_URL=... IDENTITY_KEK=... node scripts/seed-identities.mjs
 */

import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createCipheriv, randomBytes } from "node:crypto";
import { MongoClient, Binary } from "mongodb";

const KEK_HEX = process.env.IDENTITY_KEK;
const KEK_VERSION = Number.parseInt(process.env.IDENTITY_KEK_VERSION ?? "1", 10);
const MONGO_URL = process.env.MONGO_URL;

if (!KEK_HEX || !/^(0x)?[0-9a-fA-F]{64}$/.test(KEK_HEX)) {
  console.error("IDENTITY_KEK env var required (32-byte hex)");
  process.exit(1);
}
if (!MONGO_URL) {
  console.error("MONGO_URL env var required");
  process.exit(1);
}

const KEK = Buffer.from(KEK_HEX.replace(/^0x/, ""), "hex");

function seal(plain) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEK, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return { ciphertext: ct, iv, authTag: cipher.getAuthTag(), kekVersion: KEK_VERSION };
}

const root = join(homedir(), ".agentdir");
const entries = await readdir(root, { withFileTypes: true });
const handles = entries.filter((e) => e.isDirectory()).map((e) => e.name);
console.log(`[seed] found ${handles.length} handles in ${root}`);

const client = await MongoClient.connect(MONGO_URL, {
  serverSelectionTimeoutMS: 5000,
});
const db = client.db(process.env.MONGO_DB ?? "agentdir");

await Promise.all([
  db.collection("identities").createIndex({ handle: 1 }, { unique: true }),
  db.collection("identities").createIndex({ ens: 1 }, { unique: true }),
  db.collection("identities").createIndex({ ownerAddress: 1 }),
]);

let inserted = 0;
let skipped = 0;
let failed = 0;
for (const handle of handles) {
  const path = join(root, handle, "identity.json");
  let id;
  try {
    id = JSON.parse(await readFile(path, "utf8"));
  } catch (e) {
    console.warn(`[seed] skip ${handle}: ${e.message}`);
    skipped += 1;
    continue;
  }
  if (!id.axlPrivateKeyHex || !id.axlPubkeyHex || !id.ensName) {
    console.warn(`[seed] skip ${handle}: malformed identity`);
    skipped += 1;
    continue;
  }
  const blob = seal(id.axlPrivateKeyHex);
  const doc = {
    handle: id.handle ?? handle,
    ens: id.ensName,
    ownerAddress: (process.env.SEED_OWNER_ADDRESS ?? "").toLowerCase() || "0x0000000000000000000000000000000000000000",
    axlPubkeyHex: id.axlPubkeyHex,
    encryptedPrivkey: {
      ciphertext: new Binary(blob.ciphertext),
      iv: new Binary(blob.iv),
      authTag: new Binary(blob.authTag),
      kekVersion: blob.kekVersion,
    },
    inftContract: id.inftContract,
    inftTokenId: id.inftTokenId,
    hostingMode: "server-hosted",
    createdAt: new Date(),
    lastBootedAt: null,
    status: "active",
  };
  try {
    await db.collection("identities").insertOne(doc);
    console.log(`[seed] + ${handle} (${doc.ens})`);
    inserted += 1;
  } catch (e) {
    if (e.code === 11000) {
      console.log(`[seed] = ${handle} already present — leaving as-is`);
      skipped += 1;
    } else {
      console.error(`[seed] ! ${handle} failed:`, e.message);
      failed += 1;
    }
  }
}

console.log(`[seed] done. inserted=${inserted} skipped=${skipped} failed=${failed}`);
await client.close();
process.exit(failed > 0 ? 1 : 0);
