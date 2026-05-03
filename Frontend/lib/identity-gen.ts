"use client";

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";

ed.etc.sha512Async = (...m) => Promise.resolve(sha512(ed.etc.concatBytes(...m)));

export type ClientIdentity = {
  handle: string;
  ensName: string;
  axlPrivateKeyHex: string;
  axlPubkeyHex: string;
};

function toHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

export async function generateIdentity(
  handle: string,
  ensName: string,
): Promise<ClientIdentity> {
  const priv = ed.utils.randomPrivateKey();
  const pub = await ed.getPublicKeyAsync(priv);
  return {
    handle,
    ensName,
    axlPrivateKeyHex: toHex(priv),
    axlPubkeyHex: toHex(pub),
  };
}

export function downloadIdentityFile(id: ClientIdentity): void {
  const blob = new Blob([JSON.stringify(id, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `identity-${id.handle}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
