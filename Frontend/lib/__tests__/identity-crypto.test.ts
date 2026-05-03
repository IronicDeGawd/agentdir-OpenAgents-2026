import { test } from "node:test";
import assert from "node:assert/strict";
import { seal, open, __setKekForTesting } from "../identity-crypto.js";

const TEST_KEK = "a".repeat(64);
const TEST_KEK_2 = "b".repeat(64);

test("round-trip: seal then open returns identical plaintext", () => {
  __setKekForTesting(TEST_KEK, 1);
  const plain = JSON.stringify({
    handle: "alice",
    axlPrivateKeyHex: "deadbeef".repeat(8),
  });
  const blob = seal(plain);
  assert.equal(open(blob), plain);
});

test("each seal uses fresh IV (no determinism leak)", () => {
  __setKekForTesting(TEST_KEK, 1);
  const a = seal("hello");
  const b = seal("hello");
  assert.notDeepEqual(a.iv, b.iv);
  assert.notDeepEqual(a.ciphertext, b.ciphertext);
});

test("modified ciphertext fails GCM auth", () => {
  __setKekForTesting(TEST_KEK, 1);
  const blob = seal("secret");
  blob.ciphertext[0] ^= 0xff;
  assert.throws(() => open(blob));
});

test("modified auth tag fails GCM auth", () => {
  __setKekForTesting(TEST_KEK, 1);
  const blob = seal("secret");
  blob.authTag[0] ^= 0xff;
  assert.throws(() => open(blob));
});

test("wrong KEK fails to decrypt", () => {
  __setKekForTesting(TEST_KEK, 1);
  const blob = seal("secret");
  __setKekForTesting(TEST_KEK_2, 1);
  assert.throws(() => open(blob));
});

test("blob.kekVersion mismatch throws specific message", () => {
  __setKekForTesting(TEST_KEK, 1);
  const blob = seal("secret");
  __setKekForTesting(TEST_KEK, 2);
  assert.throws(() => open(blob), /kek version mismatch/);
});

test("invalid IV length rejected", () => {
  __setKekForTesting(TEST_KEK, 1);
  const blob = seal("secret");
  assert.throws(() => open({ ...blob, iv: Buffer.alloc(8) }), /iv must be 12 bytes/);
});

test("invalid authTag length rejected", () => {
  __setKekForTesting(TEST_KEK, 1);
  const blob = seal("secret");
  assert.throws(
    () => open({ ...blob, authTag: Buffer.alloc(8) }),
    /authTag must be 16 bytes/,
  );
});

test("missing KEK env throws on first encrypt", () => {
  __setKekForTesting(null);
  delete process.env.IDENTITY_KEK;
  assert.throws(() => seal("anything"), /IDENTITY_KEK env var is required/);
});

test("KEK with 0x prefix accepted", () => {
  __setKekForTesting(null);
  process.env.IDENTITY_KEK = "0x" + TEST_KEK;
  process.env.IDENTITY_KEK_VERSION = "1";
  const blob = seal("ok");
  assert.equal(open(blob), "ok");
});
