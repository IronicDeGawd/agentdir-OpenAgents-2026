// Live network test. Skipped when SKIP_LIVE=1.
// Verifies the SDK's EnsResolver hits the same green path as probes/ens.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EnsResolver } from "../../packages/sdk/src/ens.js";

const skip = process.env.SKIP_LIVE === "1";

test("EnsResolver.getAddress(nick.eth) returns nick's address", { skip }, async () => {
  const r = new EnsResolver({ mainnetRpc: process.env.MAINNET_RPC_URL });
  const addr = await r.getAddress("nick.eth");
  assert.equal(addr?.toLowerCase(), "0xb8c2c29ee19d8307cb7255e1cd9cbde883a267d5");
});

test("EnsResolver.getText(nick.eth, com.twitter)", { skip }, async () => {
  const r = new EnsResolver({ mainnetRpc: process.env.MAINNET_RPC_URL });
  const t = await r.getText("nick.eth", "com.twitter");
  assert.equal(t, "nicksdjohnson");
});

test("EnsResolver Universal Resolver canary", { skip }, async () => {
  const r = new EnsResolver({ mainnetRpc: process.env.MAINNET_RPC_URL });
  const a = await r.getAddress("ur.integration-tests.eth");
  assert.equal(a, "0x2222222222222222222222222222222222222222");
});
