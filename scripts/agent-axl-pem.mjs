#!/usr/bin/env node
// Convert a 32-byte ed25519 private key (raw hex) into a PEM file AXL accepts.
// AXL/Yggdrasil uses standard PKCS#8 ed25519. We hand-encode the DER.
//
// Usage: node agent-axl-pem.mjs <handle> <out.pem>
import { readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const [, , handle, outPath] = process.argv;
if (!handle || !outPath) {
  console.error("usage: agent-axl-pem.mjs <handle> <out.pem>");
  process.exit(2);
}

const idPath = join(homedir(), ".agentdir", handle, "identity.json");
const id = JSON.parse(readFileSync(idPath, "utf8"));
const privHex = id.axlPrivateKeyHex;
if (!/^[0-9a-fA-F]{64}$/.test(privHex)) {
  console.error("identity.axlPrivateKeyHex is not 32 bytes hex");
  process.exit(1);
}
const priv = Buffer.from(privHex, "hex");

// PKCS#8 ed25519 wrapper:
// 30 2e            SEQUENCE (46 bytes)
//   02 01 00       INTEGER version=0
//   30 05          SEQUENCE
//     06 03 2b6570 OID 1.3.101.112 (Ed25519)
//   04 22          OCTET STRING (34 bytes)
//     04 20 <32-byte priv>   inner OCTET STRING
const der = Buffer.concat([
  Buffer.from([0x30, 0x2e, 0x02, 0x01, 0x00]),
  Buffer.from([0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70]),
  Buffer.from([0x04, 0x22, 0x04, 0x20]),
  priv,
]);
const b64 = der.toString("base64");
const lines = b64.match(/.{1,64}/g) ?? [b64];
const pem =
  "-----BEGIN PRIVATE KEY-----\n" + lines.join("\n") + "\n-----END PRIVATE KEY-----\n";
writeFileSync(outPath, pem);
chmodSync(outPath, 0o600);
console.log(outPath);
