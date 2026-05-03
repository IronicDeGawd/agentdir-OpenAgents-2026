import "server-only";

import { MongoClient, type Db } from "mongodb";

// Single pooled MongoClient per process. Next.js dev hot-reload runs the
// module multiple times — guard via globalThis to avoid leaking sockets.

declare global {
  // eslint-disable-next-line no-var
  var __agentdirMongo: { client: MongoClient | null; promise: Promise<MongoClient> | null } | undefined;
}

const cache = (globalThis.__agentdirMongo ??= { client: null, promise: null });

function url(): string {
  const u = process.env.MONGO_URL;
  if (!u) throw new Error("MONGO_URL env var required");
  return u;
}

function dbName(): string {
  return process.env.MONGO_DB ?? "agentdir";
}

export async function getMongo(): Promise<MongoClient> {
  if (cache.client) return cache.client;
  if (cache.promise) return cache.promise;
  cache.promise = MongoClient.connect(url(), {
    // Conservative timeouts so a dead Mongo doesn't hang the API request
    // forever — fail fast, return 503, let caller retry.
    serverSelectionTimeoutMS: 5_000,
    connectTimeoutMS: 5_000,
    maxPoolSize: 20,
  })
    .then((c) => {
      cache.client = c;
      return c;
    })
    .catch((e) => {
      cache.promise = null;
      throw e;
    });
  return cache.promise;
}

export async function getDb(): Promise<Db> {
  const client = await getMongo();
  return client.db(dbName());
}

// One-shot bootstrap: ensure indexes exist. Idempotent. Safe to call from
// every cold start; Mongo dedupes index creation if already present.
let indexesEnsured = false;

export async function ensureIndexes(): Promise<void> {
  if (indexesEnsured) return;
  const db = await getDb();
  await Promise.all([
    db.collection("identities").createIndex({ handle: 1 }, { unique: true }),
    db.collection("identities").createIndex({ ens: 1 }, { unique: true }),
    db.collection("identities").createIndex({ ownerAddress: 1 }),
    db.collection("auth_nonces").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection("rate_limits").createIndex({ windowEndsAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection("mint_log").createIndex({ createdAt: -1 }),
    db.collection("mint_log").createIndex({ ownerAddress: 1, createdAt: -1 }),
  ]);
  indexesEnsured = true;
}
