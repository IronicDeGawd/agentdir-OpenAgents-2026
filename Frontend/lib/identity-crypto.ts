// NOTE: this module loads `server-only` lazily (via a side-channel re-export
// in identity-store.ts) so unit tests under `node:test` can import it
// without the Next.js runtime guard. Direct usage from API routes goes
// through identity-store which DOES carry `server-only`.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// ── KEK plumbing ────────────────────────────────────────────────────────
//
// IDENTITY_KEK is the only secret that decrypts agent privkeys at rest.
// Treat it as the crown jewel: never log, never write to disk, never
// expose in error messages or stack traces.
//
// Loaded lazily so module import in tests / dev doesn't crash on missing
// env. Throws hard the first time anything tries to encrypt or decrypt.

const KEK_HEX_RE = /^[0-9a-fA-F]{64}$/;

let cachedKek: Buffer | null = null;
let cachedVersion: number | null = null;

function loadKek(): { kek: Buffer; version: number } {
  if (cachedKek && cachedVersion !== null) {
    return { kek: cachedKek, version: cachedVersion };
  }
  const hex = process.env.IDENTITY_KEK;
  const versionRaw = process.env.IDENTITY_KEK_VERSION ?? "1";
  if (!hex) {
    throw new Error(
      "IDENTITY_KEK env var is required (32-byte hex). Generate with: openssl rand -hex 32",
    );
  }
  const stripped = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!KEK_HEX_RE.test(stripped)) {
    throw new Error("IDENTITY_KEK must be 32-byte hex (64 chars, optional 0x prefix)");
  }
  const version = Number.parseInt(versionRaw, 10);
  if (!Number.isInteger(version) || version < 1) {
    throw new Error("IDENTITY_KEK_VERSION must be a positive integer");
  }
  cachedKek = Buffer.from(stripped, "hex");
  cachedVersion = version;
  return { kek: cachedKek, version };
}

// Test/rotation hook — set both KEK + version atomically. Tests reset
// before each case so module-cached KEK doesn't leak across cases.
export function __setKekForTesting(hex: string | null, version = 1): void {
  if (hex === null) {
    cachedKek = null;
    cachedVersion = null;
    return;
  }
  const stripped = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!KEK_HEX_RE.test(stripped)) throw new Error("bad test KEK");
  cachedKek = Buffer.from(stripped, "hex");
  cachedVersion = version;
}

// ── Envelope shape ──────────────────────────────────────────────────────
//
// AES-256-GCM. 12-byte IV (per NIST SP 800-38D recommendation), 16-byte
// auth tag. IV is random per encrypt — never reuse a (key, iv) pair.

export type SealedBlob = {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  kekVersion: number;
};

export function seal(plaintext: string): SealedBlob {
  const { kek, version } = loadKek();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", kek, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ct,
    iv,
    authTag: cipher.getAuthTag(),
    kekVersion: version,
  };
}

export function open(blob: SealedBlob): string {
  const { kek, version } = loadKek();
  if (blob.kekVersion !== version) {
    // The caller must hold the historical KEK to read older rows.
    // Surface a specific error so rotate-kek tooling can branch on it.
    throw new Error(
      `kek version mismatch: blob=${blob.kekVersion} active=${version} — rotation needed`,
    );
  }
  if (blob.iv.length !== 12) throw new Error("iv must be 12 bytes");
  if (blob.authTag.length !== 16) throw new Error("authTag must be 16 bytes");
  const decipher = createDecipheriv("aes-256-gcm", kek, blob.iv);
  decipher.setAuthTag(blob.authTag);
  const plain = Buffer.concat([decipher.update(blob.ciphertext), decipher.final()]);
  return plain.toString("utf8");
}
